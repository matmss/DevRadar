// Steps for features/auth-review.feature (QA review of auth slices 2 and 3). Reuses the sign-in
// fake of auth.steps.js through its steps ("GitHub will sign me in as", "I am signed in with
// GitHub as"): that fake is a context.route, so it also serves a second tab of the same context.
const { createBdd } = require('playwright-bdd');
const { expect } = require('@playwright/test');
// Same copy dev/backend signs with, so the stored token is built like a real one.
const jwt = require('../../../../dev/backend/node_modules/jsonwebtoken');
const { INTEGRATION_BACKEND_PORT } = require('../support/global-setup');
const { TEST_JWT_SECRET, githubUserFixture } = require('../support/auth-fixtures');

const { Given, When, Then } = createBdd();

const BACKEND_URL = `http://localhost:${INTEGRATION_BACKEND_PORT}`;
const WEB_ORIGIN = 'http://localhost:3000';
const SESSION_TOKEN_KEY = 'devradar.session_token';
const SIGN_IN_BUTTON = 'Entrar com GitHub';
const SIGN_OUT_BUTTON = 'Sair';

// Per scenario (one browser context each): the second tab, and what the first tab showed and
// registered.
const secondTabs = new WeakMap();
const firstTabRegistrations = new WeakMap();

/** @param {string} login @returns {string} a valid session token, shaped like POST /auth/token's */
function validSessionToken(login) {
  const iat = Math.floor(Date.now() / 1000);
  const { name, avatar_url, bio } = githubUserFixture(login);
  return jwt.sign(
    { sub: login, iss: 'devradar', iat, exp: iat + 3600, profile: { name, avatar_url, bio } },
    TEST_JWT_SECRET,
    { algorithm: 'HS256' }
  );
}

/**
 * Answers `method path` on the harness backend with `status` + `body` (and its CORS preflight),
 * letting every other request through to the real backend.
 */
async function fakeBackendAnswer(page, method, path, status, body) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': WEB_ORIGIN,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  await page.route(`${BACKEND_URL}${path}`, async (route) => {
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

/** @returns {Promise<string[]>} the logins of every developer in the harness backend */
async function backendLogins() {
  const res = await fetch(`${BACKEND_URL}/devs`);
  if (!res.ok) throw new Error(`Failed to list the backend's developers: ${res.status}`);
  return (await res.json()).map((dev) => dev.github_username);
}

async function openSecondTab(context) {
  const tab = await context.newPage();
  secondTabs.set(context, tab);
  await tab.goto('/');
  await expect(tab.getByRole('button', { name: SIGN_OUT_BUTTON })).toBeVisible();
  return tab;
}

// --- Given -------------------------------------------------------------------------------------

Given('the backend answers GET \\/auth\\/me with {int} and body {string}', async function ({ page }, status, body) {
  await fakeBackendAnswer(page, 'GET', '/auth/me', status, body);
});

Given('the backend answers POST \\/devs with {int} and body {string}', async function ({ page }, status, body) {
  await fakeBackendAnswer(page, 'POST', '/devs', status, body);
});

// --- When --------------------------------------------------------------------------------------

When('I fill in techs {string} and double-click submit', async function ({ page }, techs) {
  const posts = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url() === `${BACKEND_URL}/devs`) posts.push(request);
  });
  await page.getByLabel('Tecnologias').fill(techs);
  await page.getByRole('button', { name: 'Salvar' }).dblclick();
  // Let every request the double-click started be sent, then wait for all of their answers, so
  // the backend check below cannot run between the first insert and the second.
  await page.waitForTimeout(500);
  await Promise.all(posts.map((request) => request.response()));
});

When('in a second tab I sign out and sign in with GitHub', async function ({ context }) {
  const tab = await openSecondTab(context);
  await tab.getByRole('button', { name: SIGN_OUT_BUTTON }).click();
  await tab.getByRole('button', { name: SIGN_IN_BUTTON }).click();
  await expect(tab.getByTestId('signed-in-username')).toHaveText('alice');
});

When('in a second tab I sign out', async function ({ context }) {
  const tab = await openSecondTab(context);
  await tab.getByRole('button', { name: SIGN_OUT_BUTTON }).click();
  await expect(tab.getByRole('button', { name: SIGN_IN_BUTTON })).toBeVisible();
});

When('I fill in techs {string} and submit in the first tab', async function ({ page, context }, techs) {
  await page.bringToFront();
  const signedOut = (await page.getByLabel('Tecnologias').count()) === 0;
  if (signedOut) {
    // The first tab followed the other tab's sign-out: it cannot register anyone. Acceptable.
    firstTabRegistrations.set(context, { shown: null, registered: null });
    return;
  }
  const shown = await page.getByTestId('signed-in-username').textContent();
  await page.getByLabel('Tecnologias').fill(techs);
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && res.url() === `${BACKEND_URL}/devs`),
    page.getByRole('button', { name: 'Salvar' }).click(),
  ]);
  const body = await response.json().catch(() => ({}));
  firstTabRegistrations.set(context, { shown, registered: body.github_username || null });
});

When('I open the DevRadar web app with a stored session token for {string}', async function ({ page }, login) {
  await page.goto('/');
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [SESSION_TOKEN_KEY, validSessionToken(login)]);
  await page.reload();
});

// --- Then --------------------------------------------------------------------------------------

Then('reloading the page should show exactly {int} entry for {string}', async function ({ page }, count, login) {
  await page.reload();
  await expect(page.getByTestId('signed-in-username')).toBeVisible();
  // The list renders from one GET /devs answer, so it goes from 0 straight to the stored count.
  await expect(page.locator('.dev-item', { hasText: login })).toHaveCount(count);
  expect(await backendLogins()).toEqual(Array(count).fill(login));
});

Then('the developer registered from the first tab should be the user it showed', async function ({ context }) {
  const { shown, registered } = firstTabRegistrations.get(context);
  expect(registered, `the first tab showed "${shown}" but registered "${registered}"`).toBe(shown);
});

Then('the first tab should eventually show the signed-out view', async function ({ page }) {
  await expect(page.getByRole('button', { name: SIGN_IN_BUTTON })).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);
  await expect(page.locator('.dev-item')).toHaveCount(0);
});

Then('I should get visible feedback that the registration did not happen', async function ({ page }) {
  const signInButton = page.getByRole('button', { name: SIGN_IN_BUTTON });
  await expect(signInButton.or(page.getByRole('alert'))).toBeVisible();
});

Then('the view should match the stored session', async function ({ page }) {
  const signInButton = page.getByRole('button', { name: SIGN_IN_BUTTON });
  const signedInUser = page.getByTestId('signed-in-username');
  await expect(signInButton.or(signedInUser)).toBeVisible();
  const token = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_KEY);
  if (await signInButton.isVisible()) {
    expect(token, 'the signed-out view is shown, but a valid session token is still stored').toBeNull();
  } else {
    expect(token, 'signed in, so the session token should be stored').not.toBeNull();
  }
});
