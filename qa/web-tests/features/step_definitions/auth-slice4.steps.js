// Steps for features/auth-slice4.feature. Reuses the sign-in fake (auth.steps.js) and "I open
// the DevRadar web app with a stored session token for" (auth-review.steps.js).
const { createBdd } = require('playwright-bdd');
const { expect } = require('@playwright/test');
const { INTEGRATION_BACKEND_PORT } = require('../support/global-setup');
const { harnessSessionToken } = require('../support/auth-fixtures');

const { Given, Then } = createBdd();

const BACKEND_URL = `http://localhost:${INTEGRATION_BACKEND_PORT}`;
const WEB_ORIGIN = 'http://localhost:3000';
const SESSION_TOKEN_KEY = 'devradar.session_token';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': WEB_ORIGIN,
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const isDevsList = (request) => request.method() === 'GET' && request.url() === `${BACKEND_URL}/devs`;

/** @param {string} token @returns {string} the JWT's subject (GitHub login) */
function loginOf(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub;
}

// --- Given -------------------------------------------------------------------------------------

// The real backend cannot answer a valid token with 401 on GET /devs while GET /auth/me accepts
// it, so this one answer is faked (with its CORS preflight); everything else is real.
Given('the backend answers GET \\/devs with {int} and body {string}', async function ({ page }, status, body) {
  await page.route(`${BACKEND_URL}/devs`, async (route) => {
    const method = route.request().method();
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
    } else if (method === 'GET') {
      await route.fulfill({ status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, body });
    } else {
      await route.continue();
    }
  });
});

// While this tab's GET /devs (sent with its current token) is in flight, a new session for
// `login` is written to localStorage, as another tab signing in would. This tab gets no storage
// event for its own page.evaluate, so it handles the 401 before knowing about the change.
Given(
  'the next GET \\/devs will be answered {int} {string} after another tab signs in as {string}',
  async function ({ page }, status, code, login) {
    let answered = false;
    await page.route(`${BACKEND_URL}/devs`, async (route) => {
      if (answered || route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      answered = true;
      await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [SESSION_TOKEN_KEY, harnessSessionToken(login)]);
      await route.fulfill({
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Session expired, sign in again', code, details: [] }),
      });
    });
  }
);

// Holds every request to GET /auth/me (and its preflight) without answering. "I try again"
// (auth.steps.js) removes the route, so the retry reaches the real backend.
Given('the backend never answers GET \\/auth\\/me', async function ({ page }) {
  await page.route(`${BACKEND_URL}/auth/me`, () => new Promise(() => {}));
});

// --- Then --------------------------------------------------------------------------------------

Then('reloading the page should request the developer list with my session token', async function ({ page }) {
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_KEY);
  expect(stored).toBeTruthy();
  const [request] = await Promise.all([page.waitForRequest(isDevsList), page.reload()]);
  expect(await request.headerValue('authorization')).toBe(`Bearer ${stored}`);
  expect(request.url()).not.toContain(stored);
});

Then('the stored session token should belong to {string}', async function ({ page }, login) {
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_KEY);
  expect(stored, 'a session token should still be stored').toBeTruthy();
  expect(loginOf(stored)).toBe(login);
});

Then('within {int} seconds I should see the message {string}', async function ({ page }, seconds, message) {
  await expect(page.getByRole('alert')).toHaveText(message, { timeout: seconds * 1000 });
});
