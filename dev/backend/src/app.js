// Builds the Express app. Shared by index.js and the test harnesses
// (qa/backend-tests/features/support/testApp.js, qa/web-tests/features/support/backend-server.js),
// so middleware order cannot drift between production and tests.
//
// Each createApp()/createServer() call builds its own server context (serverContext.js): its own
// sockets and write queue. Two servers in one process share only MongoDB, which since
// multi-instance PR1 holds the OAuth state, the sign-in codes and the rate-limit counters (so
// every instance sees the same ones), plus config/auth.js's per-process fallback JWT secret when
// JWT_SECRET is unset outside production (the deliberate exception; separate processes need one
// JWT_SECRET).
const express = require('express');
const cors = require('cors');
const http = require('http');

const { createRoutes } = require('./routes');
const { createServerContext } = require('./serverContext');
const { corsOptions } = require('./config/cors');
const { trustProxySetting } = require('./config/proxy');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

/**
 * @typedef {{
 *   beforeRoutes?: (app: import('express').Express) => void,
 *   context?: import('./serverContext').ServerContext,
 * }} AppOptions
 *   `beforeRoutes` mounts extra routers after body parsing and before the API routes (test
 *   harnesses use it for seed/reset endpoints). The error handler still comes last.
 *   `context`: the server context to wire the routes to; default: a fresh one.
 */

/**
 * @param {AppOptions} [options]
 * @returns {import('express').Express} with its context in `app.locals.context`
 */
function createApp({ beforeRoutes, context = createServerContext() } = {}) {
  const app = express();
  app.locals.context = context;
  app.set('trust proxy', trustProxySetting());

  app.use(cors(corsOptions));
  app.use(express.json());
  if (beforeRoutes) beforeRoutes(app);
  app.use(createRoutes(context));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Creates the app plus the HTTP server Socket.io shares (not listening yet), around one fresh
 * server context.
 * @param {{ beforeRoutes?: (app: import('express').Express) => void }} [options]
 * @returns {{ app: import('express').Express, server: import('http').Server,
 *   context: import('./serverContext').ServerContext }}
 */
function createServer({ beforeRoutes } = {}) {
  const context = createServerContext();
  const app = createApp({ beforeRoutes, context });
  const server = http.Server(app);
  context.realtime.attach(server);
  return { app, server, context };
}

module.exports = { createApp, createServer };
