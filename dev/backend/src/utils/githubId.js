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

module.exports = { isValidGithubId, githubIdToSubject, githubIdFromSubject };
