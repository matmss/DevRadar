const { EJSON } = require('mongoose').mongo.BSON;

// GitHub usernames: 1-39 chars, alphanumeric or single hyphens, no leading/trailing hyphen.
// Enforcing this also keeps user input from altering GitHub API URL paths.
const GITHUB_USERNAME_PATTERN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/**
 * @param {unknown} value
 * @returns {boolean} true if `value` is a syntactically valid GitHub username
 */
function isValidGithubUsername(value) {
  return typeof value === 'string' && GITHUB_USERNAME_PATTERN.test(value);
}

// GitHub logins are case-insensitive ("Gaearon" and "gaearon" are the same account). Used by the
// Dev model's unique index and by every query on github_username, which must use the same
// collation for MongoDB to use that index.
const GITHUB_USERNAME_COLLATION = Object.freeze({ locale: 'en', strength: 2 });

// Displaced logins: "_" can never appear in a GitHub login, so the placeholder can never be a
// real account's and never matches a login lookup.
const STALE_LOGIN_PREFIX = '_stale_';

/**
 * The placeholder login of a displaced dev, unique per stored _id under the login index's
 * case-insensitive collation and printable ASCII only. An ObjectId keeps the original form,
 * `_stale_<24 lowercase hex>`. Any other stored _id (hand-edited) is tagged and hex-encoded,
 * so two _ids that differ only in letter case, or that hold control characters, still get
 * distinct, printable placeholders (QA-PB-6): `_stale_s_<hex of the string's UTF-8 bytes>`, or
 * `_stale_x_<hex of the _id's canonical Extended JSON>` for other BSON types. ("s", "x" and "_"
 * are not hex digits, so neither form can equal an ObjectId's.)
 * @param {unknown} storedId - the dev's _id exactly as stored
 * @returns {string}
 */
function staleLoginFor(storedId) {
  if (storedId && typeof storedId === 'object' && storedId._bsontype === 'ObjectId') {
    return `${STALE_LOGIN_PREFIX}${storedId.toHexString()}`;
  }
  if (typeof storedId === 'string') {
    return `${STALE_LOGIN_PREFIX}s_${Buffer.from(storedId, 'utf8').toString('hex')}`;
  }
  return `${STALE_LOGIN_PREFIX}x_${Buffer.from(EJSON.stringify(storedId, { relaxed: false }), 'utf8').toString('hex')}`;
}

module.exports = {
  GITHUB_USERNAME_PATTERN,
  GITHUB_USERNAME_COLLATION,
  STALE_LOGIN_PREFIX,
  isValidGithubUsername,
  staleLoginFor,
};
