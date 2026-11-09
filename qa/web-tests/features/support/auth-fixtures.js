// Shared by the harness backend (backend-server.js, in Playwright's main process) and the step
// definitions (worker processes): the auth configuration the backend runs with, and how the
// fake GitHub maps authorization codes to users.

// Signs session tokens in the harness backend; steps use it to forge an expired token.
const TEST_JWT_SECRET = 'test-jwt-secret-for-web-scenarios-only';

// What the browser-level fake of github.com/login/oauth/authorize puts in `code`, and what the
// nock fakes of GitHub's token exchange and GET /user turn back into a login.
const FAKE_CODE_PREFIX = 'fake-code-';
const FAKE_ACCESS_TOKEN_PREFIX = 'gho_fake_';
// A code for which the fake token exchange answers 500 (backend: sign_in_failed, github_unavailable).
const GITHUB_DOWN_CODE = 'fake-github-down';

/**
 * GET https://api.github.com/user for a login. `name` is null so the dev list shows the login
 * (DevController falls back to it), which the scenarios assert on.
 * @param {string} login
 */
function githubUserFixture(login) {
  return {
    login,
    name: null,
    avatar_url: `https://avatars.githubusercontent.com/u/0?v=4&fixture=${encodeURIComponent(login)}`,
    bio: 'Integration test fixture',
  };
}

module.exports = {
  TEST_JWT_SECRET,
  FAKE_CODE_PREFIX,
  FAKE_ACCESS_TOKEN_PREFIX,
  GITHUB_DOWN_CODE,
  githubUserFixture,
};
