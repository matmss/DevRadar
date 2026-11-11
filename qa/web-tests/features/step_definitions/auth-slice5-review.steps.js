// Steps for features/auth-slice5-review.feature (QA review of auth slice 5). Everything else in
// those scenarios reuses the profile.feature, registration.feature and auth.feature steps.
const { createBdd } = require('playwright-bdd');
const { expect } = require('@playwright/test');
const { INTEGRATION_BACKEND_PORT } = require('../support/global-setup');

const { Given, Then } = createBdd();

const BACKEND_URL = `http://127.0.0.1:${INTEGRATION_BACKEND_PORT}`;
const WEB_ORIGIN = 'http://127.0.0.1:3000';

/**
 * Answers `method /devs/me` on the harness backend with `status` + `body`, and answers its CORS
 * preflight (without it axios would see a network error, and a scenario could pass through the
 * "server unreachable" path instead). Every other request to /devs/me reaches the real backend.
 * Only for answers the slice 5 backend cannot produce, such as a 404 that is not dev_not_found.
 */
Given(
  'the backend answers {word} \\/devs\\/me with {int} and body {string}',
  async function ({ page }, method, status, body) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': WEB_ORIGIN,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    };
    await page.route(`${BACKEND_URL}/devs/me`, async (route) => {
      const requestMethod = route.request().method();
      if (requestMethod === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders });
      } else if (requestMethod === method) {
        await route.fulfill({ status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body });
      } else {
        await route.continue();
      }
    });
  }
);

// App.js MESSAGES.profileDeleted, "Perfil exclu<U+00ED>do", built from code points so this file
// stays ASCII.
const PROFILE_DELETED = `Perfil exclu${String.fromCodePoint(0xed)}do`;

Then('I should not be told that my profile was deleted', async function ({ page }) {
  await expect(page.getByRole('status').filter({ hasText: PROFILE_DELETED })).toHaveCount(0);
});
