// Opens a dev's GitHub profile only when the dev shows a real GitHub login.
//
// Since auth slice 6 a dev whose login GitHub has given to another account is "displaced": the
// backend sets `github_username_stale: true` and replaces its login with a placeholder that is
// never a valid GitHub login (e.g. "_stale_<id>"), until its owner signs in again. The Profile
// screen (a WebView of github.com/<login>) must not open such a dev: it would be a broken page,
// or, with an old login, someone else's profile.

// GitHub logins: 1-39 characters, letters, digits or single hyphens, no leading/trailing hyphen
// (the backend's GITHUB_USERNAME_PATTERN).
const GITHUB_LOGIN_PATTERN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/**
 * @param {unknown} login
 * @returns {boolean} true for a syntactically valid GitHub login
 */
function isGithubLogin(login) {
  return typeof login === 'string' && GITHUB_LOGIN_PATTERN.test(login);
}

/**
 * @param {{ github_username?: unknown, github_username_stale?: unknown } | null | undefined} dev
 * @returns {string | null} the login to open on GitHub, or null for a displaced or invalid one
 */
function githubLoginOf(dev) {
  if (!dev || dev.github_username_stale === true) return null;
  return isGithubLogin(dev.github_username) ? dev.github_username : null;
}

/**
 * @param {unknown} login
 * @returns {string | null} https://github.com/<login>, or null if it is not a GitHub login
 */
function githubProfileUrl(login) {
  return isGithubLogin(login) ? `https://github.com/${login}` : null;
}

export { isGithubLogin, githubLoginOf, githubProfileUrl };
