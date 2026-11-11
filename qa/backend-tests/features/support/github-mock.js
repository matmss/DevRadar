const crypto = require('crypto');
const nock = require('nock');

// GitHub's GET /user answers carry the account's numeric `id`, which is what a DevRadar profile
// belongs to (auth spec Q10). Fixture ids are fixed; other logins get one derived from the login
// in lower case, so "Gaearon" and "gaearon" are the same account, as on GitHub.
const FIXTURES = {
  gaearon: {
    id: 810438,
    login: 'gaearon',
    name: 'Dan Abramov',
    avatar_url: 'https://avatars.githubusercontent.com/u/810438?v=4',
    bio: 'Working on React',
  },
  'near-match': {
    id: 1001,
    login: 'near-match',
    name: 'Near Match',
    avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
    bio: 'Test fixture',
  },
  alice: {
    id: 1002,
    login: 'alice',
    name: 'Alice Liddell',
    avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
    bio: 'Down the rabbit hole',
  },
};

/**
 * The GitHub account id the fixtures use for `username` (any letter case).
 * @param {string} username
 * @returns {number} a positive safe integer
 */
function githubIdFor(username) {
  const key = username.toLowerCase();
  if (FIXTURES[key]) return FIXTURES[key].id;
  // 48 bits of a hash, above the fixed ids: stable, distinct per login, a safe integer.
  return 1000000 + crypto.createHash('sha256').update(key).digest().readUIntBE(0, 6);
}

/**
 * The GET https://api.github.com/user response for a fixture user. Unknown names get a generated
 * fixture with `name: null`, so DevController's fallback to the login applies.
 * @param {string} username
 * @returns {{ id: number, login: string, name: string | null, avatar_url: string, bio: string }}
 */
function githubUserFixture(username) {
  return FIXTURES[username] || {
    id: githubIdFor(username),
    login: username,
    name: null,
    avatar_url: 'https://avatars.githubusercontent.com/u/0?v=4',
    bio: 'Auto-generated fixture bio',
  };
}

// --- GitHub's public users API (must never be called) ---------------------------------------
// Registration builds a dev from the profile captured at sign-in, so nothing may call
// GET https://api.github.com/users/:username any more. hooks.js makes nock strict and no
// scenario mocks that path, so such a call fails the request; this also records it, so
// scenarios (and the After hook) can assert there were none instead of relying on the call's
// error path. nock emits "no match" for every unmocked request, with the request or its options.
const USERS_PATH = /^\/users(\/|\?|$)/;

/**
 * Starts recording calls to https://api.github.com/users/*. Call `stop()` when the scenario ends.
 * @returns {{ calls: string[], stop: () => void }}
 */
function watchGithubUsersApi() {
  const calls = [];

  // nock emits either (options), or (req, options, body) when other api.github.com mocks exist
  // (e.g. GET /user during sign-in), and that `req` carries no host: check every argument.
  const onNoMatch = (...args) => {
    const hit = args.find((arg) => {
      if (!arg || typeof arg !== 'object') return false;
      const host = String(arg.hostname || arg.host || '');
      return host.startsWith('api.github.com') && USERS_PATH.test(String(arg.path || ''));
    });
    if (hit) calls.push(String(hit.path));
  };
  nock.emitter.on('no match', onNoMatch);

  return {
    calls,
    stop() {
      nock.emitter.removeListener('no match', onNoMatch);
    },
  };
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

/**
 * Stubs GET https://api.github.com/user, answering only for `Authorization: Bearer <accessToken>`.
 * `overrides` replace fixture fields (e.g. a hostile bio, another account id); a field
 * overridden with undefined is left out of the answer.
 */
function mockGithubAuthenticatedUser(accessToken, username, overrides = {}) {
  const body = { ...githubUserFixture(username), ...overrides };
  Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);
  nock('https://api.github.com', { reqheaders: { authorization: `Bearer ${accessToken}` } })
    .get('/user')
    .reply(200, body);
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
  githubUserFixture,
  githubIdFor,
  watchGithubUsersApi,
  FIXTURES,
};
