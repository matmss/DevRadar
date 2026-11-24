const { startBackend, stopBackend } = require('./backend-server');

// Fixed on purpose (not dynamically allocated) so it can be baked into
// playwright.config.js's webServer.env as VITE_API_URL without any
// cross-process coordination. Deliberately different from the real dev backend's 3333 so
// this suite doesn't collide with (or accidentally hit) a developer's already-running app.
const INTEGRATION_BACKEND_PORT = 3334;

module.exports = async function globalSetup() {
  await startBackend(INTEGRATION_BACKEND_PORT);
  return async function globalTeardown() {
    await stopBackend();
  };
};

module.exports.INTEGRATION_BACKEND_PORT = INTEGRATION_BACKEND_PORT;
