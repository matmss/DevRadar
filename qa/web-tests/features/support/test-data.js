// Talks to the harness backend's test-only data routes (`/__test__/*`, defined in
// support/backend-server.js) from the Playwright worker that runs the step definitions.
const { INTEGRATION_BACKEND_PORT } = require('./global-setup');

const BACKEND_URL = `http://127.0.0.1:${INTEGRATION_BACKEND_PORT}`;

/** Deletes every developer in the harness backend's database. Throws if the backend refuses. */
async function resetBackend() {
  const res = await fetch(`${BACKEND_URL}/__test__/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to reset the backend's data: ${res.status}`);
}

module.exports = { resetBackend };
