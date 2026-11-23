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
//                if it is still absent, the login unchanged and the stored avatar_url still gives
//                the guard's answer (avatarAsRead), so of two accounts claiming at once exactly
//                one wins (`claimed`). Reads do not claim (`legacy`, read-only). Unless it is
//                GUARDED against the user: its stored avatar_url is a string carrying another
//                account's GitHub id (utils/githubAvatarId.js; pre-sign-in
//                registrations stored the avatar of the account holding the login then, so the
//                login has changed hands since). A guarded dev is rule 3 (spec 05, B1).
//   3. conflict  otherwise, a dev with ANOTHER github_id but this login, or a guarded legacy dev.
//                It is never theirs: no read, update or delete. On POST /devs, if this session's
//                GitHub read is newer than that dev's login state, that dev is displaced (below)
//                and the user registers; otherwise 409 github_username_conflict (logins are
//                unique across all profiles, and the other dev's login was confirmed by a newer
//                read).
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
//     newer write. A legacy dev is displaced only by an account that already owns a dev or that
//     it is guarded against (otherwise it is that account's to claim, rule 2), also at sign-in.
//     Each refused claim and each guarded displacement logs one warning (ids and login only).
//     A dev with a NEWER state is never touched: the older session keeps its stored login (PUT)
//     or gets 409 (POST).
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
// A write that runs out of attempts (resolveOwnDev's claim loop or inLoginOrder) throws
// ProfileBusyError, which the error handler answers 503 profile_busy (Retry-After: 1): every
// write here is one conditional update, so nothing was half-done and a retry can succeed.
const Dev = require('../models/Dev');
const { GITHUB_USERNAME_COLLATION } = require('../utils/githubUsername');
const { AVATAR_ID_STATUS, legacyAvatarEvidence } = require('../utils/githubAvatarId');
const { createKeyedQueue } = require('../utils/keyedQueue');
const { ProfileBusyError } = require('../utils/profileBusyError');
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

// The stored document each dev found by login was hydrated from (findDevByLogin). Mongoose casts
// fields when it reads a dev: a hand-edited non-string avatar_url can come out as a URL string
// (a BSON Binary's toString(), an embedded document's _id), and a non-ObjectId _id as undefined.
// The claim guard, its filters and its log use what is really stored (QA-CG-1, QA-CG-3).
const storedDocs = new WeakMap();

/**
 * @param {string} login
 * @returns {Promise<object | null>} the dev showing `login`, case-insensitively (one read of the
 *   stored document, hydrated; the stored document is kept for storedAvatar/storedId)
 */
async function findDevByLogin(login) {
  const stored = await Dev.collection.findOne({ github_username: login }, { collation: GITHUB_USERNAME_COLLATION });
  if (!stored) return null;
  const dev = Dev.hydrate(stored);
  storedDocs.set(dev, stored);
  return dev;
}

/**
 * @param {object} dev
 * @returns {object} the document `dev` was read from (the dev itself if it was not read by login)
 */
function storedDoc(dev) {
  return storedDocs.get(dev) || dev;
}

/**
 * The avatar evidence of a dev as stored: only a stored string can be a GitHub avatar URL (the
 * operator CLI reads stored documents the same way). Legacy as the rest of this module decides
 * it (isLegacy on the dev as read).
 * @param {object} dev
 * @returns {ReturnType<typeof legacyAvatarEvidence>}
 */
function storedAvatarEvidence(dev) {
  return legacyAvatarEvidence({ github_id: dev.github_id, avatar_url: storedDoc(dev).avatar_url });
}

/**
 * The claim guard (rule 2, spec 05 B1), for a dev already known to show the user's login.
 * Only a legacy dev's avatar is evidence (legacyAvatarEvidence); without a parseable id, or with
 * the user's own, nothing changes. The guard only refuses: it never makes a dev claimable.
 * @param {object} dev
 * @param {AccountIdentity} user
 * @returns {number | null} the GitHub id in the legacy dev's avatar if it is another account's
 *   (the dev is guarded against the user), else null
 */
function guardingAvatarId(dev, user) {
  const evidence = storedAvatarEvidence(dev);
  if (evidence.status !== AVATAR_ID_STATUS.PARSED || evidence.id === user.github_id) return null;
  return evidence.id;
}

// avatar_url holds no string (missing, null, any other BSON type; an array even if it holds
// strings, which $type alone would match): never evidence.
const NOT_A_STRING_AVATAR = [{ avatar_url: { $not: { $type: 'string' } } }, { avatar_url: { $type: 'array' } }];

/**
 * A filter part: the dev's stored avatar_url still gives the evidence the guard decided on, so a
 * change between the read and the conditional write makes the write miss (and the caller look
 * again). A stored string must be exactly the same string; when the guard found no evidence, any
 * stored value that is not a string (no evidence either) also matches, and so does no value at
 * all. A non-string is never compared by value: Mongoose would cast the filter value, not the
 * stored one. (In `$and`, so it can be spread next to another `$or`, e.g. olderThan's.)
 * @param {object} dev - as read (findDevByLogin)
 * @returns {object}
 */
function avatarAsRead(dev) {
  const stored = storedDoc(dev).avatar_url;
  if (typeof stored === 'string' && storedAvatarEvidence(dev).status === AVATAR_ID_STATUS.PARSED) {
    return { avatar_url: stored };
  }
  const alternatives = typeof stored === 'string' ? [{ avatar_url: stored }, ...NOT_A_STRING_AVATAR] : NOT_A_STRING_AVATAR;
  return { $and: [{ $or: alternatives }] };
}

/**
 * @param {unknown} value
 * @returns {string} `value` for a log line: printable ASCII only (hand-edited data can hold a
 *   string _id with control characters), at most 64 characters
 */
function printable(value) {
  return String(value).replace(/[^ -~]/g, '?').slice(0, 64);
}

/**
 * One warning per refused claim or guarded displacement: the dev's _id, the login, the
 * claiming account and the avatar's account. Never the avatar URL, a token, a name or a body.
 * @param {string} what
 * @param {object} dev
 * @param {AccountIdentity} user
 * @param {number} avatarId
 */
function logGuarded(what, dev, user, avatarId) {
  console.warn(
    `Legacy developer ${what}: its avatar names another GitHub account `
    + `(dev ${printable(storedDoc(dev)._id)}, login ${user.github_username}, account ${user.github_id}, avatar id ${avatarId})`
  );
}

/**
 * Applies the ownership rules above. Never returns another account's dev.
 * @param {AccountIdentity} user
 * @param {{ claim?: boolean }} [options] - claim a legacy dev (writes; needs `login_read_at`)
 * @returns {Promise<Ownership>}
 * @throws {ProfileBusyError} only with `claim`: the claim lost MAX_ATTEMPTS races in a row. A
 *   read (no claim) answers in the first round, so GET /devs/me never throws it.
 */
async function resolveOwnDev(user, { claim = false } = {}) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const own = await findDevByAccount(user);
    if (own) return { status: OWNERSHIP.OWN, dev: own };

    const sameLogin = await findDevByLogin(user.github_username);
    if (!sameLogin) return { status: OWNERSHIP.NONE, dev: null };
    if (!isLegacy(sameLogin)) return { status: OWNERSHIP.CONFLICT, dev: null };
    const avatarId = guardingAvatarId(sameLogin, user);
    if (avatarId !== null) {
      // Registered by another GitHub account (its avatar): treated as that account's (rule 3).
      // A read does not log (GET /devs/me runs on every page load).
      if (claim) logGuarded('claim refused', sameLogin, user, avatarId);
      return { status: OWNERSHIP.CONFLICT, dev: null };
    }
    if (!claim) return { status: OWNERSHIP.LEGACY, dev: sameLogin };

    let claimed = null;
    try {
      // Still legacy, still showing this login (a displacing sign-in may have moved it) and still
      // with the avatar the guard read (B1). Takes the login as GitHub spells it now, and records
      // when that was read (QA-AUTH6-2).
      claimed = await Dev.findOneAndUpdate(
        {
          _id: sameLogin._id,
          github_id: null,
          github_username: sameLogin.github_username,
          ...avatarAsRead(sameLogin),
        },
        { $set: { github_id: user.github_id, ...loginFields(user) }, $unset: { github_username_stale: 1 } },
        { returnDocument: 'after' }
      );
    } catch (err) {
      // The account got a dev of its own meanwhile (github_id index): the next round finds it.
      if (!isDuplicateKey(err)) throw err;
    }
    if (claimed) return { status: OWNERSHIP.CLAIMED, dev: claimed };
    // Claimed by another account, displaced, deleted, its avatar changed, or ours by now: look
    // again.
  }
  throw new ProfileBusyError('Could not resolve the developer profile owner: too many concurrent changes');
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
// Returned by an inLoginOrder task that displaced the login's holder and must start over to take
// the freed login. Progress, not a lost race: it does not use up one of the MAX_ATTEMPTS
// (QA-CG-2), but the rounds are capped by MAX_ROUNDS all the same.
const DISPLACED = Symbol('displaced');
// Every round either loses a race (RETRY, at most MAX_ATTEMPTS) or displaces a dev off the login
// for good (DISPLACED): each needs another concurrent write. A hard cap, so nothing loops forever.
const MAX_ROUNDS = 3 * MAX_ATTEMPTS;

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
 * or the task returns RETRY, everything starts over (at most MAX_ATTEMPTS times); a task that
 * returns DISPLACED starts over without using up an attempt (at most MAX_ROUNDS rounds in all).
 * @template T
 * @param {AccountIdentity} user
 * @param {(holder: object | null) => Promise<T | typeof RETRY | typeof DISPLACED>} task -
 *   `holder`: the dev showing the user's login now (any owner, possibly the user's own, or
 *   legacy), or null
 * @returns {Promise<T>}
 * @throws {ProfileBusyError} after MAX_ATTEMPTS lost races or MAX_ROUNDS rounds
 */
async function inLoginOrder(user, task) {
  let attempts = 0;
  for (let round = 0; round < MAX_ROUNDS && attempts < MAX_ATTEMPTS; round += 1) {
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
    if (outcome === RETRY) attempts += 1;
    else if (outcome !== DISPLACED) return outcome;
  }
  throw new ProfileBusyError('Could not take the developer login: too many concurrent changes');
}

/**
 * Moves a dev off a login GitHub has given to someone else: its github_username becomes its
 * placeholder and it is marked stale, only if it still shows that login and its login state is
 * older than `readAt`. A name that was only the old login is cleared (clients show a neutral
 * name). Nothing else changes. Announced as dev-updated.
 * @param {object} holder - the dev showing the login
 * @param {Date} readAt - when GitHub said the login belongs to someone else
 * @param {object} [also] - more filter conditions (a guarded dev: its avatar as read)
 * @returns {Promise<boolean>} true if displaced
 */
async function displace(holder, readAt, also = {}) {
  const filter = {
    _id: holder._id,
    github_id: isLegacy(holder) ? null : holder.github_id,
    github_username: holder.github_username,
    ...olderThan(readAt),
    ...also,
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
 * the user already owns one or it is guarded against the user) whose login state is older than
 * the user's GitHub read.
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
  // A legacy dev with this login is this account's to claim, unless it already owns a dev or
  // the dev's avatar names another account (B1).
  const avatarId = isLegacy(holder) && !own ? guardingAvatarId(holder, user) : null;
  if (isLegacy(holder) && !own && avatarId === null) return 'none';
  const readAt = loginReadAt(user);
  const seenAt = holder.github_username_seen_at;
  if (seenAt && seenAt >= readAt) return 'newer';
  // A guarded dev is displaced only with the avatar the guard read.
  const displaced = await displace(holder, readAt, avatarId === null ? {} : avatarAsRead(holder));
  if (!displaced) return 'changed';
  if (avatarId !== null) logGuarded('displaced', holder, user, avatarId);
  return 'displaced';
}

/**
 * At sign-in, with GitHub's fresh answer (login `github_username` belongs to `github_id`, read at
 * `login_read_at`): displace any other dev that still shows this login with an older state, then
 * refresh the account's own dev to it. Legacy devs are not claimed here (only on their owner's
 * first write), and only displaced if the account owns a dev or they are guarded against it.
 * Best effort: a failure is logged and never fails the sign-in.
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
  DISPLACED,
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
