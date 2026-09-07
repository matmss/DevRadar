/**
 * Test-data seeding helper for mobile E2E scenarios.
 *
 * The mobile app itself has no seeding mechanism — it only talks to whatever backend
 * MOBILE_API_URL / MOBILE_SOCKET_URL point at (see BUG-001: these are currently hardcoded
 * in dev/mobile/src/services/api.js and socket.js rather than env-configurable; fixing that is
 * a prerequisite for pointing E2E runs at a disposable CI backend instance). Once fixed,
 * this helper calls that backend's real POST /devs endpoint directly — no mocking — so
 * mobile E2E runs are true integration tests against the real API contract.
 */
const axios = require('axios');

const API_URL = process.env.MOBILE_TEST_API_URL || 'http://localhost:3333';

// The backend validates github_username against the real GitHub API (no mocking here -
// see the file header), so a synthetic name like "e2e-fixture-<ts>" 404s. GitHub's API
// is case-insensitive (login always normalizes back to "octocat"), but Mongo's
// `Dev.findOne({ github_username })` in DevController.store matches the raw string
// exactly - so a random case variant of a real, stable account resolves successfully
// on GitHub while still reading as a fresh, distinct fixture on every call.
function randomCaseVariant(username) {
  return username
    .split('')
    .map((c) => (Math.random() < 0.5 ? c.toUpperCase() : c.toLowerCase()))
    .join('');
}

async function registerDeveloperViaApi({ techs, nearbyOf, githubUsername = randomCaseVariant('octocat') }) {
  const [longitude, latitude] = nearbyOf;
  return axios.post(`${API_URL}/devs`, {
    github_username: githubUsername,
    techs: techs.join(','),
    latitude,
    longitude,
  });
}

// Alias kept for readability at call sites that are describing a precondition ("Given
// developers ... exist") rather than an action ("When a developer registers").
const seedDeveloper = registerDeveloperViaApi;

module.exports = { registerDeveloperViaApi, seedDeveloper };
