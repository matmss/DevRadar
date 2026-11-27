// Helpers for scenarios with several backend instances in this process (multi-instance.feature,
// shared-auth.feature): "A" is the scenario's own instance (hooks.js), more are started by
// support/testApp.js startTestInstance. Every request dials 127.0.0.1 (BUG-013).
const crypto = require('crypto');
const request = require('supertest');
const { LOOPBACK } = require('./loopback');
const { mockGithubOAuthTokenExchange, mockGithubAuthenticatedUser } = require('./github-mock');

const CLIENT_REDIRECT = 'http://localhost:3000/';
const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

/**
 * @param {import('http').Server} server
 * @returns {Promise<string>} its base URL, once listening on 127.0.0.1
 */
async function listenOnLoopback(server) {
  if (!server.listening) {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, LOOPBACK, resolve);
    });
  }
  return `http://${LOOPBACK}:${server.address().port}`;
}

/**
 * @param {object} world
 * @param {string} name
 * @returns {{ url: string, context: import('../../../../dev/backend/src/serverContext').ServerContext }}
 */
function instanceNamed(world, name) {
  const instance = world.instancesByName && world.instancesByName[name];
  if (!instance) throw new Error(`No backend instance "${name}" in this scenario`);
  return instance;
}

/**
 * Remembers a secret this scenario handled (a state, a one-time code, a PKCE verifier, a GitHub
 * access token, a session token), so log assertions can check that none of them was logged.
 * @param {object} world
 * @param {unknown} value
 */
function noteSecret(world, value) {
  if (typeof value !== 'string' || value === '') return;
  if (!world.secretsSeen) world.secretsSeen = new Set();
  world.secretsSeen.add(value);
}

/**
 * Notes the one-time code of a callback redirect and the session token of a token response.
 * @param {object} world
 * @param {import('supertest').Response} response
 * @returns {import('supertest').Response}
 */
function noteResponseSecrets(world, response) {
  const { location } = response.headers;
  if (location && /^https?:/.test(location)) noteSecret(world, new URL(location).searchParams.get('code'));
  if (response.body && typeof response.body === 'object') noteSecret(world, response.body.token);
  return response;
}

/** RFC 7636 S256: BASE64URL(SHA256(ascii(code_verifier))). */
function s256(verifier) {
  return crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/**
 * GET /auth/github on `name` with a fresh PKCE verifier; keeps the state when GitHub is next.
 * @param {object} world
 * @param {string} name
 */
async function startSignIn(world, name) {
  world.pkceVerifier = crypto.randomBytes(32).toString('base64url');
  noteSecret(world, world.pkceVerifier);
  world.response = await request(instanceNamed(world, name).url)
    .get('/auth/github')
    .query({ redirect: CLIENT_REDIRECT, code_challenge: s256(world.pkceVerifier), code_challenge_method: 'S256' });
  const { location } = world.response.headers;
  if (location && location.startsWith(AUTHORIZE_URL)) {
    world.authState = new URL(location).searchParams.get('state');
    noteSecret(world, world.authState);
  }
}

/**
 * GET /auth/github/callback on `name` with the kept state and GitHub's code.
 * @param {object} world
 * @param {string} name
 * @returns {import('supertest').Test}
 */
function callBackRequest(world, name) {
  return request(instanceNamed(world, name).url)
    .get('/auth/github/callback')
    .query({ state: world.authState, code: world.githubCode });
}

/**
 * @param {object} world
 * @param {string} name
 */
async function callBack(world, name) {
  world.response = noteResponseSecrets(world, await callBackRequest(world, name));
}

/**
 * Mocks GitHub (process-wide nock, so for every instance) to sign in `username` for the next
 * callback, with its own GitHub code and access token (kept as `world.githubAccessToken`).
 * @param {object} world
 * @param {string} username
 */
function mockNextGithubSignIn(world, username) {
  world.miSignIns = (world.miSignIns || 0) + 1;
  world.githubCode = `mi-github-code-${world.miSignIns}`;
  world.githubAccessToken = `gho_mi_access_token_${world.miSignIns}`;
  noteSecret(world, world.githubAccessToken);
  mockGithubOAuthTokenExchange(world.githubCode, world.githubAccessToken);
  mockGithubAuthenticatedUser(world.githubAccessToken, username);
}

/**
 * POST /auth/token on `name`.
 * @param {object} world
 * @param {string} name
 * @param {{ code?: string, code_verifier?: string }} body
 * @returns {import('supertest').Test}
 */
function redeemRequest(world, name, body) {
  return request(instanceNamed(world, name).url).post('/auth/token').send(body);
}

module.exports = {
  CLIENT_REDIRECT,
  AUTHORIZE_URL,
  listenOnLoopback,
  instanceNamed,
  noteSecret,
  noteResponseSecrets,
  s256,
  startSignIn,
  callBackRequest,
  callBack,
  mockNextGithubSignIn,
  redeemRequest,
};
