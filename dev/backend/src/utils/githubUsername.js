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

module.exports = { GITHUB_USERNAME_PATTERN, GITHUB_USERNAME_COLLATION, isValidGithubUsername };
