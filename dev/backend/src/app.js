// Builds the Express app. Shared by index.js and the test harnesses
// (qa/backend-tests/features/support/testApp.js, qa/web-tests/features/support/backend-server.js),
// so middleware order cannot drift between production and tests.
const express = require('express');
const cors = require('cors');
const http = require('http');

const routes = require('./routes');
const { setupWebsocket } = require('./websocket');
const { corsOptions } = require('./config/cors');
const { trustProxySetting } = require('./config/proxy');
const { errorHandler } = require('./middleware/errorHandler');

/**
 * @param {{ beforeRoutes?: (app: import('express').Express) => void }} [options]
 *   `beforeRoutes` mounts extra routers after body parsing and before the API routes (test
 *   harnesses use it for seed/reset endpoints). The error handler still comes last.
 * @returns {import('express').Express}
 */
function createApp({ beforeRoutes } = {}) {
  const app = express();
  app.set('trust proxy', trustProxySetting());

  app.use(cors(corsOptions));
  app.use(express.json());
  if (beforeRoutes) beforeRoutes(app);
  app.use(routes);
  app.use(errorHandler);

  return app;
}

/**
 * Creates the app plus the HTTP server Socket.io shares (not listening yet).
 * @param {{ beforeRoutes?: (app: import('express').Express) => void }} [options]
 * @returns {{ app: import('express').Express, server: import('http').Server }}
 */
function createServer(options) {
  const app = createApp(options);
  const server = http.Server(app);
  setupWebsocket(server);
  return { app, server };
}

module.exports = { createApp, createServer };
