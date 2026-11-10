/**
 * Boots the REAL DevRadar backend (dev/backend/src/routes + dev/backend/src/websocket, backed by
 * an ephemeral mongodb-memory-server) in-process, so the @integration web scenarios drive
 * the actual HTTP contract end to end instead of Playwright `page.route` mocks. Mirrors the
 * pattern already established in qa/backend-tests/features/support/testApp.js + hooks.js.
 *
 * Two things are intentionally still test doubles, both for reasons unrelated to "removing
 * web mocks":
 *  - GitHub is faked — it's third-party and out of this repo's control, same call
 *    qa/backend-tests makes (see its features/support/github-mock.js). Its server-side OAuth
 *    endpoints are stubbed here with `nock` (stubGithubApi); the browser's visit to GitHub's
 *    authorize page is faked in the step definitions (Playwright context.route).
 *  - `/__test__/*` routes below exist only in this harness (never touch dev/backend/src) so
 *    scenarios can reset/seed data over HTTP instead of opening a second, cross-process
 *    Mongo connection from the Playwright worker that runs the step definitions.
 *
 * The app itself comes from dev/backend/src/app.js's createServer(), the same function
 * index.js uses, so middleware order (trust proxy, CORS, JSON body, routes, error handler)
 * matches production; the `/__test__` router is mounted through its `beforeRoutes` hook.
 */
const express = require('express');
const nock = require('nock');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Must be the SAME mongoose instance dev/backend/src/models/Dev.js uses — mongoose's connection
// is a module-level singleton, so connecting a different copy leaves the app's models
// pointed at an unconnected instance and every query hangs. See
// qa/backend-tests/features/support/hooks.js for the identical constraint.
const mongoose = require('../../../../dev/backend/node_modules/mongoose');
const { createServer } = require('../../../../dev/backend/src/app');
const Dev = require('../../../../dev/backend/src/models/Dev');
const {
  TEST_JWT_SECRET,
  FAKE_CODE_PREFIX,
  FAKE_ACCESS_TOKEN_PREFIX,
  GITHUB_DOWN_CODE,
  githubUserFixture,
} = require('./auth-fixtures');

let mongod;
let server;

/**
 * Auth configuration for the harness backend (dev/backend/src/config/auth.js reads env at
 * request time). Set before the app is built. The GitHub credentials are dummies: GitHub is
 * faked. CORS_ORIGINS is the CRA dev server, so it is also the allowed sign-in redirect origin.
 * @param {number} port - the harness backend port
 */
function applyTestAuthEnv(port) {
  process.env.GITHUB_CLIENT_ID = 'web-test-client-id';
  process.env.GITHUB_CLIENT_SECRET = 'web-test-client-secret';
  process.env.GITHUB_CALLBACK_URL = `http://localhost:${port}/auth/github/callback`;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.CORS_ORIGINS = 'http://localhost:3000';
  // Every scenario signs in (3 sign-in requests) and reloads (GET /auth/me), from one IP.
  process.env.AUTH_RATE_LIMIT_MAX = '100000';
  process.env.AUTH_SESSION_RATE_LIMIT_MAX = '100000';
  // One login (e.g. gaearon) updates and deletes across many scenarios in one backend process.
  process.env.PROFILE_RATE_LIMIT_MAX = '100000';
  delete process.env.TRUST_PROXY;
}

/**
 * Fakes GitHub's server-side OAuth endpoints. The browser side (github.com/login/oauth/authorize)
 * is faked per scenario in the step definitions with Playwright's context.route(), which sends
 * the browser back to the backend callback with code "fake-code-<login>". Here:
 *  - POST https://github.com/login/oauth/access_token turns that code into "gho_fake_<login>"
 *    (500 for GITHUB_DOWN_CODE);
 *  - GET https://api.github.com/user answers the fixture profile for that access token.
 * Nothing fakes GET https://api.github.com/users/*: registration must not call it, and with
 * net connect disabled such a call would fail the registration.
 */
function stubGithubApi() {
  nock.disableNetConnect();
  nock.enableNetConnect((host) => host.includes('127.0.0.1') || host.includes('localhost'));

  nock('https://github.com')
    .persist()
    .post('/login/oauth/access_token')
    .reply((uri, body) => {
      const { code } = typeof body === 'string' ? JSON.parse(body) : body;
      if (code === GITHUB_DOWN_CODE) return [500, 'Internal Server Error'];
      if (typeof code !== 'string' || !code.startsWith(FAKE_CODE_PREFIX)) {
        return [200, { error: 'bad_verification_code' }];
      }
      const login = code.slice(FAKE_CODE_PREFIX.length);
      return [200, { access_token: `${FAKE_ACCESS_TOKEN_PREFIX}${login}`, token_type: 'bearer', scope: '' }];
    });

  nock('https://api.github.com')
    .persist()
    .get('/user')
    .reply(function reply() {
      const authorization = String(this.req.headers.authorization || '');
      const prefix = `Bearer ${FAKE_ACCESS_TOKEN_PREFIX}`;
      if (!authorization.startsWith(prefix)) return [401, { message: 'Bad credentials' }];
      return [200, githubUserFixture(authorization.slice(prefix.length))];
    });
}

function testRoutes() {
  const router = express.Router();

  router.post('/reset', async (req, res) => {
    await Dev.deleteMany({});
    res.sendStatus(204);
  });

  router.post('/seed', async (req, res) => {
    const count = Number(req.body.count || 0);
    const docs = Array.from({ length: count }, (_, i) => ({
      github_username: `seed-dev-${Date.now()}-${i}`,
      name: `Seed Dev ${i}`,
      avatar_url: 'https://avatars.githubusercontent.com/u/0?v=4',
      bio: 'Seeded for an @integration scenario',
      techs: ['ReactJS'],
      location: { type: 'Point', coordinates: [-46.6333, -23.5505] },
    }));
    await Dev.insertMany(docs);
    res.sendStatus(204);
  });

  // One specific developer, as a legacy (pre-sign-in) record would look: e.g. the signed-in
  // user's own profile for the update/delete scenarios (auth slice 5), in any letter case. With
  // `github_id`, a developer owned by that GitHub account instead (auth slice 6); `name` defaults
  // to the login.
  router.post('/seed-dev', async (req, res) => {
    const { github_username, github_id, name, techs, latitude, longitude } = req.body;
    await Dev.create({
      ...(github_id === undefined ? {} : { github_id }),
      github_username,
      name: name || github_username,
      avatar_url: 'https://avatars.githubusercontent.com/u/0?v=4',
      bio: 'Seeded for an @integration scenario',
      techs: String(techs).split(',').map((tech) => tech.trim()),
      location: { type: 'Point', coordinates: [Number(longitude), Number(latitude)] },
    });
    res.sendStatus(204);
  });

  return router;
}

async function startBackend(port) {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // Unique case-insensitive github_username index, as index.js builds it at startup.
  await Dev.init();
  applyTestAuthEnv(port);
  stubGithubApi();

  ({ server } = createServer({
    beforeRoutes: (app) => app.use('/__test__', testRoutes()),
  }));

  await new Promise((resolve) => server.listen(port, resolve));
}

async function stopBackend() {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongod) await mongod.stop();
  nock.cleanAll();
  nock.enableNetConnect();
}

module.exports = { startBackend, stopBackend };
