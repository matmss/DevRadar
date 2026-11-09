const nock = require('nock');

const FIXTURES = {
  gaearon: {
    login: 'gaearon',
    name: 'Dan Abramov',
    avatar_url: 'https://avatars.githubusercontent.com/u/810438?v=4',
    bio: 'Working on React',
  },
  'near-match': {
    login: 'near-match',
    name: 'Near Match',
    avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
    bio: 'Test fixture',
  },
};

/** Stubs GET https://api.github.com/users/:username for a known fixture username. */
function mockGithubUser(username, overrides = {}) {
  const fixture = FIXTURES[username] || {
    login: username,
    name: null, // DevController falls back to `login` per FR-1.2 when name is absent
    avatar_url: `https://avatars.githubusercontent.com/u/0?v=4`,
    bio: 'Auto-generated fixture bio',
  };

  nock('https://api.github.com')
    .get(`/users/${username}`)
    .reply(200, { ...fixture, ...overrides });
}

/** Stubs a 404, as real GitHub would return for an unknown username (see OI-1 / BUG-004). */
function mockGithubUserNotFound(username) {
  nock('https://api.github.com').get(`/users/${username}`).reply(404, { message: 'Not Found' });
}

/** Stubs GitHub's rate-limit response: 403 with x-ratelimit-remaining: 0, or 429. */
function mockGithubRateLimited(username, status = 403) {
  nock('https://api.github.com')
    .get(`/users/${username}`)
    .reply(status, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' });
}

/** Stubs a 403 that is NOT a rate limit (e.g. abuse detection): quota still remaining. */
function mockGithubForbidden(username) {
  nock('https://api.github.com')
    .get(`/users/${username}`)
    .reply(403, { message: 'Forbidden' }, { 'x-ratelimit-remaining': '42' });
}

/** Simulates a network-level failure (DNS/connection error) reaching GitHub. */
function mockGithubUnreachable(username) {
  nock('https://api.github.com')
    .get(`/users/${username}`)
    .replyWithError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' });
}

// --- GitHub OAuth web flow (dev/docs/03-auth-spec.md, US-1) ---------------------------------
// Credentials the auth scenarios configure the backend with (see hooks.js). The token-exchange
// mock only matches when the backend sends exactly these, so a regression that drops the
// secret or the redirect_uri fails loudly instead of passing against a lenient stub.
const TEST_OAUTH = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  callbackUrl: 'http://localhost:3333/auth/github/callback',
};

/** Stubs a successful POST https://github.com/login/oauth/access_token for `code`. */
function mockGithubOAuthTokenExchange(code, accessToken) {
  nock('https://github.com')
    .post('/login/oauth/access_token', (body) => body.code === code
      && body.client_id === TEST_OAUTH.clientId
      && body.client_secret === TEST_OAUTH.clientSecret
      && body.redirect_uri === TEST_OAUTH.callbackUrl)
    .reply(200, { access_token: accessToken, token_type: 'bearer', scope: '' });
}

/**
 * Stubs a failing token exchange. `kind`:
 *  - "rejected":     200 { error: "bad_verification_code" } (how GitHub reports bad/expired codes)
 *  - "server error": 500
 *  - "unreachable":  network-level failure
 *  - "rate limited": 429
 */
function mockGithubOAuthTokenExchangeFailure(kind) {
  const scope = nock('https://github.com').post('/login/oauth/access_token');
  if (kind === 'rejected') {
    scope.reply(200, { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' });
  } else if (kind === 'server error') {
    scope.reply(500, 'Internal Server Error');
  } else if (kind === 'unreachable') {
    scope.replyWithError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' });
  } else if (kind === 'rate limited') {
    scope.reply(429, { message: 'Too many requests' });
  } else {
    throw new Error(`Unknown token exchange failure kind: ${kind}`);
  }
}

/** Stubs GET https://api.github.com/user, answering only for `Authorization: Bearer <accessToken>`. */
function mockGithubAuthenticatedUser(accessToken, username) {
  const fixture = FIXTURES[username] || {
    login: username,
    name: null,
    avatar_url: 'https://avatars.githubusercontent.com/u/0?v=4',
    bio: 'Auto-generated fixture bio',
  };
  nock('https://api.github.com', { reqheaders: { authorization: `Bearer ${accessToken}` } })
    .get('/user')
    .reply(200, fixture);
}

/** Stubs a failing GET https://api.github.com/user. `kind`: "unauthorized" (401) or "rate limited". */
function mockGithubAuthenticatedUserFailure(kind) {
  const scope = nock('https://api.github.com').get('/user');
  if (kind === 'unauthorized') {
    scope.reply(401, { message: 'Bad credentials' });
  } else if (kind === 'rate limited') {
    scope.reply(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' });
  } else {
    throw new Error(`Unknown user lookup failure kind: ${kind}`);
  }
}

module.exports = {
  TEST_OAUTH,
  mockGithubOAuthTokenExchange,
  mockGithubOAuthTokenExchangeFailure,
  mockGithubAuthenticatedUser,
  mockGithubAuthenticatedUserFailure,
  mockGithubUser,
  mockGithubUserNotFound,
  mockGithubRateLimited,
  mockGithubForbidden,
  mockGithubUnreachable,
  FIXTURES,
};
