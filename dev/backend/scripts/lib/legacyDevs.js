// Operator commands for legacy and displaced developer profiles (dev/docs/04-legacy-merge-spec.md,
// option A). scripts/legacy-devs.js is the command line around them; the QA suite calls run()
// in-process against its ephemeral MongoDB.
//
// A legacy dev has no github_id (missing or null): it was created before sign-in existed. Its
// owner claims it by login on their first write (services/devOwnership.js), unless the login was
// given to an account that already has a profile, which DISPLACES it (`_stale_<_id>` login,
// github_username_stale: true). A displaced dev can no longer be claimed by anyone. These commands
// let an operator, after confirming with the owner, give a legacy dev to its owner's GitHub
// account (`assign`, when the owner has no profile) or retire it in favor of the owner's current
// profile (`merge`), with the GitHub id in the dev's avatar_url as a hint (utils/githubAvatarId.js).
//
// Safety rules (spec "Live events and queues", AC-14, AC-18, AC-22 to AC-25):
//  - Dry run unless --apply. Every refusal happens before any write.
//  - Runs outside the API process, so it cannot take the API's per-account queue keys
//    (keyedQueue). It never needs them: every write is ONE conditional single-document write
//    whose filter is the state the decision was made on (same _id, still no github_id, same
//    login), the same filters a claim and a displacement use. If the API claimed, displaced or
//    deleted the dev in between, the write matches nothing and the tool reports "changed since
//    read". A registration of the target account in between is refused by the github_id_unique
//    index (duplicate key), reported like "already has a profile".
//  - No Socket.io event is sent (the sockets live in the API process). Connected clients see the
//    change on their next search, reload or reconnect.
//  - Deletes print the full document as canonical Extended JSON first; `restore` inserts it back.
//  - Data from the database is printed with control and bidi characters escaped.
const fs = require('fs');
const mongoose = require('mongoose');
const Dev = require('../../src/models/Dev');
const { githubIdFromSubject, isValidGithubId } = require('../../src/utils/githubId');
const { AVATAR_ID_STATUS, legacyAvatarEvidence } = require('../../src/utils/githubAvatarId');

const { EJSON } = mongoose.mongo.BSON;

const EXIT = Object.freeze({
  OK: 0,
  REFUSED: 1, // a rule refused the change, or the data changed since it was read: nothing written
  USAGE: 2, // invalid command line (unknown option, malformed _id or GitHub id): nothing read
  FAILED: 3, // unexpected error (connection, database)
});

const DUPLICATE_KEY = 11000;
const GITHUB_ID_INDEX = 'github_id_unique';
const GITHUB_USERNAME_INDEX = 'github_username_unique_ci';
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const MAX_RESTORE_FILE_BYTES = 1024 * 1024;
const SCRIPT = 'node scripts/legacy-devs.js';

const NO_LIVE_EVENTS = 'No live event was sent (this tool cannot reach the API\'s sockets): connected '
  + 'clients see the change on their next search, reload or reconnect.';

const HELP = `Usage: ${SCRIPT} <command> [options]
Run from dev/backend. Reads MONGO_URI from the environment or dev/backend/.env (never from an
option). Dry run by default: nothing is written without --apply.

Commands:
  list [--json]
      Every legacy developer (no github_id): login, status (legacy | displaced), name,
      coordinates, techs, avatar_url, the GitHub id derived from the avatar (or "unparseable" /
      "none"), whether that account already has a profile, and duplicate avatar ids. Then counts
      by status, avatar id result and avatar host. Read-only.
  assign <dev _id> --github-id <id> [--force] [--apply]
  assign <dev _id> --from-avatar [--apply]
      Gives a legacy or displaced developer to a GitHub account that has no profile: sets its
      github_id, nothing else (the owner's next sign-in restores their current login).
      --github-id must match the avatar's id; if it does not, or the avatar has no id, --force is
      needed (confirm the owner's GitHub id with them first). --from-avatar uses the avatar's id
      and refuses when it is missing or shared by another legacy developer.
  merge <legacy dev _id> --into <dev _id> [--force] [--apply]
      The owner already has a profile: deletes the legacy developer and leaves the owner's
      profile exactly as it is. The legacy developer's avatar id must equal the profile's
      github_id unless --force. Prints the deleted document (canonical Extended JSON) to keep.
  restore <file> [--apply]
      Inserts back a document printed by merge (the file holds that one line), always as a
      DISPLACED developer: login _stale_<_id>, github_username_stale true, the original login
      printed. Nobody can claim it by login; give it to its owner with assign. The record must
      match the Dev schema and have no github_id; checked before connecting.
  help
      This text.

Exit codes: 0 done (or dry run), 1 refused or changed since read (nothing written),
2 invalid command line, 3 unexpected error.

No Socket.io event is ever sent: connected clients see changes on their next search, reload or
reconnect. Runbook: dev/docs/00-architecture.md ("Displaced legacy devs").`;

class CommandError extends Error {
  /**
   * @param {string} message
   * @param {number} exitCode
   */
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

const usage = (message) => new CommandError(message, EXIT.USAGE);
const refusal = (message) => new CommandError(`Refused, nothing was written: ${message}`, EXIT.REFUSED);

// --- Printing ------------------------------------------------------------------------------------

const BACKSLASH = String.fromCharCode(0x5c);

/**
 * C0/C1 controls, line/paragraph separators and bidi controls: printed as escapes so data in the
 * database (anonymous pre-auth input) cannot drive the operator's terminal or reorder its text.
 * @param {number} codePoint
 * @returns {boolean}
 */
function isUnsafeCodePoint(codePoint) {
  return codePoint < 0x20
    || (codePoint >= 0x7f && codePoint <= 0x9f)
    || codePoint === 0x061c
    || codePoint === 0x200e || codePoint === 0x200f
    || codePoint === 0x2028 || codePoint === 0x2029
    || (codePoint >= 0x202a && codePoint <= 0x202e)
    || (codePoint >= 0x2066 && codePoint <= 0x2069);
}

/**
 * @param {string} text
 * @returns {string} `text` with unsafe characters as JSON-style escapes (valid inside JSON strings)
 */
function escapeUnsafe(text) {
  let out = '';
  for (const char of String(text)) {
    const codePoint = char.codePointAt(0);
    out += isUnsafeCodePoint(codePoint) ? `${BACKSLASH}u${codePoint.toString(16).padStart(4, '0')}` : char;
  }
  return out;
}

/**
 * A last line of defense (QA-LM-1): every printed line is escaped again, line by line, so a value
 * that skipped show() still cannot reach the terminal raw. Escaped text is plain ASCII escapes, so
 * escaping it twice changes nothing.
 * @param {Output} out
 * @returns {Output}
 */
function safeOutput(out) {
  const escapeLines = (text) => String(text).split('\n').map(escapeUnsafe).join('\n');
  return { log: (text) => out.log(escapeLines(text)), error: (text) => out.error(escapeLines(text)) };
}

/** @param {unknown} value @returns {string} a database value for a human-readable line */
function show(value) {
  if (value === undefined || value === null || value === '') return '(none)';
  return escapeUnsafe(typeof value === 'string' ? value : JSON.stringify(value));
}

/**
 * @param {unknown} value - a stored techs value that is not an array (hand-edited data)
 * @returns {string} what it is, e.g. "(not an array: string)", or "(missing)"
 */
function notAnArray(value) {
  if (value === undefined) return '(missing)';
  let type = typeof value;
  if (value === null) type = 'null';
  else if (type === 'object' && typeof value._bsontype === 'string') type = value._bsontype;
  return `(not an array: ${type})`;
}

/** @param {object} doc @returns {string} relaxed Extended JSON on one line, for reading */
function readableJson(doc) {
  return escapeUnsafe(EJSON.stringify(doc, { relaxed: true }));
}

/** @param {object} doc @returns {string} canonical Extended JSON on one line: exact, for restore */
function recoveryJson(doc) {
  return escapeUnsafe(EJSON.stringify(doc, { relaxed: false }));
}

// --- Reading -------------------------------------------------------------------------------------

/** @param {{ github_id?: unknown }} doc @returns {boolean} same rule as services/devOwnership.js */
function isLegacy(doc) {
  return doc.github_id === undefined || doc.github_id === null;
}

/**
 * @param {string} value
 * @param {string} what - for the error message
 * @returns {import('mongodb').ObjectId}
 */
function parseObjectId(value, what) {
  if (typeof value !== 'string' || !OBJECT_ID_PATTERN.test(value)) {
    throw usage(`The ${what} must be a developer _id: 24 hexadecimal characters.`);
  }
  return new mongoose.mongo.ObjectId(value.toLowerCase());
}

/**
 * @param {string} value
 * @returns {number} a GitHub account id: a positive integer in canonical decimal form
 */
function parseGithubId(value) {
  const githubId = githubIdFromSubject(value);
  if (githubId === null) {
    throw usage('--github-id must be a GitHub account id: a positive integer (digits only, no leading zero).');
  }
  return githubId;
}

/** @returns {Promise<Array<{ doc: object, evidence: object }>>} every legacy dev, oldest first */
async function loadLegacyDevs() {
  // { github_id: null } matches a missing field and null: the legacy rule.
  const docs = await Dev.collection.find({ github_id: null }).sort({ _id: 1 }).toArray();
  return docs.map((doc) => ({ doc, evidence: legacyAvatarEvidence(doc) }));
}

/**
 * @param {number[]} githubIds
 * @returns {Promise<Map<number, object>>} the dev of each account that has one
 */
async function profilesOf(githubIds) {
  if (githubIds.length === 0) return new Map();
  const owners = await Dev.collection
    .find({ github_id: { $in: githubIds } }, { projection: { _id: 1, github_id: 1, github_username: 1 } })
    .toArray();
  return new Map(owners.map((owner) => [owner.github_id, owner]));
}

/** @param {number} githubId @returns {Promise<object | null>} the account's dev */
function profileOf(githubId) {
  return Dev.collection.findOne({ github_id: githubId }, { projection: { _id: 1, github_id: 1, github_username: 1 } });
}

/**
 * @param {string} name
 * @returns {Promise<boolean>} true if the devs collection has the index `name`
 */
async function hasIndex(name) {
  try {
    const indexes = await Dev.collection.indexes();
    return indexes.some((index) => index.name === name && index.unique === true);
  } catch (err) {
    if (err && err.codeName === 'NamespaceNotFound') return false;
    throw err;
  }
}

/** @param {object} evidence @returns {string} */
function describeEvidence(evidence) {
  if (evidence.status === AVATAR_ID_STATUS.PARSED) return `GitHub id ${evidence.id} (${evidence.host})`;
  return evidence.status;
}

/**
 * Explains why a conditional write matched nothing, from the dev's current state.
 * @param {object} before - the dev as read
 * @returns {Promise<string>}
 */
async function changedSinceRead(before) {
  const now = await Dev.collection.findOne({ _id: before._id });
  let what;
  if (!now) what = 'it was deleted';
  else if (!isLegacy(now)) what = `it now belongs to GitHub account ${now.github_id}`;
  else if (now.github_username !== before.github_username) what = `its login changed to ${show(now.github_username)}`;
  else what = 'it changed';
  return `developer ${before._id} changed since it was read (${what}). Run list again.`;
}

// --- list ----------------------------------------------------------------------------------------

/**
 * @returns {Promise<{ devs: object[], summary: object }>} the listing (AC-1 to AC-4)
 */
async function buildListing() {
  const entries = await loadLegacyDevs();
  const byAvatarId = new Map();
  entries.forEach((entry) => {
    if (entry.evidence.status !== AVATAR_ID_STATUS.PARSED) return;
    const same = byAvatarId.get(entry.evidence.id) || [];
    same.push(entry);
    byAvatarId.set(entry.evidence.id, same);
  });
  const owners = await profilesOf([...byAvatarId.keys()]);

  const summary = {
    total: entries.length,
    by_status: { legacy: 0, displaced: 0 },
    by_avatar_id: { parsed: 0, unparseable: 0, none: 0 },
    // No prototype: a host may be named "constructor" or "__proto__" (QA-LM-2).
    by_avatar_host: Object.create(null),
  };
  const devs = entries.map((entry) => {
    const { doc, evidence } = entry;
    const parsed = evidence.status === AVATAR_ID_STATUS.PARSED;
    const owner = parsed ? owners.get(evidence.id) || null : null;
    const duplicates = parsed
      ? byAvatarId.get(evidence.id).filter((other) => other !== entry).map((other) => String(other.doc._id))
      : [];
    const coordinates = doc.location && Array.isArray(doc.location.coordinates)
      ? { latitude: doc.location.coordinates[1], longitude: doc.location.coordinates[0] }
      : null;
    const status = doc.github_username_stale === true ? 'displaced' : 'legacy';

    summary.by_status[status] += 1;
    summary.by_avatar_id[evidence.status] += 1;
    if (evidence.status !== AVATAR_ID_STATUS.NONE) {
      const host = evidence.host || '(not a URL)';
      summary.by_avatar_host[host] = (summary.by_avatar_host[host] || 0) + 1;
    }

    return {
      _id: String(doc._id),
      login: doc.github_username ?? null,
      status,
      name: doc.name ?? null,
      coordinates,
      techs: Array.isArray(doc.techs) ? doc.techs : notAnArray(doc.techs),
      avatar_url: doc.avatar_url ?? null,
      avatar_id: parsed ? evidence.id : evidence.status,
      avatar_host: evidence.host,
      owner_has_profile: Boolean(owner),
      owner_profile: owner ? { _id: String(owner._id), github_username: owner.github_username ?? null } : null,
      duplicate_avatar_id: duplicates.length > 0,
      duplicate_of: duplicates,
    };
  });
  return { devs, summary };
}

/** @param {object} counts @returns {string} "a 1, b 2" */
function formatCounts(counts) {
  const parts = Object.entries(counts).map(([key, count]) => `${escapeUnsafe(key)} ${count}`);
  return parts.length > 0 ? parts.join(', ') : '(none)';
}

/**
 * @param {{ json?: boolean }} options
 * @param {Output} out
 * @returns {Promise<number>}
 */
async function list({ json = false }, out) {
  const listing = await buildListing();
  if (json) {
    // Line by line: JSON.stringify already escapes controls inside strings, so each line only
    // needs the characters it leaves raw (C1, separators, bidi) escaped, which keeps it valid JSON.
    JSON.stringify(listing, null, 2).split('\n').forEach((line) => out.log(escapeUnsafe(line)));
    return EXIT.OK;
  }
  if (listing.devs.length === 0) {
    out.log('No legacy developers: every developer has a github_id. Nothing to do.');
    return EXIT.OK;
  }
  listing.devs.forEach((dev) => {
    const coordinates = dev.coordinates
      ? `latitude ${show(dev.coordinates.latitude)}, longitude ${show(dev.coordinates.longitude)}`
      : '(none)';
    let ownerLine = 'no';
    if (dev.owner_has_profile) {
      // Every stored value goes through show(), _ids too: hand-edited data can hold a string _id
      // with control characters (QA-LM-1).
      ownerLine = `yes: ${show(dev.owner_profile._id)} (login ${show(dev.owner_profile.github_username)})`
        + ` -> merge ${show(dev._id)} --into ${show(dev.owner_profile._id)}`;
    }
    out.log(`_id                  ${show(dev._id)}`);
    out.log(`  login              ${show(dev.login)}`);
    out.log(`  status             ${dev.status}`);
    out.log(`  name               ${show(dev.name)}`);
    out.log(`  coordinates        ${coordinates}`);
    let techs = dev.techs;
    if (Array.isArray(techs)) techs = techs.length > 0 ? techs.map(show).join(', ') : '(none)';
    out.log(`  techs              ${techs}`);
    out.log(`  avatar_url         ${show(dev.avatar_url)}`);
    out.log(`  avatar id          ${dev.avatar_id}`);
    out.log(`  owner_has_profile  ${ownerLine}`);
    out.log(`  duplicate_avatar_id ${dev.duplicate_avatar_id ? `yes: ${dev.duplicate_of.map(show).join(', ')}` : 'no'}`);
    out.log('');
  });
  const { summary } = listing;
  out.log(`Legacy developers: ${summary.total}`);
  out.log(`  by status:      ${formatCounts(summary.by_status)}`);
  out.log(`  by avatar id:   ${formatCounts(summary.by_avatar_id)}`);
  out.log(`  by avatar host: ${formatCounts(summary.by_avatar_host)}`);
  return EXIT.OK;
}

// --- assign --------------------------------------------------------------------------------------

/**
 * Gives a legacy dev to a GitHub account that has no dev: sets github_id, nothing else (AC-7 to
 * AC-15, AC-21).
 * @param {{ devId: string, githubId?: string, fromAvatar?: boolean, force?: boolean, apply?: boolean }} options
 * @param {Output} out
 * @returns {Promise<number>}
 */
async function assign({ devId, githubId: githubIdText, fromAvatar = false, force = false, apply = false }, out) {
  if (fromAvatar === (githubIdText !== undefined)) throw usage('assign needs exactly one of --github-id <id> or --from-avatar.');
  if (fromAvatar && force) throw usage('--force only applies with --github-id (--from-avatar never guesses).');
  const _id = parseObjectId(devId, 'developer');
  const requested = fromAvatar ? null : parseGithubId(githubIdText);

  const dev = await Dev.collection.findOne({ _id });
  if (!dev) throw refusal(`no developer has _id ${_id}.`);
  if (!isLegacy(dev)) {
    throw refusal(`developer ${_id} already belongs to GitHub account ${show(dev.github_id)}; only legacy developers can be assigned.`);
  }
  const evidence = legacyAvatarEvidence(dev);
  const parsed = evidence.status === AVATAR_ID_STATUS.PARSED;

  let target;
  let forced = null;
  if (fromAvatar) {
    if (!parsed) throw refusal(`no avatar evidence (avatar id: ${evidence.status}). Confirm the owner's GitHub id and use --github-id <id> --force.`);
    const legacy = await loadLegacyDevs();
    const others = legacy.filter((entry) => entry.evidence.status === AVATAR_ID_STATUS.PARSED
      && entry.evidence.id === evidence.id && String(entry.doc._id) !== String(_id));
    if (others.length > 0) {
      throw refusal(`other legacy developers have the same avatar id ${evidence.id} (${others.map((entry) => entry.doc._id).join(', ')}). `
        + 'Choose one with --github-id, then merge the others into it.');
    }
    target = evidence.id;
  } else {
    target = requested;
    if (parsed && evidence.id !== target) {
      if (!force) throw refusal(`avatar id does not match: the avatar says GitHub id ${evidence.id}, not ${target}. Use --force only after confirming with the owner.`);
      forced = `the avatar says GitHub id ${evidence.id}, not ${target}`;
    } else if (!parsed) {
      if (!force) throw refusal(`no avatar evidence (avatar id: ${evidence.status}). Use --force only after confirming the owner's GitHub id with them.`);
      forced = `the avatar carries no GitHub id (${evidence.status})`;
    }
  }

  const owner = await profileOf(target);
  if (owner) throw refusal(alreadyHasProfile(target, _id, owner._id));
  if (!await hasIndex(GITHUB_ID_INDEX)) {
    throw refusal(`the ${GITHUB_ID_INDEX} index is missing, so a concurrent registration could not be detected. Start the API once (it builds the indexes), then retry.`);
  }

  out.log(`Assign legacy developer ${_id} to GitHub account ${target}`);
  out.log(`  current:        ${readableJson(dev)}`);
  out.log(`  avatar id:      ${describeEvidence(evidence)}`);
  if (forced) out.log(`  FORCED:         ${forced}`);
  out.log(`  change:         set github_id = ${target}; nothing else changes (the owner's next sign-in restores their current login)`);
  if (!apply) {
    out.log('Dry run: nothing was written. Re-run with --apply to write this change.');
    return EXIT.OK;
  }

  let updated;
  try {
    // The state the decision was made on: same dev, still legacy, same login (a claim sets
    // github_id, a displacement changes the login).
    updated = await Dev.collection.findOneAndUpdate(
      { _id, github_id: null, github_username: dev.github_username },
      { $set: { github_id: target } },
      { returnDocument: 'after' }
    );
  } catch (err) {
    if (err && err.code === DUPLICATE_KEY) {
      const registered = await profileOf(target);
      throw refusal(alreadyHasProfile(target, _id, registered ? registered._id : '<its dev>'));
    }
    throw err;
  }
  if (!updated) throw refusal(await changedSinceRead(dev));

  out.log(`Applied${forced ? ' (FORCED)' : ''}: developer ${_id} now belongs to GitHub account ${target}.`);
  out.log(`  before: ${readableJson(dev)}`);
  out.log(`  after:  ${readableJson(updated)}`);
  out.log(NO_LIVE_EVENTS);
  return EXIT.OK;
}

/** @returns {string} the AC-10 message */
function alreadyHasProfile(githubId, legacyId, profileId) {
  return `GitHub account ${githubId} already has a profile (${profileId}). `
    + `To retire the legacy developer in favor of it, use: ${SCRIPT} merge ${legacyId} --into ${profileId}`;
}

// --- merge ---------------------------------------------------------------------------------------

/**
 * Retires a legacy dev in favor of its owner's current profile: deletes the legacy dev, never
 * touches the profile (AC-16 to AC-20).
 * @param {{ devId: string, into: string, force?: boolean, apply?: boolean }} options
 * @param {Output} out
 * @returns {Promise<number>}
 */
async function merge({ devId, into, force = false, apply = false }, out) {
  if (into === undefined) throw usage('merge needs --into <dev _id> (the owner\'s current profile).');
  const legacyId = parseObjectId(devId, 'legacy developer');
  const profileId = parseObjectId(into, '--into profile');
  if (legacyId.equals(profileId)) throw refusal('a developer cannot be merged into itself.');

  const dev = await Dev.collection.findOne({ _id: legacyId });
  if (!dev) throw refusal(`no developer has _id ${legacyId}.`);
  if (!isLegacy(dev)) {
    throw refusal(`developer ${legacyId} belongs to GitHub account ${show(dev.github_id)}; only a legacy developer can be merged away.`);
  }
  const profile = await Dev.collection.findOne({ _id: profileId });
  if (!profile) throw refusal(`no developer has _id ${profileId}.`);
  if (isLegacy(profile)) {
    throw refusal(`developer ${profileId} has no github_id; merge only into an account's profile (assign one first).`);
  }
  // Only an id a GitHub account can have (what the github_id index and sign-in know). --force never
  // overrides this: it only overrides the avatar id check (QA-LM-3).
  if (!isValidGithubId(profile.github_id)) {
    throw refusal(`developer ${profileId} has github_id ${show(profile.github_id)}, which no GitHub account can have (a positive integer); merge only into an account's profile.`);
  }

  const evidence = legacyAvatarEvidence(dev);
  let forced = null;
  if (evidence.status !== AVATAR_ID_STATUS.PARSED) {
    if (!force) throw refusal(`no avatar evidence (avatar id: ${evidence.status}). Use --force only after confirming with the owner.`);
    forced = `the avatar carries no GitHub id (${evidence.status})`;
  } else if (evidence.id !== profile.github_id) {
    if (!force) throw refusal(`avatar id does not match: the avatar says GitHub id ${evidence.id}, the profile belongs to ${show(profile.github_id)}. Use --force only after confirming with the owner.`);
    forced = `the avatar says GitHub id ${evidence.id}, the profile belongs to ${show(profile.github_id)}`;
  }

  out.log(`Merge legacy developer ${legacyId} into ${profileId} (GitHub account ${show(profile.github_id)}, login ${show(profile.github_username)})`);
  out.log(`  to delete:      ${readableJson(dev)}`);
  out.log(`  kept unchanged: ${readableJson(profile)}`);
  out.log(`  avatar id:      ${describeEvidence(evidence)}`);
  if (forced) out.log(`  FORCED:         ${forced}`);
  out.log('  change:         delete the legacy developer; the profile is not modified');
  if (!apply) {
    out.log('Dry run: nothing was written. Re-run with --apply to delete it.');
    return EXIT.OK;
  }

  // Only the state the decision was made on: same dev, still legacy, same login.
  const deleted = await Dev.collection.findOneAndDelete({ _id: legacyId, github_id: null, github_username: dev.github_username });
  if (!deleted) throw refusal(await changedSinceRead(dev));

  out.log(`Applied${forced ? ' (FORCED)' : ''}: developer ${legacyId} was deleted.`);
  out.log(`Recovery record (save the next line to a file; ${SCRIPT} restore <file> --apply puts it back, as a displaced developer):`);
  out.log(recoveryJson(deleted));
  const after = await Dev.collection.findOne({ _id: profileId });
  if (!after || after.github_id !== profile.github_id) {
    out.error(`Warning: profile ${profileId} was deleted or changed owner meanwhile. Restore the record above if the owner needs it.`);
  }
  out.log(NO_LIVE_EVENTS);
  return EXIT.OK;
}

// --- restore -------------------------------------------------------------------------------------

// A restored dev is always DISPLACED: its login becomes the same placeholder
// services/devOwnership.js gives a displaced dev (`_stale_<_id>`, never a valid GitHub login), so
// no account can ever claim it by login, whatever the file says. Only `assign` (a human decision,
// with the avatar id guard) gives it an owner. Otherwise a crafted record could create a new
// claimable legacy dev, which the spec rules out (no new legacy devs can arise; B1 relies on it).
const STALE_LOGIN_PREFIX = '_stale_';

// The fields a Dev document can have (models/Dev.js), and those of its location (PointSchema).
const RECORD_FIELDS = new Set(Object.keys(Dev.schema.paths));
const LOCATION_FIELDS = new Set(['type', 'coordinates', '_id']);

/** @param {unknown} value @returns {boolean} */
const isObjectId = (value) => Boolean(value) && typeof value === 'object' && value._bsontype === 'ObjectId';
/** @param {unknown} value @returns {boolean} missing or null */
const isAbsent = (value) => value === undefined || value === null;

/**
 * @param {unknown} value - a number as canonical Extended JSON parses it (Double, Int32) or a number
 * @returns {number} its value, or NaN
 */
function numberOf(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && (value._bsontype === 'Double' || value._bsontype === 'Int32')) {
    return value.valueOf();
  }
  return NaN;
}

/**
 * Checks a recovery record against the Dev schema, strictly (no casting).
 * @param {object} doc
 * @returns {string | null} what is wrong with it, or null
 */
function recordProblem(doc) {
  const unknown = Object.keys(doc).filter((key) => !RECORD_FIELDS.has(key));
  if (unknown.length > 0) return `unknown field(s) ${unknown.map(show).join(', ')}`;
  if (typeof doc.github_username !== 'string' || doc.github_username === '') return 'github_username must be a non-empty string';
  if (!isAbsent(doc.github_username_stale) && typeof doc.github_username_stale !== 'boolean') return 'github_username_stale must be a boolean';
  for (const field of ['name', 'bio', 'avatar_url']) {
    if (!isAbsent(doc[field]) && typeof doc[field] !== 'string') return `${field} must be a string or null`;
  }
  if (!Array.isArray(doc.techs) || !doc.techs.every((tech) => typeof tech === 'string')) return 'techs must be an array of strings';
  const seenAt = doc.github_username_seen_at;
  if (!isAbsent(seenAt)) {
    if (!(seenAt instanceof Date) || Number.isNaN(seenAt.getTime())) return 'github_username_seen_at must be a date';
    // A future login read would block the owner's next sign-in from refreshing the login.
    if (seenAt.getTime() > Date.now()) return 'github_username_seen_at is in the future';
  }
  if (!isAbsent(doc.location)) {
    const { location } = doc;
    if (typeof location !== 'object' || Array.isArray(location) || location instanceof Date
      || !Object.keys(location).every((key) => LOCATION_FIELDS.has(key))) return 'location must be a GeoJSON Point';
    if (location.type !== 'Point' || !Array.isArray(location.coordinates) || location.coordinates.length !== 2) {
      return 'location must be a GeoJSON Point';
    }
    const [longitude, latitude] = location.coordinates.map(numberOf);
    if (!(longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90)) return 'location coordinates are out of range';
    if (location._id !== undefined && !isObjectId(location._id)) return 'location._id must be an ObjectId';
  }
  if (doc.__v !== undefined && !Number.isInteger(numberOf(doc.__v))) return '__v must be an integer';
  return null;
}

/**
 * Reads and checks a recovery record (no database needed, so the command line runs this before it
 * connects).
 * @param {string} file
 * @returns {object} the record, as canonical Extended JSON parses it
 */
function loadRecoveryRecord(file) {
  let text;
  try {
    if (fs.statSync(file).size > MAX_RESTORE_FILE_BYTES) throw new Error('too large');
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw usage('Cannot read the recovery file (missing, unreadable or over 1 MB).');
  }
  let doc;
  try {
    doc = EJSON.parse(text.trim(), { relaxed: false });
  } catch {
    throw usage('The file must hold one recovery record: the Extended JSON line merge printed.');
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !isObjectId(doc._id)) {
    throw usage('The file must hold one recovery record: the Extended JSON line merge printed.');
  }
  if (!isLegacy(doc)) throw refusal('the record has a github_id; this tool only deletes, and so only restores, legacy developers.');
  const problem = recordProblem(doc);
  if (problem) throw refusal(`the record is not a developer as merge prints it: ${problem}.`);
  return doc;
}

/**
 * The record as it is inserted: displaced (placeholder login, stale flag), and a name that was
 * only the login cleared, as a displacement does. Everything else as recorded.
 * @param {object} doc
 * @returns {object}
 */
function asDisplaced(doc) {
  const restored = { ...doc, github_username: `${STALE_LOGIN_PREFIX}${doc._id.toHexString()}`, github_username_stale: true };
  if (typeof doc.name === 'string' && doc.name.toLowerCase() === doc.github_username.toLowerCase()) restored.name = null;
  return restored;
}

/**
 * Inserts back a dev deleted by merge, from its recovery record, always as a displaced dev.
 * @param {{ file: string, apply?: boolean }} options
 * @param {Output} out
 * @returns {Promise<number>}
 */
async function restore({ file, apply = false }, out) {
  const record = loadRecoveryRecord(file);
  if (await Dev.collection.findOne({ _id: record._id }, { projection: { _id: 1 } })) {
    throw refusal(`a developer with _id ${record._id} already exists.`);
  }
  if (!await hasIndex(GITHUB_USERNAME_INDEX)) {
    throw refusal(`the ${GITHUB_USERNAME_INDEX} index is missing, so a duplicate login could not be detected. Start the API once, then retry.`);
  }
  const doc = asDisplaced(record);

  out.log(`Restore developer ${doc._id} as displaced`);
  out.log(`  original login: ${show(record.github_username)}`);
  out.log(`  restored login: ${doc.github_username} (displaced: no account can claim it by login; use assign to give it to its owner)`);
  out.log(`  record:         ${readableJson(doc)}`);
  if (!apply) {
    out.log('Dry run: nothing was written. Re-run with --apply to insert it.');
    return EXIT.OK;
  }
  try {
    await Dev.collection.insertOne(doc);
  } catch (err) {
    if (err && err.code === DUPLICATE_KEY) throw refusal(`another developer now uses this record's _id (${doc._id}).`);
    throw err;
  }
  out.log(`Applied: developer ${doc._id} was restored as displaced (original login ${show(record.github_username)}).`);
  out.log(NO_LIVE_EVENTS);
  return EXIT.OK;
}

// --- Command line --------------------------------------------------------------------------------

const COMMANDS = {
  list: { positionals: 0, flags: { json: 'boolean' } },
  assign: { positionals: 1, flags: { 'github-id': 'value', 'from-avatar': 'boolean', force: 'boolean', apply: 'boolean' } },
  merge: { positionals: 1, flags: { into: 'value', force: 'boolean', apply: 'boolean' } },
  restore: { positionals: 1, flags: { apply: 'boolean' } },
};

/**
 * Parses the arguments. Never echoes a value (one could be a pasted connection string).
 * @param {string[]} argv - the arguments after the script name
 * @returns {{ command: string, positionals: string[], options: object }}
 */
function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command === undefined || ['help', '--help', '-h'].includes(command)) return { command: 'help', positionals: [], options: {} };
  const spec = COMMANDS[command];
  if (!spec) throw usage(`Unknown command. Commands: ${Object.keys(COMMANDS).join(', ')}, help.`);

  const options = {};
  const positionals = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--help' || arg === '-h') return { command: 'help', positionals: [], options: {} };
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf('=');
    const name = arg.startsWith('--') ? arg.slice(2, equals === -1 ? undefined : equals) : '';
    const kind = Object.prototype.hasOwnProperty.call(spec.flags, name) ? spec.flags[name] : null;
    if (!kind) throw usage(`Unknown option for ${command}. Options: ${Object.keys(spec.flags).map((flag) => `--${flag}`).join(', ') || '(none)'}.`);
    if (Object.prototype.hasOwnProperty.call(options, name)) throw usage(`--${name} was given twice.`);
    if (kind === 'boolean') {
      if (equals !== -1) throw usage(`--${name} takes no value.`);
      options[name] = true;
    } else {
      const value = equals === -1 ? rest[i + 1] : arg.slice(equals + 1);
      if (value === undefined || value === '' || (equals === -1 && value.startsWith('-'))) throw usage(`--${name} needs a value.`);
      if (equals === -1) i += 1;
      options[name] = value;
    }
  }
  if (positionals.length !== spec.positionals) {
    throw usage(spec.positionals === 0
      ? `${command} takes no arguments.`
      : `${command} takes exactly one ${command === 'restore' ? 'file' : 'developer _id'} argument.`);
  }
  return { command, positionals, options };
}

/**
 * @param {{ command: string, options: object }} parsed - parseArgs' result
 * @returns {boolean} true for `list --json`, whose stdout must be only JSON
 */
function isJsonListing(parsed) {
  return parsed.command === 'list' && parsed.options.json === true;
}

/**
 * @typedef {{ log: (line: string) => void, error: (line: string) => void }} Output
 */

/**
 * Runs one command against the database mongoose is connected to. Prints, never throws.
 * @param {string[]} argv - the arguments after the script name
 * @param {Output} out
 * @returns {Promise<number>} the exit code (EXIT)
 */
async function run(argv, rawOut) {
  const out = safeOutput(rawOut);
  try {
    const { command, positionals, options } = parseArgs(argv);
    if (command === 'help') {
      out.log(HELP);
      return EXIT.OK;
    }
    // The target before anything else (AC-25): names only, the connection holds no credentials here.
    const connection = Dev.db;
    let mode = ' (dry run: nothing will be written)';
    if (command === 'list') mode = ' (read-only)';
    else if (options.apply) mode = ' (--apply: the change below will be written)';
    // With --json, stdout is only the JSON (to pipe into jq); the target goes to stderr.
    const info = isJsonListing({ command, options }) ? out.error : out.log;
    info(`Database "${escapeUnsafe(connection.name)}" on ${escapeUnsafe(connection.host)}:${connection.port}${mode}`);
    if (command === 'list') return await list({ json: options.json === true }, out);
    if (command === 'assign') {
      return await assign({
        devId: positionals[0],
        githubId: options['github-id'],
        fromAvatar: options['from-avatar'] === true,
        force: options.force === true,
        apply: options.apply === true,
      }, out);
    }
    if (command === 'merge') {
      return await merge({ devId: positionals[0], into: options.into, force: options.force === true, apply: options.apply === true }, out);
    }
    return await restore({ file: positionals[0], apply: options.apply === true }, out);
  } catch (err) {
    if (err instanceof CommandError) {
      out.error(err.message);
      if (err.exitCode === EXIT.USAGE) out.error(`Run "${SCRIPT} help" for usage.`);
      return err.exitCode;
    }
    throw err;
  }
}

/**
 * Checks what can be checked without a database, so the command line fails before it connects
 * (a restore file that is missing, unreadable or not a valid record).
 * @param {{ command: string, positionals: string[] }} parsed - parseArgs' result
 * @param {Output} rawOut
 * @returns {number | null} an exit code to stop with, or null to go on
 */
function preflight(parsed, rawOut) {
  if (parsed.command !== 'restore') return null;
  const out = safeOutput(rawOut);
  try {
    loadRecoveryRecord(parsed.positionals[0]);
    return null;
  } catch (err) {
    if (!(err instanceof CommandError)) throw err;
    out.error(err.message);
    if (err.exitCode === EXIT.USAGE) out.error(`Run "${SCRIPT} help" for usage.`);
    return err.exitCode;
  }
}

module.exports = {
  EXIT,
  HELP,
  NO_LIVE_EVENTS,
  escapeUnsafe,
  parseArgs,
  isJsonListing,
  preflight,
  buildListing,
  run,
};
