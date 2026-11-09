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

module.exports = { GITHUB_USERNAME_PATTERN, isValidGithubUsername };
