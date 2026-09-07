/**
 * Boots the REAL DevRadar backend (dev/backend/src/routes + dev/backend/src/websocket, backed by
 * an ephemeral mongodb-memory-server) in-process, so the @integration web scenarios drive
 * the actual HTTP contract end to end instead of Playwright `page.route` mocks. Mirrors the
 * pattern already established in qa/backend-tests/features/support/testApp.js + hooks.js.
 *
 * Two things are intentionally still test doubles, both for reasons unrelated to "removing
 * web mocks":
 *  - GitHub's API is stubbed with `nock` — it's third-party and out of this repo's control,
 *    same call qa/backend-tests makes (see its features/support/github-mock.js).
 *  - `/__test__/*` routes below exist only in this harness (never touch dev/backend/src) so
 *    scenarios can reset/seed data over HTTP instead of opening a second, cross-process
 *    Mongo connection from the Playwright worker that runs the step definitions.
 */
const express = require('express');
const cors = require('cors');
const http = require('http');
const nock = require('nock');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Must be the SAME mongoose instance dev/backend/src/models/Dev.js uses — mongoose's connection
// is a module-level singleton, so connecting a different copy leaves the app's models
// pointed at an unconnected instance and every query hangs. See
// qa/backend-tests/features/support/hooks.js for the identical constraint.
const mongoose = require('../../../../dev/backend/node_modules/mongoose');
const routes = require('../../../../dev/backend/src/routes');
const { setupWebsocket } = require('../../../../dev/backend/src/websocket');
const Dev = require('../../../../dev/backend/src/models/Dev');

let mongod;
let server;

function stubGithubApi() {
  nock.disableNetConnect();
  nock.enableNetConnect((host) => host.includes('127.0.0.1') || host.includes('localhost'));

  // `name` is omitted (not set to null) so DevController's `name = login` default parameter
  // actually kicks in (it only triggers on `undefined`, not an explicit `null`) — the
  // rendered .dev-item then shows the github_username, which the feature-file assertions
  // key off of.
  nock('https://api.github.com')
    .persist()
    .get(/^\/users\/.+/)
    .reply(200, (uri) => {
      const username = uri.replace('/users/', '');
      return {
        login: username,
        avatar_url: 'https://avatars.githubusercontent.com/u/0?v=4',
        bio: 'Integration test fixture',
      };
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

  return router;
}

async function startBackend(port) {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  stubGithubApi();

  const app = express();
  server = http.Server(app);
  setupWebsocket(server);

  app.use(cors());
  app.use(express.json());
  app.use('/__test__', testRoutes());
  app.use(routes);

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
