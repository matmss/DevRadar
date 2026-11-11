// Links to a dev's GitHub profile, only when the dev shows a real GitHub login.
//
// Since auth slice 6 a dev whose login GitHub has given to another account is "displaced": the
// backend sets `github_username_stale: true` and replaces its login with a placeholder that is
// never a valid GitHub login (e.g. "_stale_<id>"), until its owner signs in again. Linking to
// github.com/<placeholder> would be a broken page, and linking to an old login would show someone
// else, so no link is offered then.

// GitHub logins: 1-39 characters, letters, digits or single hyphens, no leading/trailing hyphen
// (the backend's GITHUB_USERNAME_PATTERN).
const GITHUB_LOGIN_PATTERN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/**
 * @param {{ github_username?: unknown, github_username_stale?: unknown }} dev
 * @returns {string | null} https://github.com/<login>, or null for a displaced or invalid login
 */
function githubProfileUrl(dev) {
  if (!dev || dev.github_username_stale === true) return null;
  const login = dev.github_username;
  if (typeof login !== 'string' || !GITHUB_LOGIN_PATTERN.test(login)) return null;
  return `https://github.com/${login}`;
}

export { githubProfileUrl, GITHUB_LOGIN_PATTERN };
