// Auth configuration for the backend scenarios. hooks.js puts these in process.env before any
// scenario runs; dev/backend/src/config/auth.js reads env at request time, so they take effect.
const { TEST_OAUTH } = require('./github-mock');

// Session-token signing secret. Auth steps use it to forge expired tokens.
const TEST_JWT_SECRET = 'test-jwt-secret-for-backend-scenarios-only';

/** @returns {void} */
function applyTestAuthEnv() {
  process.env.GITHUB_CLIENT_ID = TEST_OAUTH.clientId;
  process.env.GITHUB_CLIENT_SECRET = TEST_OAUTH.clientSecret;
  process.env.GITHUB_CALLBACK_URL = TEST_OAUTH.callbackUrl;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.MOBILE_APP_SCHEME = 'devradar';
  delete process.env.AUTH_RATE_LIMIT_MAX;
  delete process.env.AUTH_SESSION_RATE_LIMIT_MAX;
  delete process.env.TRUST_PROXY;
}

module.exports = { TEST_JWT_SECRET, applyTestAuthEnv };
