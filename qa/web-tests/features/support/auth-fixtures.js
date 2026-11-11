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
 * The GitHub account id for a login: what a DevRadar profile belongs to (auth spec Q10). Derived
 * from the login in lower case, so "Gaearon" and "gaearon" are the same account, as on GitHub.
 * @param {string} login
 * @returns {number} a positive safe integer
 */
function githubIdFor(login) {
  const crypto = require('crypto');
  return 1000000 + crypto.createHash('sha256').update(login.toLowerCase()).digest().readUIntBE(0, 6);
}

/**
 * GET https://api.github.com/user for a login. `name` is null so the dev list shows the login
 * (DevController falls back to it), which the scenarios assert on.
 * @param {string} login
 */
function githubUserFixture(login) {
  return {
    id: githubIdFor(login),
    login,
    name: null,
    avatar_url: `https://avatars.githubusercontent.com/u/0?v=4&fixture=${encodeURIComponent(login)}`,
    bio: 'Integration test fixture',
  };
}

// The login steps use to inspect the backend over its real HTTP API (GET /devs needs a session
// token since auth slice 4). Never registered and never shown in the browser.
const INSPECTOR_LOGIN = 'qa-inspector';

/**
 * A session token for `login` shaped like POST /auth/token's (auth slice 6: subject = the GitHub
 * account id, `login` claim, fixture profile claim), signed with the harness JWT_SECRET, valid
 * from `iat` to `exp` (seconds). Required lazily: the harness backend (main process) loads this
 * file too and does not need it.
 * @param {string} login
 * @param {{ iat: number, exp: number }} times
 * @returns {string}
 */
function signHarnessToken(login, { iat, exp }) {
  // Same copy dev/backend verifies with.
  const jwt = require('../../../../dev/backend/node_modules/jsonwebtoken');
  const { id, name, avatar_url, bio } = githubUserFixture(login);
  return jwt.sign(
    { sub: String(id), login, login_read_at: iat * 1000, iss: 'devradar', iat, exp, profile: { name, avatar_url, bio } },
    TEST_JWT_SECRET,
    { algorithm: 'HS256' }
  );
}

/**
 * A valid session token for `login`, valid for `ttlSeconds` from now.
 * @param {string} login
 * @param {number} [ttlSeconds]
 * @returns {string}
 */
function harnessSessionToken(login, ttlSeconds = 3600) {
  const iat = Math.floor(Date.now() / 1000);
  return signHarnessToken(login, { iat, exp: iat + ttlSeconds });
}

/**
 * A token as auth slices 1-5 issued it for `login` (subject = the login, no GitHub id, no `login`
 * claim), otherwise valid. The backend answers it 401 token_invalid since auth slice 6.
 * @param {string} login
 * @returns {string}
 */
function preSlice6SessionToken(login) {
  const jwt = require('../../../../dev/backend/node_modules/jsonwebtoken');
  const iat = Math.floor(Date.now() / 1000);
  const { name, avatar_url, bio } = githubUserFixture(login);
  return jwt.sign(
    { sub: login, iss: 'devradar', iat, exp: iat + 3600, profile: { name, avatar_url, bio } },
    TEST_JWT_SECRET,
    { algorithm: 'HS256' }
  );
}

/** @returns {{ Authorization: string }} headers for a step's own GET /devs or GET /search */
function inspectorAuthHeaders() {
  return { Authorization: `Bearer ${harnessSessionToken(INSPECTOR_LOGIN)}` };
}

module.exports = {
  TEST_JWT_SECRET,
  FAKE_CODE_PREFIX,
  FAKE_ACCESS_TOKEN_PREFIX,
  GITHUB_DOWN_CODE,
  githubUserFixture,
  githubIdFor,
  signHarnessToken,
  harnessSessionToken,
  preSlice6SessionToken,
  inspectorAuthHeaders,
};
