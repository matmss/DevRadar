// Which dev belongs to the signed-in GitHub account, and which login each dev shows (auth spec
// Q5, Q10, US-8). Used by every /devs/me route, by POST /devs and by sign-in (AuthController),
// so the rules live in one place.
//
// A profile belongs to a GitHub account by its numeric id (`github_id`), never by its login:
// logins can be renamed and later registered by someone else. For the signed-in user
// `{ github_id, github_username }` (req.user):
//   1. own       a dev has github_id === the user's id. It is theirs.
//   2. legacy    otherwise, a dev WITHOUT a github_id (field missing or null) whose login matches
//                the user's case-insensitively: created before sign-in existed. The owner of that
//                login claims it on their first write: one conditional update sets github_id only
//                if it is still absent and the login unchanged, so of two accounts claiming at
//                once exactly one wins (`claimed`). Reads do not claim (`legacy`, read-only).
//   3. conflict  otherwise, a dev with ANOTHER github_id but this login. It is never theirs: no
//                read, update or delete. On POST /devs, if this session's GitHub read is newer
//                than that dev's login state, that dev is displaced (below) and the user
//                registers; otherwise 409 github_username_conflict (logins are unique across all
//                profiles, and the other dev's login was confirmed by a newer read).
//   4. none      otherwise.
//
// Logins (display data) follow GitHub, ordered by when GitHub was read. The newest read wins:
//   - Every dev records `github_username_seen_at`: the time of the GitHub read (GET /user at
//     sign-in, the session token's `login_read_at`) its current login state comes from.
//   - Whenever an account takes its login (at sign-in, and on its POST/PUT, including a claim),
//     another dev showing that login with an OLDER state is DISPLACED: its github_username
//     becomes a unique placeholder that is never a valid GitHub login (`_stale_<_id>`), with
//     `github_username_stale: true` (and a name that was only the old login is cleared), and
//     nothing else about it changes (it is never deleted). Then the account's dev takes the
//     login. A displaced dev gets its owner's current login back at the owner's next sign-in or
//     newer write. A legacy dev is displaced only by an account that already owns a dev
//     (otherwise it is that account's to claim, rule 2). A dev with a NEWER state is never
//     touched: the older session keeps its stored login (PUT) or gets 409 (POST).
// Nothing is migrated at deploy time: legacy devs are only touched by their owner's write or a
// displacement.
//
// Concurrency: every write runs in the per-account queue of each account whose dev it touches
// (utils/keyedQueue.js, keyed by github_id), together with its socket announcement, so the live
// events follow the database order. Taking a login (inLoginOrder) may touch the holder's dev, so
// it looks the holder up first and holds both accounts' keys, taken in sorted order: no two
// tasks can wait for each other, so swaps cannot deadlock. Under the keys it re-checks the
// holder and starts over (at most three times) if it changed. Legacy devs have no account key;
// their claim and their displacement are conditional updates that exclude each other.
const Dev = require('../models/Dev');
const { GITHUB_USERNAME_COLLATION } = require('../utils/githubUsername');
const { createKeyedQueue } = require('../utils/keyedQueue');
const { EVENT, announceStored } = require('./devEvents');

// MongoDB duplicate-key error: a unique index (github_id or github_username) refused a write.
const DUPLICATE_KEY = 11000;

// A resolution that keeps losing races (a claim taken or a dev changed between our read and our
// write, each time) gives up instead of looping. Each extra attempt needs another concurrent
// write to the same records, so three is plenty.
const MAX_ATTEMPTS = 3;

// Displaced logins: "_" can never appear in a GitHub login, so the placeholder can never be a
// real account's, never matches a login lookup, and is unique (one per _id).
const STALE_LOGIN_PREFIX = '_stale_';

const OWNERSHIP = Object.freeze({
  OWN: 'own',
  CLAIMED: 'claimed',
  LEGACY: 'legacy',
  CONFLICT: 'conflict',
  NONE: 'none',
});

/**
 * The signed-in account (req.user, utils/sessionToken.js SessionUser). `login_read_at` (ms since
 * the epoch) is when GitHub said this login is this account's; only read when a login is stored.
 * @typedef {{ github_id: number, github_username: string, login_read_at?: number }} AccountIdentity
 * @typedef {{ status: 'own' | 'claimed' | 'legacy', dev: object }
 *   | { status: 'conflict' | 'none', dev: null }} Ownership
 */

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isDuplicateKey(err) {
  return Boolean(err) && err.code === DUPLICATE_KEY;
}

/**
 * @param {{ github_id?: unknown }} dev
 * @returns {boolean} true for a legacy dev (no account: github_id missing or null)
 */
function isLegacy(dev) {
  return dev.github_id === undefined || dev.github_id === null;
}

/**
 * @param {{ _id: unknown }} dev
 * @returns {string} the placeholder login of a displaced dev
 */
function staleLogin(dev) {
  return `${STALE_LOGIN_PREFIX}${String(dev._id)}`;
}

/**
 * @param {{ login_read_at: number }} user
 * @returns {Date} when GitHub said the session's login is this account's
 */
function loginReadAt(user) {
  return new Date(user.login_read_at);
}

/**
 * @param {Date} readAt
 * @returns {object} a filter part: the dev's login state is older than `readAt` (or unknown)
 */
function olderThan(readAt) {
  return {
    $or: [
      { github_username_seen_at: { $exists: false } },
      { github_username_seen_at: null },
      { github_username_seen_at: { $lt: readAt } },
    ],
  };
}

/**
 * The stored fields that record the account's current login (a new or claimed dev stores them).
 * @param {AccountIdentity & { login_read_at: number }} user
 * @returns {{ github_username: string, github_username_seen_at: Date }}
 */
function loginFields(user) {
  return { github_username: user.github_username, github_username_seen_at: loginReadAt(user) };
}

/**
 * @param {AccountIdentity} user
 * @returns {Promise<object | null>} the dev that belongs to the account by id (rule 1)
 */
function findDevByAccount(user) {
  return Dev.findOne({ github_id: user.github_id });
}

/**
 * @param {string} login
 * @returns {Promise<object | null>} the dev showing `login`, case-insensitively
 */
function findDevByLogin(login) {
  return Dev.findOne({ github_username: login }).collation(GITHUB_USERNAME_COLLATION);
}

/**
 * Applies the ownership rules above. Never returns another account's dev.
 * @param {AccountIdentity} user
 * @param {{ claim?: boolean }} [options] - claim a legacy dev (writes; needs `login_read_at`)
 * @returns {Promise<Ownership>}
 */
async function resolveOwnDev(user, { claim = false } = {}) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const own = await findDevByAccount(user);
    if (own) return { status: OWNERSHIP.OWN, dev: own };

    const sameLogin = await findDevByLogin(user.github_username);
    if (!sameLogin) return { status: OWNERSHIP.NONE, dev: null };
    if (!isLegacy(sameLogin)) return { status: OWNERSHIP.CONFLICT, dev: null };
    if (!claim) return { status: OWNERSHIP.LEGACY, dev: sameLogin };

    let claimed = null;
    try {
      // Still legacy and still showing this login (a displacing sign-in may have moved it).
      // Takes the login as GitHub spells it now, and records when that was read (QA-AUTH6-2).
      claimed = await Dev.findOneAndUpdate(
        { _id: sameLogin._id, github_id: null, github_username: sameLogin.github_username },
        { $set: { github_id: user.github_id, ...loginFields(user) }, $unset: { github_username_stale: 1 } },
        { returnDocument: 'after' }
      );
    } catch (err) {
      // The account got a dev of its own meanwhile (github_id index): the next round finds it.
      if (!isDuplicateKey(err)) throw err;
    }
    if (claimed) return { status: OWNERSHIP.CLAIMED, dev: claimed };
    // Claimed by another account, displaced, deleted, or ours by now: look again.
  }
  throw new Error('Could not resolve the developer profile owner: too many concurrent changes');
}

/**
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean} true if both are strings equal in any letter case
 */
function sameLoginText(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

/**
 * Sets the dev's login to the session's (a GitHub rename, including a change of letter case),
 * and records when GitHub said so, unless the stored state comes from a read at least as recent
 * (an old token cannot set a login back). A name that was only the old login (or was cleared by
 * a displacement) follows: the sign-in profile's name, else the new login. If another dev holds
 * the login, the stored login is kept (inLoginOrder displaces that dev first when this read is
 * newer).
 * @param {object} dev - a dev the account owns
 * @param {AccountIdentity & { login_read_at: number, profile?: { name?: string | null } }} user
 * @returns {Promise<{ dev: object | null, renamed: boolean }>} the dev as stored now (null if it
 *   was deleted meanwhile), and whether its login changed
 */
async function refreshLogin(dev, user) {
  const readAt = loginReadAt(user);
  const filter = { _id: dev._id, github_id: user.github_id, ...olderThan(readAt) };

  if (dev.github_username === user.github_username) {
    // Same login: only record the newer confirmation (also when none was recorded, QA-AUTH6-2).
    const confirmed = await Dev.findOneAndUpdate(
      filter,
      { $set: { github_username_seen_at: readAt } },
      { returnDocument: 'after' }
    );
    return { dev: confirmed || await Dev.findOne({ _id: dev._id, github_id: user.github_id }), renamed: false };
  }

  const set = { ...loginFields(user) };
  if (!dev.name || sameLoginText(dev.name, dev.github_username)) {
    set.name = (user.profile && user.profile.name) || user.github_username;
  }
  let renamed = null;
  try {
    renamed = await Dev.findOneAndUpdate(
      filter,
      { $set: set, $unset: { github_username_stale: 1 } },
      { returnDocument: 'after' }
    );
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    console.error('A developer login could not be refreshed: another developer still uses it');
  }
  if (renamed) return { dev: renamed, renamed: true };
  // Not renamed: a newer read is stored, the login is taken, or the dev is gone.
  return { dev: await Dev.findOne({ _id: dev._id, github_id: user.github_id }), renamed: false };
}

/**
 * Updates the account's dev with `fields`, after refreshing its login (refreshLogin), never
 * creating one.
 * @param {object} dev - a dev the account owns
 * @param {AccountIdentity & { login_read_at: number }} user
 * @param {object} fields - the new values (validated by the caller)
 * @returns {Promise<object | null>} the updated dev, or null if it was deleted meanwhile
 */
async function updateOwnDev(dev, user, fields) {
  const { dev: current } = await refreshLogin(dev, user);
  if (!current) return null;
  return Dev.findOneAndUpdate(
    { _id: current._id, github_id: user.github_id },
    { $set: fields },
    { returnDocument: 'after', runValidators: true }
  );
}

const writesByAccount = createKeyedQueue();

/** @param {number} githubId @returns {string} */
function accountKey(githubId) {
  return `github_id:${githubId}`;
}

/**
 * Runs `task` (database writes and their announcements) after every write already queued for the
 * same GitHub account. For writes that never change a login (DELETE).
 * @template T
 * @param {AccountIdentity} user
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function inAccountOrder(user, task) {
  return writesByAccount.run(accountKey(user.github_id), task);
}

// Returned by an inLoginOrder task to start over (the login's holder changed under it).
const RETRY = Symbol('retry');

/**
 * @param {object | null} a
 * @param {object | null} b
 * @returns {boolean} true if both are the same dev with the same owner, or both absent
 */
function sameHolder(a, b) {
  if (!a || !b) return a === b;
  return String(a._id) === String(b._id) && a.github_id === b.github_id;
}

/**
 * Runs `task(holder)` for a write that may take the account's login: holding the account's key
 * and, if another account's dev shows the login (`holder`), that account's key too, taken in
 * sorted order (keyedQueue.runAll). Under the keys the holder is looked up again; if it changed,
 * or the task returns RETRY, everything starts over (at most MAX_ATTEMPTS times).
 * @template T
 * @param {AccountIdentity} user
 * @param {(holder: object | null) => Promise<T | typeof RETRY>} task - `holder`: the dev showing
 *   the user's login now (any owner, possibly the user's own, or legacy), or null
 * @returns {Promise<T>}
 */
async function inLoginOrder(user, task) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const expected = await findDevByLogin(user.github_username);
    const keys = [accountKey(user.github_id)];
    if (expected && !isLegacy(expected) && expected.github_id !== user.github_id) {
      keys.push(accountKey(expected.github_id));
    }
    const outcome = await writesByAccount.runAll(keys, async () => {
      const holder = await findDevByLogin(user.github_username);
      if (!sameHolder(holder, expected)) return RETRY;
      return task(holder);
    });
    if (outcome !== RETRY) return outcome;
  }
  throw new Error('Could not take the developer login: too many concurrent changes');
}

/**
 * Moves a dev off a login GitHub has given to someone else: its github_username becomes its
 * placeholder and it is marked stale, only if it still shows that login and its login state is
 * older than `readAt`. A name that was only the old login is cleared (clients show a neutral
 * name). Nothing else changes. Announced as dev-updated.
 * @param {object} holder - the dev showing the login
 * @param {Date} readAt - when GitHub said the login belongs to someone else
 * @returns {Promise<boolean>} true if displaced
 */
async function displace(holder, readAt) {
  const filter = {
    _id: holder._id,
    github_id: isLegacy(holder) ? null : holder.github_id,
    github_username: holder.github_username,
    ...olderThan(readAt),
  };
  const set = {
    github_username: staleLogin(holder),
    github_username_stale: true,
    github_username_seen_at: readAt,
  };
  if (sameLoginText(holder.name, holder.github_username)) set.name = null;
  const displaced = await Dev.findOneAndUpdate(filter, { $set: set }, { returnDocument: 'after' });
  if (!displaced) return false;
  announceStored(EVENT.DEV_UPDATED, displaced);
  return true;
}

/**
 * Inside inLoginOrder: displaces `holder` if it is another account's dev (or a legacy dev, when
 * the user already owns one) whose login state is older than the user's GitHub read.
 * @param {AccountIdentity & { login_read_at: number }} user
 * @param {object | null} holder - the dev showing the user's login (locked by inLoginOrder)
 * @param {object | null} own - the user's own dev, if any
 * @returns {Promise<'none' | 'displaced' | 'newer' | 'changed'>} `none`: nothing to displace
 *   (no holder, the user's own dev, or a legacy dev the user may claim); `newer`: the holder's
 *   state is at least as recent, left alone; `changed`: the conditional update missed (retry)
 */
async function displaceStaleHolder(user, holder, own) {
  if (!holder || holder.github_id === user.github_id) return 'none';
  if (own && String(own._id) === String(holder._id)) return 'none';
  // A legacy dev with this login is this account's to claim, unless it already owns a dev.
  if (isLegacy(holder) && !own) return 'none';
  const readAt = loginReadAt(user);
  const seenAt = holder.github_username_seen_at;
  if (seenAt && seenAt >= readAt) return 'newer';
  return await displace(holder, readAt) ? 'displaced' : 'changed';
}

/**
 * At sign-in, with GitHub's fresh answer (login `github_username` belongs to `github_id`, read at
 * `login_read_at`): displace any other dev that still shows this login with an older state, then
 * refresh the account's own dev to it. Legacy devs are not claimed here (only on their owner's
 * first write). Best effort: a failure is logged and never fails the sign-in.
 * @param {AccountIdentity & { login_read_at: number }} user
 * @returns {Promise<void>}
 */
async function refreshLoginAtSignIn(user) {
  try {
    await inLoginOrder(user, async (holder) => {
      const own = await findDevByAccount(user);
      const displacement = await displaceStaleHolder(user, holder, own);
      if (displacement === 'changed') return RETRY;
      // An older read than the holder's state: this session is the stale one; change nothing.
      if (displacement === 'newer') return undefined;
      if (own) {
        const result = await refreshLogin(own, user);
        if (result.renamed) announceStored(EVENT.DEV_UPDATED, result.dev);
      }
      return undefined;
    });
  } catch (err) {
    console.error('Could not refresh the developer login at sign-in:', err.message);
  }
}

module.exports = {
  OWNERSHIP,
  DUPLICATE_KEY,
  STALE_LOGIN_PREFIX,
  RETRY,
  isDuplicateKey,
  resolveOwnDev,
  loginFields,
  refreshLogin,
  updateOwnDev,
  inAccountOrder,
  inLoginOrder,
  displaceStaleHolder,
  refreshLoginAtSignIn,
  pendingWrites: () => writesByAccount.size(),
};
