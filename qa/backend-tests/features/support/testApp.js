/**
 * Builds the in-process Express + Socket.io app the scenarios drive, WITHOUT calling
 * server.listen() or requiring index.js (index.js throws if MONGO_URI is unset and
 * auto-listens on import).
 *
 * It uses the same createServer() that dev/backend/src/index.js uses (dev/backend/src/app.js),
 * so middleware order (trust proxy, CORS, JSON body, routes, error handler) and the Socket.io
 * wiring cannot drift from production. Each call is a fresh backend instance: its own server
 * context (dev/backend/src/serverContext.js: sockets, write queue), over the MongoDB state every
 * instance shares (OAuth states, sign-in codes, rate-limit counters; multi-instance PR1).
 *
 * index.js's boot-time assertAuthConfig() is deliberately not called: it is a no-op outside
 * NODE_ENV=production, and features/support/auth-config.js sets the auth env for scenarios.
 * TRUST_PROXY is read when the app is built, so a scenario that changes it rebuilds the app.
 */
// Path assumes this test package lives at repo-root/qa/backend-tests.
const { createServer } = require('../../../../dev/backend/src/app');
const { LOOPBACK } = require('./loopback');

/**
 * @typedef {{ app: import('express').Express, server: import('http').Server,
 *   context: import('../../../../dev/backend/src/serverContext').ServerContext }} TestInstance
 */

/** @returns {TestInstance} */
function createTestApp() {
  return createServer();
}

/**
 * Starts ANOTHER backend instance in this process (multi-instance scenarios), listening on
 * 127.0.0.1 (BUG-013, support/loopback.js). It has its own server context and shares with the
 * scenario's instance exactly what separate production instances share: the database (the
 * MongoMemoryServer behind mongoose's one connection, hooks.js, so also the shared sign-in values
 * and rate-limit counters) and the outside world (the nock GitHub mock is process-wide). hooks.js closes it after the scenario (`world.extraInstances`).
 * @param {object} world - the scenario's world
 * @returns {Promise<TestInstance & { port: number, url: string }>}
 */
async function startTestInstance(world) {
  const instance = createServer();
  world.extraInstances.push(instance);
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, LOOPBACK, resolve);
  });
  const { port } = instance.server.address();
  return { ...instance, port, url: `http://${LOOPBACK}:${port}` };
}

module.exports = { createTestApp, startTestInstance };
