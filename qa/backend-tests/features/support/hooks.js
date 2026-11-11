const { Before, After, BeforeAll, AfterAll } = require('@cucumber/cucumber');
// Must be the SAME mongoose instance dev/backend/src/models/Dev.js uses (dev/backend/node_modules/mongoose),
// not this package's own copy — mongoose's connection is a module-level singleton, so connecting a
// different copy here leaves the app's models pointed at an unconnected instance and every query hangs.
const mongoose = require('../../../../dev/backend/node_modules/mongoose');
const nock = require('nock');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createTestApp } = require('./testApp');
const { applyTestAuthEnv } = require('./auth-config');
const { watchGithubUsersApi } = require('./github-mock');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { resetAuthRateLimit } = require('../../../../dev/backend/src/middleware/rateLimit');

let mongod;

BeforeAll({ timeout: 60000 }, async function () {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
  // Build the Dev indexes (unique case-insensitive github_username) before any scenario, as
  // index.js does at startup. Scenarios empty collections with deleteMany, so indexes persist.
  await Dev.init();
});

AfterAll({ timeout: 30000 }, async function () {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

Before(async function () {
  // Auth env is reset per scenario (a scenario may lower a rate limit or set TRUST_PROXY), and
  // the /auth rate limiters are module-level singletons, so their counts would otherwise carry
  // over. Done before building the app, which reads TRUST_PROXY.
  applyTestAuthEnv();
  await resetAuthRateLimit();

  // Fresh app + server per scenario. Note: websocket.js's `connections` array is module-level,
  // so it is shared across scenarios; entries are removed when sockets disconnect (After hook).
  const { app, server } = createTestApp();
  this.app = app;
  this.server = server;

  // Empty the DB between scenarios (Background steps like
  // "Given the developer database is empty" rely on this already being true).
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }

  nock.cleanAll();
  nock.disableNetConnect();
  nock.enableNetConnect('127.0.0.1'); // allow supertest/socket.io-client local traffic

  // The backend must never call GitHub's public users API (registration uses the profile
  // captured at sign-in). Recorded for every scenario; the After hook fails on any call.
  this.githubUsersApi = watchGithubUsersApi();
});

After(function () {
  if (!this.githubUsersApi) return;
  this.githubUsersApi.stop();
  const { calls } = this.githubUsersApi;
  if (calls.length > 0) {
    throw new Error(`The backend called GitHub's public users API: ${calls.join(', ')}`);
  }
});

// Closes everything a scenario opened, also after a step timed out mid-request: every client
// socket (connected or still connecting: disconnect() stops it either way), every connection to
// the scenario's server (server.close() alone waits for open connections, so a hung request would
// make this hook, and then the whole run, wait forever), and the server itself, bounded by a
// timeout. cucumber.js also sets forceExit, so a handle left behind by a timed-out step (e.g. a
// supertest server) cannot keep the process alive after the summary.
const CLOSE_TIMEOUT_MS = 2000;

/**
 * @param {import('http').Server} server
 * @returns {Promise<void>} resolves when closed, or after CLOSE_TIMEOUT_MS at the latest
 */
function closeServer(server) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
}

After(async function () {
  for (const socket of this.sockets) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  this.sockets = [];

  if (this.server && this.server.listening) {
    await closeServer(this.server);
  }

  nock.cleanAll();
  nock.enableNetConnect();
});
