const { Before, After, BeforeAll, AfterAll } = require('@cucumber/cucumber');
// Must be the SAME mongoose instance dev/backend/src/models/Dev.js uses (dev/backend/node_modules/mongoose),
// hence the path: the qa workspace has no mongoose of its own, and mongoose's connection is a module-level
// singleton, so connecting any other copy leaves the app's models pointed at an unconnected instance and
// every query hangs.
const mongoose = require('../../../../dev/backend/node_modules/mongoose');
const nock = require('nock');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createTestApp } = require('./testApp');
const { applyTestAuthEnv } = require('./auth-config');
const { watchGithubUsersApi } = require('./github-mock');
const Dev = require('../../../../dev/backend/src/models/Dev');
const AuthOneTime = require('../../../../dev/backend/src/models/AuthOneTime');
const RateLimit = require('../../../../dev/backend/src/models/RateLimit');

let mongod;

BeforeAll({ timeout: 60000 }, async function () {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
  // Build the Dev indexes (unique case-insensitive github_username) and the TTL indexes of the
  // shared sign-in and rate-limit collections before any scenario, as index.js does at startup.
  // Scenarios empty collections with deleteMany, so indexes persist.
  await Promise.all([Dev.init(), AuthOneTime.init(), RateLimit.init()]);
});

AfterAll({ timeout: 30000 }, async function () {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

Before(async function () {
  // Auth env is reset per scenario (a scenario may lower a rate limit or set TRUST_PROXY). Done
  // before building the app, which reads TRUST_PROXY.
  applyTestAuthEnv();

  // Fresh app + server per scenario, with a fresh server context (dev/backend/src/serverContext.js):
  // its own socket `connections` and write queue. The OAuth states, sign-in codes and rate-limit
  // counters are shared through MongoDB (auth_one_time, rate_limits) and emptied below with the
  // rest of the database, so nothing carries over from the previous scenario.
  const { app, server, context } = createTestApp();
  this.app = app;
  this.server = server;
  this.context = context;
  // More instances a multi-instance scenario starts (testApp.js startTestInstance), closed below.
  this.extraInstances = [];

  // Empty the DB between scenarios (Background steps like
  // "Given the developer database is empty" rely on this already being true). Every model's
  // collection, so also auth_one_time and rate_limits (their models are loaded with the app).
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
  // Belt and braces for the shared stores (the same documents; also what other harnesses call).
  await Promise.all([this.context.rateLimits.reset(), this.context.signInStores.clear()]);

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
  for (const { server } of this.extraInstances || []) {
    if (server.listening) await closeServer(server);
  }
  this.extraInstances = [];

  nock.cleanAll();
  nock.enableNetConnect();
});
