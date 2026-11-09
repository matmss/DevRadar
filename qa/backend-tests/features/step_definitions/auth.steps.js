const crypto = require('crypto');
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const nock = require('nock');
// Same copy dev/backend uses, so forged tokens are built exactly like real ones.
const jwt = require('../../../../dev/backend/node_modules/jsonwebtoken');
const { signSessionToken } = require('../../../../dev/backend/src/utils/sessionToken');
const { TEST_JWT_SECRET } = require('../support/auth-config');
const { createTestApp } = require('../support/testApp');
const {
  mockGithubOAuthTokenExchange,
  mockGithubOAuthTokenExchangeFailure,
  mockGithubAuthenticatedUser,
  mockGithubAuthenticatedUserFailure,
  githubUserFixture,
} = require('../support/github-mock');

const GITHUB_ACCESS_TOKEN = 'gho_test_access_token_must_never_leak';
const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

// --- Clock control ---------------------------------------------------------------------------
// The state store, the one-time code store and jsonwebtoken all read Date.now() at call time,
// so shifting it simulates time passing without waiting. Restored after every scenario.
const realDateNow = Date.now;
let clockOffsetMs = 0;

function shiftClock(ms) {
  clockOffsetMs += ms;
  Date.now = () => realDateNow() + clockOffsetMs;
}

After(function () {
  Date.now = realDateNow;
  clockOffsetMs = 0;
});

When('{int} seconds pass', function (seconds) {
  shiftClock(seconds * 1000);
});

// --- Helpers ---------------------------------------------------------------------------------

/** RFC 7636 S256: BASE64URL(SHA256(ascii(code_verifier))). */
function s256(verifier) {
  return crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function locationOf(response) {
  return response.headers.location;
}

/**
 * Starts sign-in like a real client: a fresh random PKCE verifier per attempt, kept on the
 * world for the token exchange, and its S256 challenge sent to GET /auth/github.
 * `query` overrides/removes parameters (undefined values are dropped).
 */
async function startSignIn(world, redirect, query = {}) {
  world.pkceVerifier = crypto.randomBytes(32).toString('base64url');
  const params = {
    redirect,
    code_challenge: s256(world.pkceVerifier),
    code_challenge_method: 'S256',
    ...query,
  };
  Object.keys(params).forEach((key) => params[key] === undefined && delete params[key]);
  world.response = await request(world.app).get('/auth/github').query(params);
  const location = locationOf(world.response);
  if (location && location.startsWith(AUTHORIZE_URL)) {
    world.authState = new URL(location).searchParams.get('state');
  }
  return world.response;
}

async function callBack(world, query) {
  world.response = await request(world.app).get('/auth/github/callback').query(query);
  return world.response;
}

function oneTimeCodeFrom(response) {
  const location = locationOf(response);
  return location ? new URL(location).searchParams.get('code') : null;
}

// --- Given -----------------------------------------------------------------------------------

Given('GitHub will sign in {string} for authorization code {string}', function (username, code) {
  mockGithubOAuthTokenExchange(code, GITHUB_ACCESS_TOKEN);
  mockGithubAuthenticatedUser(GITHUB_ACCESS_TOKEN, username);
});

Given("GitHub's token exchange will fail with {string}", function (failure) {
  mockGithubOAuthTokenExchangeFailure(failure);
});

Given(
  "GitHub's token exchange succeeds for code {string} but the user lookup fails with {string}",
  function (code, failure) {
    mockGithubOAuthTokenExchange(code, GITHUB_ACCESS_TOKEN);
    mockGithubAuthenticatedUserFailure(failure);
  }
);

async function completeSignIn(world, username, profileOverrides = {}) {
  mockGithubOAuthTokenExchange('good-code', GITHUB_ACCESS_TOKEN);
  mockGithubAuthenticatedUser(GITHUB_ACCESS_TOKEN, username, profileOverrides);
  await startSignIn(world, 'http://localhost:3000/');
  await callBack(world, { code: 'good-code', state: world.authState });
  world.oneTimeCode = oneTimeCodeFrom(world.response);
  expect(world.oneTimeCode, 'sign-in should have produced a one-time code').to.be.a('string').that.is.not.empty;
}

/** Full OAuth sign-in (mocked GitHub) plus the PKCE token exchange; leaves world.sessionToken set. */
async function signInThroughGithub(world, username, profileOverrides) {
  await completeSignIn(world, username, profileOverrides);
  await exchangeOneTimeCode(world, { code_verifier: world.pkceVerifier });
  expect(world.response.status, 'token exchange should succeed').to.equal(200);
  expect(world.sessionToken, 'token exchange should issue a session token').to.be.a('string').that.is.not.empty;
}

Given('I completed GitHub sign-in as {string}', async function (username) {
  await completeSignIn(this, username);
});

Given('I signed in through GitHub as {string}', async function (username) {
  await signInThroughGithub(this, username);
});

// `value` takes JSON string escapes (e.g. "\u0007" or "\u202e"), and "<null>" means null.
Given('I signed in through GitHub as {string} whose GitHub {word} is {string}', async function (username, field, value) {
  const parsed = value === '<null>' ? null : JSON.parse(`"${value}"`);
  await signInThroughGithub(this, username, { [field]: parsed });
});

Given('I signed in through GitHub as {string} whose GitHub bio is {int} characters long', async function (username, length) {
  await signInThroughGithub(this, username, { bio: 'b'.repeat(length) });
});

Given('I have a valid session token for {string}', function (username) {
  this.sessionToken = signSessionToken(username, githubUserFixture(username)).token;
});

Given('I have a session token for {string} that expired {int} hour(s) ago', function (username, hours) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now - hours * 3600;
  this.sessionToken = jwt.sign(
    { sub: username, iss: 'devradar', iat: exp - SEVEN_DAYS_SECONDS, exp },
    TEST_JWT_SECRET,
    { algorithm: 'HS256' }
  );
});

Given(
  'I have a session token for {string} that expired {int} hour(s) ago, signed with another secret',
  function (username, hours) {
    const now = Math.floor(Date.now() / 1000);
    const exp = now - hours * 3600;
    this.sessionToken = jwt.sign(
      { sub: username, iss: 'devradar', iat: exp - SEVEN_DAYS_SECONDS, exp },
      'some-other-secret-that-is-not-jwt-secret',
      { algorithm: 'HS256' }
    );
  }
);

Given('I have a {word} session token', function (kind) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: 'gaearon', iss: 'devradar', iat: now, exp: now + SEVEN_DAYS_SECONDS };

  if (kind === 'tampered') {
    const [header, payload, signature] = signSessionToken('gaearon').token.split('.');
    const forged = { ...decodeJwtPart(payload), sub: 'bob' };
    this.sessionToken = [header, base64UrlJson(forged), signature].join('.');
  } else if (kind === 'foreign-signed') {
    this.sessionToken = jwt.sign(claims, 'some-other-secret-that-is-not-jwt-secret', { algorithm: 'HS256' });
  } else if (kind === 'alg-none') {
    this.sessionToken = `${base64UrlJson({ alg: 'none', typ: 'JWT' })}.${base64UrlJson(claims)}.`;
  } else if (kind === 'malformed') {
    this.sessionToken = 'not-a-jwt';
  } else if (kind === 'profile-less') {
    // Correctly signed but without the `profile` claim, like the tokens slice 1 issued.
    this.sessionToken = jwt.sign(claims, TEST_JWT_SECRET, { algorithm: 'HS256' });
  } else if (kind === 'forged-profile') {
    // Correctly signed, but the profile claim is not what the backend would have signed.
    const profile = { name: 'Eve', avatar_url: 'javascript:alert(1)', bio: null };
    this.sessionToken = jwt.sign({ ...claims, profile }, TEST_JWT_SECRET, { algorithm: 'HS256' });
  } else {
    throw new Error(`Unknown token kind: ${kind}`);
  }
});

// Rate-limit env is reset by applyTestAuthEnv() in hooks.js before every scenario.
Given('the auth rate limit is {int} requests per window', function (limit) {
  // Every /auth limiter: sign-in (AUTH_RATE_LIMIT_MAX) and session checks (AUTH_SESSION_RATE_LIMIT_MAX).
  process.env.AUTH_RATE_LIMIT_MAX = String(limit);
  process.env.AUTH_SESSION_RATE_LIMIT_MAX = String(limit);
});

Given('the sign-in rate limit is {int} requests per window', function (limit) {
  process.env.AUTH_RATE_LIMIT_MAX = String(limit);
});

Given('the session check rate limit is {int} requests per window', function (limit) {
  process.env.AUTH_SESSION_RATE_LIMIT_MAX = String(limit);
});

// TRUST_PROXY is applied when the app is built, so rebuild it (no server is listening yet).
Given('the backend runs with TRUST_PROXY {string}', function (value) {
  process.env.TRUST_PROXY = value; // reset by applyTestAuthEnv() in hooks.js
  const { app, server } = createTestApp();
  this.app = app;
  this.server = server;
});

// --- When ------------------------------------------------------------------------------------

When('I start GitHub sign-in with redirect {string}', async function (redirect) {
  await startSignIn(this, redirect);
});

When('I start GitHub sign-in with redirect {string} without a PKCE challenge', async function (redirect) {
  await startSignIn(this, redirect, { code_challenge: undefined, code_challenge_method: undefined });
});

When(
  'I start GitHub sign-in with redirect {string} and code_challenge {string}',
  async function (redirect, challenge) {
    await startSignIn(this, redirect, { code_challenge: challenge });
  }
);

When(
  'I start GitHub sign-in with redirect {string} and code_challenge_method {string}',
  async function (redirect, method) {
    await startSignIn(this, redirect, { code_challenge_method: method === '' ? undefined : method });
  }
);

When('I start GitHub sign-in {int} times from forwarded address {string}', async function (times, address) {
  for (let i = 0; i < times; i += 1) {
    this.response = await request(this.app)
      .get('/auth/github')
      .set('X-Forwarded-For', address)
      .query({ redirect: 'http://localhost:3000/', code_challenge: s256('v'.repeat(43)), code_challenge_method: 'S256' });
  }
});

When('I start GitHub sign-in {int} times', async function (times) {
  for (let i = 0; i < times; i += 1) {
    await startSignIn(this, 'http://localhost:3000/');
  }
});

When('I start GitHub sign-in with redirect {string} twice', async function (redirect) {
  await startSignIn(this, redirect);
  const first = this.authState;
  await startSignIn(this, redirect);
  this.authStates = [first, this.authState];
});

When('I start GitHub sign-in without a redirect', async function () {
  await startSignIn(this, undefined);
});

When('GitHub calls back with code {string} and the issued state', async function (code) {
  await callBack(this, { code, state: this.authState });
});

When('GitHub calls back with code {string} and no state', async function (code) {
  await callBack(this, { code });
});

When('GitHub calls back with code {string} and state {string}', async function (code, state) {
  await callBack(this, { code, state });
});

When('GitHub calls back with no code and the issued state', async function () {
  await callBack(this, { state: this.authState });
});

When('GitHub calls back with error {string} and the issued state', async function (error) {
  await callBack(this, { error, error_description: 'The user has denied your application access.', state: this.authState });
});

When('GitHub calls back with error {string} and state {string}', async function (error, state) {
  await callBack(this, { error, state });
});

async function exchangeOneTimeCode(world, body) {
  if (!world.oneTimeCode) world.oneTimeCode = oneTimeCodeFrom(world.response);
  world.response = await request(world.app).post('/auth/token').send({ code: world.oneTimeCode, ...body });
  if (world.response.body && world.response.body.token) world.sessionToken = world.response.body.token;
}

When('I exchange the one-time code for a session token', async function () {
  await exchangeOneTimeCode(this, { code_verifier: this.pkceVerifier });
});

When('I exchange the one-time code without a PKCE verifier', async function () {
  await exchangeOneTimeCode(this, {});
});

When('I exchange the one-time code with a wrong PKCE verifier', async function () {
  await exchangeOneTimeCode(this, { code_verifier: crypto.randomBytes(32).toString('base64url') });
});

When('I exchange the one-time code with a malformed PKCE verifier', async function () {
  await exchangeOneTimeCode(this, { code_verifier: 'too-short' });
});

When('I exchange the one-time code {string} for a session token', async function (code) {
  this.response = await request(this.app).post('/auth/token').send({ code });
});

When('I exchange an empty body for a session token', async function () {
  this.response = await request(this.app).post('/auth/token');
});

When('I call GET \\/auth\\/me with the session token', async function () {
  this.response = await request(this.app).get('/auth/me').set('Authorization', `Bearer ${this.sessionToken}`);
});

When('I call GET \\/auth\\/me without a token', async function () {
  this.response = await request(this.app).get('/auth/me');
});

When('I call GET \\/auth\\/me without a token {int} times', async function (times) {
  for (let i = 0; i < times; i += 1) {
    this.response = await request(this.app).get('/auth/me');
  }
});

When('I call GET \\/auth\\/me with Authorization header {string}', async function (header) {
  this.response = await request(this.app).get('/auth/me').set('Authorization', header);
});

// --- Then ------------------------------------------------------------------------------------

Then("I should be redirected to GitHub's authorize page", function () {
  expect(this.response.status).to.equal(302);
  expect(locationOf(this.response)).to.match(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
});

Then('the authorize URL should have {word} {string}', function (param, value) {
  expect(new URL(locationOf(this.response)).searchParams.get(param)).to.equal(value);
});

Then('the authorize URL should carry a random state', function () {
  const state = new URL(locationOf(this.response)).searchParams.get('state');
  // 32 random bytes, base64url: hard to guess, safe in a URL.
  expect(state).to.match(/^[A-Za-z0-9_-]{43}$/);
});

Then('the authorize URL should not request any scope', function () {
  expect(new URL(locationOf(this.response)).searchParams.has('scope')).to.equal(false);
});

Then('the two states should be different', function () {
  const [first, second] = this.authStates;
  expect(first).to.be.a('string').that.is.not.empty;
  expect(second).to.be.a('string').that.is.not.empty;
  expect(first).to.not.equal(second);
});

Then('I should not be redirected anywhere', function () {
  expect(locationOf(this.response)).to.equal(undefined);
});

Then('I should be redirected to {string} with a one-time code', function (target) {
  expect(this.response.status).to.equal(302);
  const location = new URL(locationOf(this.response));
  const code = location.searchParams.get('code');
  expect(code).to.be.a('string').that.is.not.empty;

  location.searchParams.delete('code');
  expect(location.toString()).to.equal(new URL(target).toString());
  this.oneTimeCode = code;
});

Then('I should be redirected to {string} with error {string}', function (target, error) {
  expect(this.response.status).to.equal(302);
  const location = new URL(locationOf(this.response));
  expect(location.searchParams.get('error')).to.equal(error);
  location.searchParams.delete('error');
  expect(location.toString()).to.equal(new URL(target).toString());
});

Then('I should be redirected to {string} with error {string} and reason {string}', function (target, error, reason) {
  expect(this.response.status).to.equal(302);
  const location = new URL(locationOf(this.response));
  expect(location.searchParams.get('error')).to.equal(error);
  expect(location.searchParams.get('reason')).to.equal(reason);
  location.searchParams.delete('error');
  location.searchParams.delete('reason');
  expect(location.toString()).to.equal(new URL(target).toString());
});

Then('the redirect should not contain the session token or the GitHub access token', function () {
  const location = locationOf(this.response);
  expect(location).to.not.include(GITHUB_ACCESS_TOKEN);
  expect(location).to.not.match(/eyJ[\w-]+\.[\w-]+\./); // no JWT anywhere in the URL
  expect([...new URL(location).searchParams.keys()]).to.deep.equal(['code']);
});

Then('no sign-in code should be issued', function () {
  const location = locationOf(this.response);
  if (location) expect(new URL(location).searchParams.has('code')).to.equal(false);
  expect(JSON.stringify(this.response.body || {})).to.not.include(GITHUB_ACCESS_TOKEN);
  expect(this.response.body).to.not.have.property('token');
});

Then('the response should contain a Bearer session token for {string} valid for 7 days', function (username) {
  const { body } = this.response;
  expect(body.token_type).to.equal('Bearer');
  expect(body.expires_in).to.equal(SEVEN_DAYS_SECONDS);
  expect(body.user).to.include({ github_username: username });

  const [header, payload] = body.token.split('.');
  expect(decodeJwtPart(header).alg).to.equal('HS256');
  const claims = decodeJwtPart(payload);
  expect(claims.sub).to.equal(username);
  expect(claims.exp - claims.iat).to.equal(SEVEN_DAYS_SECONDS);
});

Then('the response should not contain the GitHub access token', function () {
  expect(JSON.stringify(this.response.body)).to.not.include(GITHUB_ACCESS_TOKEN);
  expect(JSON.stringify(this.response.headers)).to.not.include(GITHUB_ACCESS_TOKEN);
  const claims = decodeJwtPart(this.response.body.token.split('.')[1]);
  expect(JSON.stringify(claims)).to.not.include(GITHUB_ACCESS_TOKEN);
});

Then('the response should not contain a session token', function () {
  expect(this.response.body).to.not.have.property('token');
});

Then("the backend should have called GitHub's token and user endpoints", function () {
  expect(nock.pendingMocks()).to.deep.equal([]);
});

Then('the signed-in identity should be {string}', function (username) {
  expect(this.response.body.github_username).to.equal(username);
});

Then("the signed-in user should have the name and avatar_url of {string}'s GitHub profile", function (username) {
  const { name, avatar_url } = githubUserFixture(username);
  expect(this.response.body).to.deep.equal({ github_username: username, name, avatar_url });
});

Then("the session token should carry {string}'s GitHub profile from sign-in", function (username) {
  const { name, avatar_url, bio } = githubUserFixture(username);
  const claims = decodeJwtPart(this.response.body.token.split('.')[1]);
  expect(claims.profile).to.deep.equal({ name, avatar_url, bio });
});

Then('the response should be an auth error with code {string}', function (code) {
  const { body } = this.response;
  expect(body.error).to.be.a('string').that.is.not.empty;
  expect(body.code).to.equal(code);
  expect(body.details).to.be.an('array');
});

Then('the response should challenge for a Bearer token', function () {
  expect(this.response.headers['www-authenticate']).to.match(/^Bearer /);
});
