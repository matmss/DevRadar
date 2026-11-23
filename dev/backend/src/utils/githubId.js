// GitHub's numeric user id (`id` in GET https://api.github.com/user). It identifies an account for
// good: a login can be renamed and later registered by someone else, the id cannot (auth spec Q10).
// A DevRadar profile belongs to the account with this id; the login is display data.
//
// In the session token the id is the JWT subject, a string of decimal digits (RFC 7519 makes
// `sub` a string). Everywhere else it is a JavaScript number.

const SUBJECT_PATTERN = /^[1-9]\d{0,15}$/;

/**
 * @param {unknown} value
 * @returns {boolean} true if `value` is a positive safe integer (a number, not a numeric string)
 */
function isValidGithubId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * @param {number} githubId - a valid GitHub id
 * @returns {string} the JWT subject for it
 */
function githubIdToSubject(githubId) {
  return String(githubId);
}

/**
 * Parses a JWT subject back into a GitHub id. Only the canonical form signSessionToken writes is
 * accepted (decimal digits, no sign, no leading zero, no exponent), so a token whose subject is a
 * login (issued before ids were captured) is rejected.
 * @param {unknown} subject
 * @returns {number | null}
 */
function githubIdFromSubject(subject) {
  if (typeof subject !== 'string' || !SUBJECT_PATTERN.test(subject)) return null;
  const githubId = Number(subject);
  return isValidGithubId(githubId) ? githubId : null;
}

const MAX_ID = BigInt(Number.MAX_SAFE_INTEGER);
// Decimal128.toString(): optional sign, digits, optional fraction, optional exponent.
const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d*))?(?:E([+-]?\d+))?$/i;

/**
 * @param {bigint} value
 * @returns {number | null} `value` if it is a valid GitHub id
 */
function fromBigInt(value) {
  return value > 0n && value <= MAX_ID ? Number(value) : null;
}

/**
 * @param {string} text - a Decimal128 as text
 * @returns {number | null} its value, exactly, if it is a valid GitHub id (an integer value in any
 *   notation: "222", "222.0", "2.22E+2")
 */
function fromDecimalText(text) {
  const match = DECIMAL_PATTERN.exec(text);
  if (!match || match[1] === '-') return null;
  const fraction = match[3] || '';
  const digits = match[2] + fraction;
  const exponent = Number(match[4] || 0) - fraction.length;
  if (exponent >= 0) return exponent > 16 ? null : fromBigInt(BigInt(digits) * 10n ** BigInt(exponent));
  const cut = digits.length + exponent;
  if (!/^0*$/.test(digits.slice(Math.max(cut, 0)))) return null; // not an integer value
  return cut > 0 ? fromBigInt(BigInt(digits.slice(0, cut))) : null;
}

/**
 * THE ownership rule for a STORED github_id (services/devOwnership.js and the operator CLI,
 * scripts/lib/legacyDevs.js, QA-PB-3/QA-PB-5): the GitHub account a stored value names, if any.
 * A number of any BSON numeric type (Int32, Double, Long, Decimal128, as promoted by the driver or
 * not) whose value is a positive safe integer, or a canonical decimal string of one ("222", the
 * JWT subject form). Anything else (missing, null, "", "0222", "not-a-number", 0, negatives,
 * non-integers, booleans, documents) names no account: the dev is legacy.
 * @param {unknown} value - a github_id as stored
 * @returns {number | null} the GitHub id, or null for "no account"
 */
function storedGithubId(value) {
  if (typeof value === 'number') return isValidGithubId(value) ? value : null;
  if (typeof value === 'string') return githubIdFromSubject(value);
  if (typeof value === 'bigint') return fromBigInt(value);
  if (!value || typeof value !== 'object') return null;
  switch (value._bsontype) {
    case 'Int32':
    case 'Double':
      return storedGithubId(value.valueOf());
    case 'Long':
      return fromBigInt(BigInt(value.toString()));
    case 'Decimal128':
      return fromDecimalText(value.toString());
    default:
      return null;
  }
}

/**
 * @param {{ github_id?: unknown }} doc - a dev as stored
 * @returns {boolean} true for a legacy dev: its stored github_id names no account (storedGithubId)
 */
function isLegacyDoc(doc) {
  return storedGithubId(doc.github_id) === null;
}

/**
 * @param {number} githubId - a valid GitHub id
 * @returns {[number, string]} the values a driver query on github_id needs to find every stored
 *   form storedGithubId reads as `githubId`: the number (MongoDB matches Int32, Double, Long and
 *   Decimal128 by value) and the canonical string. Numbers first: the plain number is the normal form.
 */
function storedGithubIdForms(githubId) {
  return [githubId, String(githubId)];
}

module.exports = {
  isValidGithubId,
  githubIdToSubject,
  githubIdFromSubject,
  storedGithubId,
  isLegacyDoc,
  storedGithubIdForms,
};
