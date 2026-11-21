// Steps for features/claim-guard.feature (dev/docs/05-claim-guard-spec.md, AC-18). Reuses the
// sign-in fake (auth.steps.js), the registration and profile steps and the displaced-entry steps
// of auth-slice6.steps.js.
const { createBdd } = require('playwright-bdd');
const { INTEGRATION_BACKEND_PORT } = require('../support/global-setup');

const { Given } = createBdd();

const BACKEND_URL = `http://127.0.0.1:${INTEGRATION_BACKEND_PORT}`;

// A legacy (pre-sign-in) developer: no github_id, and the avatar GitHub's GET /users/<login>
// answered at registration, which names the account that held the login then.
Given(
  'the backend has a legacy developer {string} named {string} with the avatar of GitHub account {int}, techs {string} at latitude {string} and longitude {string}',
  async function ({}, github_username, name, avatarId, techs, latitude, longitude) {
    const res = await fetch(`${BACKEND_URL}/__test__/seed-dev`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        github_username,
        name,
        avatar_url: `https://avatars.githubusercontent.com/u/${avatarId}?v=4`,
        techs,
        latitude,
        longitude,
      }),
    });
    if (!res.ok) throw new Error(`Failed to seed developer "${github_username}": ${res.status}`);
  }
);
