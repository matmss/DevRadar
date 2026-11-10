// Which dev belongs to the signed-in GitHub account (auth spec Q5, Q10, US-8). Used by every
// /devs/me route, by POST /devs and by sign-in (AuthController), so the rules live in one place.
//
// A profile belongs to a GitHub account by its numeric id (`github_id`), never by its login:
// logins can be renamed and later registered by someone else. For the signed-in user
// `{ github_id, github_username }` (req.user):
//   1. own       a dev has github_id === the user's id. It is theirs; writes and sign-ins refresh
//                its login (never back to the login of a session older than the stored one).
//   2. legacy    otherwise, a dev WITHOUT a github_id whose login matches the user's
//                case-insensitively: created before sign-in existed. The owner of that login
//                claims it on their first write: github_id is set atomically, conditional on it
//                still being absent, so of two accounts claiming at once exactly one wins
//                (`claimed`). Reads do not claim (`legacy`, read-only).
//   3. conflict  otherwise, a dev with ANOTHER github_id but this login: its owner renamed their
//                GitHub account away and has not signed in since, and the login now belongs to
//                this user. It is never theirs: no read, update or delete. POST /devs answers
//                409 github_username_conflict, because the unique login index would refuse a
//                second dev with that login. The previous owner's next sign-in (or write)
//                refreshes their dev's login, which frees this one (refreshLoginAtSignIn).
//   4. none      otherwise.
// Nothing is migrated at deploy time: legacy devs are only touched when their owner writes.
//
// Writes run in a per-account queue (`inAccountOrder`, utils/keyedQueue.js), keyed by github_id,
// together with their socket announcement, so the live events follow the database order. Every
// write to a dev is made by its one owner (rule 1) or by the single winner of its claim (rule 2),
// so one account's queue orders every change to its dev.
const Dev = require('../models/Dev');
const { GITHUB_USERNAME_COLLATION } = require('../utils/githubUsername');
const { createKeyedQueue } = require('../utils/keyedQueue');
const { EVENT, announceStored } = require('./devEvents');

// MongoDB duplicate-key error: a unique index (github_id or github_username) refused a write.
const DUPLICATE_KEY = 11000;

// A resolution that keeps losing races (a claim taken or a dev deleted between our read and our
// write, each time) gives up instead of looping. Each extra attempt needs another concurrent
// write to the same records, so three is plenty.
const MAX_ATTEMPTS = 3;

const OWNERSHIP = Object.freeze({
  OWN: 'own',
  CLAIMED: 'claimed',
  LEGACY: 'legacy',
  CONFLICT: 'conflict',
  NONE: 'none',
});

/**
 * The signed-in account (req.user, utils/sessionToken.js SessionUser); `issued_at` is only read
 * when a login is stored.
 * @typedef {{ github_id: number, github_username: string, issued_at?: number }} AccountIdentity
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
 * @param {AccountIdentity} user
 * @returns {Promise<object | null>} the dev that belongs to the account by id (rule 1)
 */
function findDevByAccount(user) {
  return Dev.findOne({ github_id: user.github_id });
}

/**
 * Applies the ownership rules above. Never returns another account's dev.
 * @param {AccountIdentity} user
 * @param {{ claim?: boolean }} [options] - claim a legacy dev (writes); false for reads
 * @returns {Promise<Ownership>}
 */
async function resolveOwnDev(user, { claim = false } = {}) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const own = await findDevByAccount(user);
    if (own) return { status: OWNERSHIP.OWN, dev: own };

    const sameLogin = await Dev.findOne({ github_username: user.github_username }).collation(GITHUB_USERNAME_COLLATION);
    if (!sameLogin) return { status: OWNERSHIP.NONE, dev: null };
    if (sameLogin.github_id != null) return { status: OWNERSHIP.CONFLICT, dev: null };
    if (!claim) return { status: OWNERSHIP.LEGACY, dev: sameLogin };

    let claimed = null;
    try {
      claimed = await Dev.findOneAndUpdate(
        { _id: sameLogin._id, github_id: { $exists: false } },
        { $set: { github_id: user.github_id } },
        { returnDocument: 'after' }
      );
    } catch (err) {
      // The account got a dev of its own meanwhile (github_id index): the next round finds it.
      if (!isDuplicateKey(err)) throw err;
    }
    if (claimed) return { status: OWNERSHIP.CLAIMED, dev: claimed };
    // Claimed by another account, deleted, or ours by now: look again.
  }
  throw new Error('Could not resolve the developer profile owner: too many concurrent changes');
}

/**
 * @param {{ issued_at: number }} user
 * @returns {Date} when the user's session began
 */
function sessionStart(user) {
  return new Date(user.issued_at * 1000);
}

/**
 * The stored fields that record the account's current login (a new dev stores them).
 * @param {AccountIdentity & { issued_at: number }} user
 * @returns {{ github_username: string, github_username_seen_at: Date }}
 */
function loginFields(user) {
  return { github_username: user.github_username, github_username_seen_at: sessionStart(user) };
}

/**
 * Sets the dev's login to the session's (a GitHub rename, including a change of letter case),
 * unless the stored login came from a session that began later: an old token (valid up to 7
 * days) must not set back a rename that a newer sign-in already recorded. If another dev still
 * holds the login (a legacy dev, or one whose owner renamed away and has not signed in since),
 * the stored login is kept: refreshing is best effort and never touches the other dev.
 * @param {object} dev - a dev the account owns
 * @param {AccountIdentity & { issued_at: number }} user
 * @returns {Promise<{ dev: object | null, renamed: boolean }>} the dev as stored now (null if it
 *   was deleted meanwhile), and whether its login changed
 */
async function refreshLogin(dev, user) {
  if (dev.github_username === user.github_username) return { dev, renamed: false };
  let renamed = null;
  try {
    renamed = await Dev.findOneAndUpdate(
      {
        _id: dev._id,
        github_id: user.github_id,
        $or: [
          { github_username_seen_at: { $exists: false } },
          { github_username_seen_at: { $lte: sessionStart(user) } },
        ],
      },
      { $set: loginFields(user) },
      { returnDocument: 'after' }
    );
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    console.error('A developer login could not be refreshed: another developer still uses it');
  }
  if (renamed) return { dev: renamed, renamed: true };
  // Not renamed: a newer session's login is stored, the login is taken, or the dev is gone.
  return { dev: await Dev.findOne({ _id: dev._id, github_id: user.github_id }), renamed: false };
}

/**
 * Updates the account's dev with `fields`, after refreshing its login (refreshLogin), never
 * creating one.
 * @param {object} dev - a dev the account owns
 * @param {AccountIdentity & { issued_at: number }} user
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

/**
 * Runs `task` (a database write and its announcement) after every write already queued for the
 * same GitHub account.
 * @template T
 * @param {AccountIdentity} user
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function inAccountOrder(user, task) {
  return writesByAccount.run(`github_id:${user.github_id}`, task);
}

/**
 * At sign-in: if the account already owns a dev, refresh its login (a renamed account shows its
 * new login, and its old login is freed for whoever holds it now), and announce the change as
 * dev-updated. Legacy devs are not claimed here (only on their owner's first write). Best effort:
 * a failure is logged and never fails the sign-in.
 * @param {AccountIdentity} user
 * @returns {Promise<void>}
 */
async function refreshLoginAtSignIn(user) {
  try {
    await inAccountOrder(user, async () => {
      const dev = await findDevByAccount(user);
      if (!dev) return;
      const result = await refreshLogin(dev, user);
      if (result.renamed) announceStored(EVENT.DEV_UPDATED, result.dev);
    });
  } catch (err) {
    console.error('Could not refresh the developer login at sign-in:', err.message);
  }
}

module.exports = {
  OWNERSHIP,
  DUPLICATE_KEY,
  isDuplicateKey,
  resolveOwnDev,
  loginFields,
  refreshLogin,
  updateOwnDev,
  inAccountOrder,
  refreshLoginAtSignIn,
  pendingWrites: () => writesByAccount.size(),
};
