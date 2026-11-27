// Which dev belongs to the signed-in GitHub account, and which login each dev shows (auth spec
// Q5, Q10, US-8). Used by every /devs/me route, by POST /devs and by sign-in (AuthController),
// so the rules live in one place.
//
// A profile belongs to a GitHub account by its numeric id (`github_id`), never by its login:
// logins can be renamed and later registered by someone else. For the signed-in user
// `{ github_id, github_username }` (req.user):
//   1. own       a dev whose stored github_id names the user's id (utils/githubId.js
//                storedGithubId: a number of any BSON numeric type, or the canonical string
//                "222"). It is theirs; their next write stores the plain number.
//   2. legacy    otherwise, a dev whose stored github_id names NO account (field missing, null,
//                or a hand-edited "", "not-a-number", 0, ...; the CLI uses the same rule) whose login matches
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
// events follow the database order. The queue and the announcer are the server instance's
// (serverContext.js, handed in through createDevOwnership): per server instance; a shared
// (cross-instance) lock arrives in a later phase. Taking a login (inLoginOrder) may touch the holder's dev, so
// it looks the holder up first and holds both accounts' keys, taken in sorted order: no two
// tasks can wait for each other, so swaps cannot deadlock. Under the keys it re-checks the
// holder and starts over (at most three times) if it changed. Legacy devs have no account key;
// their claim and their displacement are conditional updates that exclude each other.
// A write that runs out of attempts (resolveOwnDev's claim loop or inLoginOrder) throws
// ProfileBusyError, which the error handler answers 503 profile_busy (Retry-After: 1): the
// caller's own profile is unchanged and a retry can succeed. Displacements of older holders done
// in earlier rounds stay, and were pushed.
//
// Stored values (QA-PB-1): every conditional write matches the dev by the values STORED in it
// (read with the driver and kept in storedDocs), never by what Mongoose made of them. Mongoose
// reads a hand-edited non-ObjectId _id as undefined and a github_id that is no number as
// undefined or null, and it casts (or refuses) filter values the same way, so a filter built from
// the hydrated dev could never match and every retry would miss. A filter on such a value goes to
// the driver instead (writeStored). A miss on a document that has not changed since it was read
// and that the filter does not match is not contention: it is a plain error (500, naming the
// stored _id), never "busy, try again".
const mongoose = require('mongoose');
const Dev = require('../models/Dev');
const { hydrateStored } = require('../models/utils/hydrateStored');
const { GITHUB_USERNAME_COLLATION, STALE_LOGIN_PREFIX, staleLoginFor } = require('../utils/githubUsername');
const { AVATAR_ID_STATUS, legacyAvatarEvidence } = require('../utils/githubAvatarId');
const { storedGithubId, storedGithubIdForms } = require('../utils/githubId');
const { ProfileBusyError } = require('../utils/profileBusyError');
const { EVENT } = require('./devEvents');

// MongoDB duplicate-key error: a unique index (github_id or github_username) refused a write.
const DUPLICATE_KEY = 11000;

// A resolution that keeps losing races (a claim taken or a dev changed between our read and our
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
 * @param {object} dev
 * @returns {number | null} the GitHub account the dev belongs to, by its STORED github_id
 *   (utils/githubId.js storedGithubId, the rule the operator CLI shares: any numeric BSON type or
 *   the canonical string "222" is ownership), or null for a legacy dev
 */
function ownerId(dev) {
  return storedGithubId(storedDoc(dev).github_id);
}

/**
 * @param {object} dev
 * @returns {boolean} true for a legacy dev: its stored github_id names no account (missing, null,
 *   "", "not-a-number", 0, a negative or fractional number, ...)
 */
function isLegacy(dev) {
  return ownerId(dev) === null;
}

/**
 * @param {object} dev - a dev the account owns
 * @param {AccountIdentity} user
 * @returns {object} `$set` fields that store the owner's github_id as the plain number when the
 *   stored form is another one ("222", a Decimal128, an unpromoted Long); empty otherwise, so a
 *   normal write is unchanged
 */
function normalizedOwner(dev, user) {
  return typeof storedDoc(dev).github_id === 'number' ? {} : { github_id: user.github_id };
}

/**
 * @param {object} dev
 * @returns {unknown} the dev's _id as stored (an ObjectId, or a hand-edited string, ...)
 */
function storedId(dev) {
  return storedDoc(dev)._id;
}

/**
 * @param {object} dev
 * @returns {string} the placeholder login of a displaced dev (utils/githubUsername.js, shared with
 *   the operator CLI's restore)
 */
function staleLogin(dev) {
  return staleLoginFor(storedId(dev));
}

// --- Filters on stored values (QA-PB-1) ----------------------------------------------------------

const { ObjectId } = mongoose.Types;
const { EJSON } = mongoose.mongo.BSON;

/**
 * @param {string} path
 * @param {unknown} value - a stored value (never undefined or null here)
 * @returns {boolean} true if Mongoose casts `value` in a filter on `path` to itself, so the filter
 *   can go through the model (and its test hooks) unchanged
 */
function castsUnchanged(path, value) {
  if (path === '_id') return value instanceof ObjectId;
  if (path === 'github_id') return typeof value === 'number' && !Number.isNaN(value);
  return typeof value === 'string';
}

/**
 * A filter part matching the dev's stored values of `paths` exactly: null for a missing or null
 * value (matches both, the legacy rule), the value itself when Mongoose leaves it unchanged, else
 * `{ $eq: value }` (only the driver can match it; see writeStored).
 * @param {object} dev - as read
 * @param {string[]} paths
 * @returns {object}
 */
function asStored(dev, paths) {
  const stored = storedDoc(dev);
  return Object.fromEntries(paths.map((path) => {
    const value = stored[path];
    if (value === undefined || value === null) return [path, null];
    return [path, castsUnchanged(path, value) ? value : { $eq: value }];
  }));
}

/**
 * @param {object} filter
 * @returns {boolean} true if Mongoose would match `filter` exactly as written (every field value
 *   passes castsUnchanged; operator parts are built from values Mongoose leaves alone)
 */
function forTheModel(filter) {
  return Object.entries(filter).every(([path, value]) => path.startsWith('$') || value === null || castsUnchanged(path, value));
}

/**
 * Hydrates a stored document with its stored _id (models/utils/hydrateStored.js) and keeps it
 * (storedDoc), so responses, events, placeholders and filters name the real document.
 * @param {object} stored
 * @returns {object} the dev
 */
function remember(stored) {
  const dev = hydrateStored(Dev, stored);
  storedDocs.set(dev, stored);
  return dev;
}

/**
 * @param {object} filter - driver-safe (built with asStored)
 * @returns {Promise<object | null>} the stored dev matching `filter`, hydrated and remembered
 */
async function findStored(filter) {
  const stored = await Dev.collection.findOne(filter);
  return stored ? remember(stored) : null;
}

/**
 * A conditional update: through the model when it can match the filter as written (the normal
 * case), else with the driver (a hand-edited stored value). The driver path neither casts nor
 * validates the update, so it is only used for values this module builds.
 * @param {object} filter
 * @param {object} update
 * @param {object} [options] - extra model options (e.g. runValidators)
 * @returns {Promise<object | null>} the dev after the update, or null if nothing matched
 */
async function writeStored(filter, update, options = {}) {
  if (forTheModel(filter)) return Dev.findOneAndUpdate(filter, update, { returnDocument: 'after', ...options });
  const stored = await Dev.collection.findOneAndUpdate(filter, update, { returnDocument: 'after' });
  return stored ? remember(stored) : null;
}

/**
 * @param {object} filter
 * @returns {Promise<object | null>} the deleted dev, or null if nothing matched
 */
async function deleteStored(filter) {
  if (forTheModel(filter)) return Dev.findOneAndDelete(filter);
  const stored = await Dev.collection.findOneAndDelete(filter);
  return stored ? remember(stored) : null;
}

/**
 * After a conditional write on `dev` missed: true if the miss can never turn into a match, i.e.
 * the stored document is exactly as it was read and the filter does not match it (hand-edited
 * data the filter cannot express, not a concurrent change). Retrying that is pointless, so the
 * caller fails with a plain error (500) instead of looking again.
 * @param {object} dev - as read (remembered); a dev without a stored copy is never judged
 * @param {object} filter - the write's filter (driver-safe)
 * @returns {Promise<boolean>}
 */
async function missesForGood(dev, filter) {
  const stored = storedDocs.get(dev);
  if (!stored) return false;
  const byId = { _id: { $eq: stored._id } };
  const now = await Dev.collection.findOne(byId);
  if (!now || EJSON.stringify(now, { relaxed: false }) !== EJSON.stringify(stored, { relaxed: false })) return false;
  return !(await Dev.collection.findOne({ $and: [byId, filter] }, { projection: { _id: 1 } }));
}

/**
 * @param {object} dev
 * @param {string} what - e.g. "claimed"
 * @returns {Error} the 500 for a write that can never match (logged with the stored _id by the
 *   error handler; never a request body)
 */
function cannotWrite(dev, what) {
  return new Error(
    `Developer ${printable(storedId(dev))} cannot be ${what}: its stored document never matches the conditional update (hand-edited data)`
  );
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
 * @returns {Promise<object | null>} the dev that belongs to the account by id (rule 1), read
 *   from the stored document (remembered)
 */
async function findDevByAccount(user) {
  // Every stored form ownerId reads as this account (storedGithubId): any numeric BSON type,
  // matched by value, first; then the canonical string. The plain number is the normal form.
  for (const form of storedGithubIdForms(user.github_id)) {
    const dev = await findStored({ github_id: form });
    if (dev) return dev;
  }
  return null;
}

/**
 * @param {object} dev - a dev the account owns
 * @param {AccountIdentity} user
 * @returns {object} a filter: this dev (stored _id), still the account's in the github_id form it
 *   was read with (a plain number for every normal dev, so the filter is as before)
 */
function ownedBy(dev, user) {
  const github_id = ownerId(dev) === user.github_id ? asStored(dev, ['github_id']).github_id : user.github_id;
  return { ...asStored(dev, ['_id']), github_id };
}

// The stored document each dev read here was hydrated from (remember). Mongoose casts fields
// when it reads a dev: a hand-edited non-string avatar_url can come out as a URL string (a BSON
// Binary's toString(), an embedded document's _id), a non-ObjectId _id as undefined, a github_id
// that is no number as undefined or null. The claim guard, every conditional filter and the logs
// use what is really stored (QA-CG-1, QA-CG-3, QA-PB-1).
const storedDocs = new WeakMap();

/**
 * @param {string} login
 * @returns {Promise<object | null>} the dev showing `login`, case-insensitively (one read of the
 *   stored document, hydrated and remembered)
 */
async function findDevByLogin(login) {
  const stored = await Dev.collection.findOne({ github_username: login }, { collation: GITHUB_USERNAME_COLLATION });
  return stored ? remember(stored) : null;
}

/**
 * @param {object} dev
 * @returns {object} the document `dev` was read from (the dev itself if this module did not read
 *   it from the stored document: a model write's result, which needs no casting fix-up)
 */
function storedDoc(dev) {
  return storedDocs.get(dev) || dev;
}

/**
 * The avatar evidence of a dev as stored: only a stored string can be a GitHub avatar URL (the
 * operator CLI reads stored documents the same way). Legacy as the rest of this module decides
 * it (isLegacy, on the stored github_id).
 * @param {object} dev
 * @returns {ReturnType<typeof legacyAvatarEvidence>}
 */
function storedAvatarEvidence(dev) {
  return legacyAvatarEvidence({ github_id: storedDoc(dev).github_id, avatar_url: storedDoc(dev).avatar_url });
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
    let lostToOwnDev = false;
    // Still legacy, still showing this login (a displacing sign-in may have moved it) and still
    // with the avatar the guard read (B1), all as stored (a hand-edited github_id that is no id
    // is replaced by the account's). Takes the login as GitHub spells it now, and records when
    // that was read (QA-AUTH6-2).
    const filter = {
      ...asStored(sameLogin, ['_id', 'github_id', 'github_username']),
      ...avatarAsRead(sameLogin),
    };
    try {
      claimed = await writeStored(
        filter,
        { $set: { github_id: user.github_id, ...loginFields(user) }, $unset: { github_username_stale: 1 } }
      );
    } catch (err) {
      // The account got a dev of its own meanwhile (github_id index): the next round finds it.
      if (!isDuplicateKey(err)) throw err;
      lostToOwnDev = true;
    }
    if (claimed) return { status: OWNERSHIP.CLAIMED, dev: claimed };
    if (!lostToOwnDev && await missesForGood(sameLogin, filter)) throw cannotWrite(sameLogin, 'claimed');
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
  const mine = ownedBy(dev, user);
  const filter = { ...mine, ...olderThan(readAt) };

  if (dev.github_username === user.github_username) {
    // Same login: only record the newer confirmation (also when none was recorded, QA-AUTH6-2).
    const confirmed = await writeStored(filter, { $set: { github_username_seen_at: readAt, ...normalizedOwner(dev, user) } });
    return { dev: confirmed || await findStored(mine), renamed: false };
  }

  const set = { ...loginFields(user), ...normalizedOwner(dev, user) };
  if (!dev.name || sameLoginText(dev.name, dev.github_username)) {
    set.name = (user.profile && user.profile.name) || user.github_username;
  }
  let renamed = null;
  try {
    renamed = await writeStored(filter, { $set: set, $unset: { github_username_stale: 1 } });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    console.error('A developer login could not be refreshed: another developer still uses it');
  }
  if (renamed) return { dev: renamed, renamed: true };
  // Not renamed: a newer read is stored, the login is taken, or the dev is gone.
  return { dev: await findStored(mine), renamed: false };
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
  return writeStored(
    ownedBy(current, user),
    { $set: { ...fields, ...normalizedOwner(current, user) } },
    { runValidators: true }
  );
}

/**
 * Deletes the account's dev (DELETE /devs/me), matched by its stored _id and the account.
 * @param {object} dev - a dev the account owns (resolveOwnDev)
 * @param {AccountIdentity} user
 * @returns {Promise<object | null>} the deleted dev, or null if it was gone already
 */
function deleteOwnDev(dev, user) {
  return deleteStored(ownedBy(dev, user));
}

// The server instance's write queue (serverContext.js `writesByAccount`, utils/keyedQueue.js).
/** @typedef {ReturnType<typeof import('../utils/keyedQueue').createKeyedQueue>} WriteQueue */

/** @param {number} githubId @returns {string} */
function accountKey(githubId) {
  return `github_id:${githubId}`;
}

/**
 * Runs `task` (database writes and their announcements) after every write already queued for the
 * same GitHub account. For writes that never change a login (DELETE).
 * @template T
 * @param {WriteQueue} writesByAccount
 * @param {AccountIdentity} user
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function inAccountOrder(writesByAccount, user, task) {
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
  return sameStoredId(a, b) && ownerId(a) === ownerId(b);
}

/**
 * @param {object} a
 * @param {object} b
 * @returns {boolean} true if both are the same stored document (same _id value and BSON type)
 */
function sameStoredId(a, b) {
  return EJSON.stringify(storedId(a), { relaxed: false }) === EJSON.stringify(storedId(b), { relaxed: false });
}

/**
 * Runs `task(holder)` for a write that may take the account's login: holding the account's key
 * and, if another account's dev shows the login (`holder`), that account's key too, taken in
 * sorted order (keyedQueue.runAll). Under the keys the holder is looked up again; if it changed,
 * or the task returns RETRY, everything starts over (at most MAX_ATTEMPTS times); a task that
 * returns DISPLACED starts over without using up an attempt (at most MAX_ROUNDS rounds in all).
 * @template T
 * @param {WriteQueue} writesByAccount
 * @param {AccountIdentity} user
 * @param {(holder: object | null) => Promise<T | typeof RETRY | typeof DISPLACED>} task -
 *   `holder`: the dev showing the user's login now (any owner, possibly the user's own, or
 *   legacy), or null
 * @returns {Promise<T>}
 * @throws {ProfileBusyError} after MAX_ATTEMPTS lost races or MAX_ROUNDS rounds
 */
async function inLoginOrder(writesByAccount, user, task) {
  let attempts = 0;
  for (let round = 0; round < MAX_ROUNDS && attempts < MAX_ATTEMPTS; round += 1) {
    const expected = await findDevByLogin(user.github_username);
    const keys = [accountKey(user.github_id)];
    if (expected && !isLegacy(expected) && ownerId(expected) !== user.github_id) {
      keys.push(accountKey(ownerId(expected)));
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
 * @param {import('./devEvents').DevEvents} events - the server instance's announcer
 * @param {object} holder - the dev showing the login
 * @param {Date} readAt - when GitHub said the login belongs to someone else
 * @param {object} [also] - more filter conditions (a guarded dev: its avatar as read)
 * @returns {Promise<boolean>} true if displaced
 * @throws {Error} if the stored holder can never match the update (missesForGood), a 500
 */
async function displace(events, holder, readAt, also = {}) {
  const filter = {
    ...asStored(holder, ['_id', 'github_id', 'github_username']),
    ...olderThan(readAt),
    ...also,
  };
  const set = {
    github_username: staleLogin(holder),
    github_username_stale: true,
    github_username_seen_at: readAt,
  };
  if (sameLoginText(holder.name, holder.github_username)) set.name = null;
  const displaced = await writeStored(filter, { $set: set });
  if (!displaced) {
    // E.g. a hand-edited github_username_seen_at that is no date: olderThan never matches it.
    if (await missesForGood(holder, filter)) throw cannotWrite(holder, 'displaced');
    return false;
  }
  events.announceStored(EVENT.DEV_UPDATED, displaced);
  return true;
}

/**
 * Inside inLoginOrder: displaces `holder` if it is another account's dev (or a legacy dev, when
 * the user already owns one or it is guarded against the user) whose login state is older than
 * the user's GitHub read.
 * @param {import('./devEvents').DevEvents} events - the server instance's announcer
 * @param {AccountIdentity & { login_read_at: number }} user
 * @param {object | null} holder - the dev showing the user's login (locked by inLoginOrder)
 * @param {object | null} own - the user's own dev, if any
 * @returns {Promise<'none' | 'displaced' | 'newer' | 'changed'>} `none`: nothing to displace
 *   (no holder, the user's own dev, or a legacy dev the user may claim); `newer`: the holder's
 *   state is at least as recent, left alone; `changed`: the conditional update missed (retry)
 */
async function displaceStaleHolder(events, user, holder, own) {
  if (!holder || ownerId(holder) === user.github_id) return 'none';
  if (own && sameStoredId(own, holder)) return 'none';
  // A legacy dev with this login is this account's to claim, unless it already owns a dev or
  // the dev's avatar names another account (B1).
  const avatarId = isLegacy(holder) && !own ? guardingAvatarId(holder, user) : null;
  if (isLegacy(holder) && !own && avatarId === null) return 'none';
  const readAt = loginReadAt(user);
  const seenAt = holder.github_username_seen_at;
  if (seenAt && seenAt >= readAt) return 'newer';
  // A guarded dev is displaced only with the avatar the guard read.
  const displaced = await displace(events, holder, readAt, avatarId === null ? {} : avatarAsRead(holder));
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
 * @param {{ writesByAccount: WriteQueue, events: import('./devEvents').DevEvents }} instance
 * @param {AccountIdentity & { login_read_at: number }} user
 * @returns {Promise<void>}
 */
async function refreshLoginAtSignIn({ writesByAccount, events }, user) {
  try {
    await inLoginOrder(writesByAccount, user, async (holder) => {
      const own = await findDevByAccount(user);
      const displacement = await displaceStaleHolder(events, user, holder, own);
      if (displacement === 'changed') return RETRY;
      // An older read than the holder's state: this session is the stale one; change nothing.
      if (displacement === 'newer') return undefined;
      if (own) {
        const result = await refreshLogin(own, user);
        if (result.renamed) events.announceStored(EVENT.DEV_UPDATED, result.dev);
      }
      return undefined;
    });
  } catch (err) {
    console.error('Could not refresh the developer login at sign-in:', err.message);
  }
}

/**
 * The ownership operations that queue writes or announce them, bound to one server instance's
 * write queue and announcer (serverContext.js). Everything else in this module is stateless and
 * exported as is.
 * @param {{ writesByAccount: WriteQueue, events: import('./devEvents').DevEvents }} instance
 */
function createDevOwnership({ writesByAccount, events }) {
  return {
    /** @type {<T>(user: AccountIdentity, task: () => Promise<T>) => Promise<T>} */
    inAccountOrder: (user, task) => inAccountOrder(writesByAccount, user, task),
    /** @type {<T>(user: AccountIdentity, task: (holder: object | null) => Promise<T | typeof RETRY | typeof DISPLACED>) => Promise<T>} */
    inLoginOrder: (user, task) => inLoginOrder(writesByAccount, user, task),
    displaceStaleHolder: (user, holder, own) => displaceStaleHolder(events, user, holder, own),
    refreshLoginAtSignIn: (user) => refreshLoginAtSignIn({ writesByAccount, events }, user),
    /** @returns {number} accounts with a write queued or running on this instance (for tests) */
    pendingWrites: () => writesByAccount.size(),
  };
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
  deleteOwnDev,
  accountKey,
  createDevOwnership,
};
