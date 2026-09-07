/**
 * Builds an in-process Express + Socket.io app identical in shape to dev/backend/src/index.js,
 * WITHOUT calling server.listen() or requiring index.js directly (index.js throws if
 * MONGO_URI is unset and auto-listens on import, which makes it unsuitable to import
 * directly in tests as written today).
 *
 * Recommended follow-up (tracked as BUG-009 in docs/05-bug-tracker.md): refactor
 * dev/backend/src/index.js to export { app, server } and guard `server.listen(...)` behind
 * `if (require.main === module)`, so tests can import the real entrypoint instead of this
 * parallel assembly. Until then, this file intentionally mirrors index.js's wiring exactly
 * (same routes.js, same websocket.js) so the two can't silently drift without someone
 * noticing during code review.
 */
const express = require('express');
const cors = require('cors');
const http = require('http');

// Path assumes this test package lives at repo-root/qa/backend-tests, i.e. two levels
// below repo-root (qa/ then backend-tests/), alongside repo-root/backend.
const routes = require('../../../../dev/backend/src/routes');
const { setupWebsocket } = require('../../../../dev/backend/src/websocket');

function createTestApp() {
  const app = express();
  const server = http.Server(app);

  setupWebsocket(server);

  app.use(cors());
  app.use(express.json());
  app.use(routes);

  return { app, server };
}

module.exports = { createTestApp };
