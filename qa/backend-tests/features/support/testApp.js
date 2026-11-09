/**
 * Builds the in-process Express + Socket.io app the scenarios drive, WITHOUT calling
 * server.listen() or requiring index.js (index.js throws if MONGO_URI is unset and
 * auto-listens on import).
 *
 * It uses the same createServer() that dev/backend/src/index.js uses (dev/backend/src/app.js),
 * so middleware order (trust proxy, CORS, JSON body, routes, error handler) and the Socket.io
 * wiring cannot drift from production.
 *
 * index.js's boot-time assertAuthConfig() is deliberately not called: it is a no-op outside
 * NODE_ENV=production, and features/support/auth-config.js sets the auth env for scenarios.
 * TRUST_PROXY is read when the app is built, so a scenario that changes it rebuilds the app.
 */
// Path assumes this test package lives at repo-root/qa/backend-tests.
const { createServer } = require('../../../../dev/backend/src/app');

/** @returns {{ app: import('express').Express, server: import('http').Server }} */
function createTestApp() {
  return createServer();
}

module.exports = { createTestApp };
