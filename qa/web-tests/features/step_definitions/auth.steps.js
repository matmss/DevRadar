// GitHub sign-in steps for the web app (features/auth.feature, and the sign-in step every
// registration scenario starts with).
//
// GitHub's authorize page is faked at the network level. Playwright does not route requests that
// a redirect leads to, so the browser's visit to github.com cannot be intercepted directly.
// Instead the browser's request to the real backend's GET /auth/github is routed: Playwright
// performs it for real (route.fetch, redirects not followed), reads the backend's 302 to
// https://github.com/login/oauth/authorize, and answers the browser with a 302 straight to the
// real backend callback, as GitHub would after the consent screen: the `state` the backend
// issued plus either code "fake-code-<login>" (approve) or error=access_denied (cancel). The
// browser never contacts github.com. The harness backend's nock fakes turn that code into the
// fixture GitHub user (support/backend-server.js, support/auth-fixtures.js). Any backend answer
// that is not a redirect to GitHub (e.g. a 400) is passed to the browser unchanged.
const { createBdd } = require('playwright-bdd');
const { expect } = require('@playwright/test');
// Same copy dev/backend signs with, so a forged expired token is built like a real one.
const jwt = require('../../../../dev/backend/node_modules/jsonwebtoken');
const { INTEGRATION_BACKEND_PORT } = require('../support/global-setup');
const {
  TEST_JWT_SECRET,
  FAKE_CODE_PREFIX,
  GITHUB_DOWN_CODE,
  githubUserFixture,
} = require('../support/auth-fixtures');

const { Given, When, Then } = createBdd();

const BACKEND_URL = `http://localhost:${INTEGRATION_BACKEND_PORT}`;
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const isSignInStart = (url) => url.origin === BACKEND_URL && url.pathname === '/auth/github';
// Keys the web app uses (dev/web/src/services/session.js, services/auth.js).
const SESSION_TOKEN_KEY = 'devradar.session_token';
const PKCE_VERIFIER_KEY = 'devradar.pkce_verifier';
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

const SIGN_IN_BUTTON = 'Entrar com GitHub';
const SIGN_OUT_BUTTON = 'Sair';

// Authorize URLs the browser visited, per browser context (one context per scenario).
const authorizeVisits = new WeakMap();
// Requests the browser itself sent to github.com, per browser context (must stay empty).
const githubRequests = new WeakMap();

/**
 * Replaces any previous GitHub fake for this scenario. `outcome` builds the callback query from
 * the authorize URL's state.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {(state: string) => Record<string, string>} outcome
 */
async function fakeGithubAuthorize(context, outcome) {
  await context.unroute(isSignInStart);
  if (!authorizeVisits.has(context)) {
    authorizeVisits.set(context, []);
    // Proof that the fake held: the browser must never contact github.com itself.
    githubRequests.set(context, []);
    context.on('request', (request) => {
      const { hostname } = new URL(request.url());
      if (hostname === 'github.com' || hostname.endsWith('.github.com')) githubRequests.get(context).push(request.url());
    });
  }
  await context.route(isSignInStart, async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const location = response.headers().location || '';
    if (response.status() !== 302 || !location.startsWith(`${GITHUB_AUTHORIZE_URL}?`)) {
      await route.fulfill({ response });
      return;
    }
    const authorizeUrl = new URL(location);
    authorizeVisits.get(context).push(authorizeUrl);
    const callback = new URL('/auth/github/callback', BACKEND_URL);
    const params = outcome(authorizeUrl.searchParams.get('state') || '');
    Object.entries(params).forEach(([key, value]) => callback.searchParams.set(key, value));
    await route.fulfill({ status: 302, headers: { Location: callback.toString() } });
  });
}

const approveAs = (login) => (state) => ({ code: `${FAKE_CODE_PREFIX}${login}`, state });

/** @param {string} login @param {number} secondsAgo */
function expiredSessionToken(login, secondsAgo = 3600) {
  const exp = Math.floor(Date.now() / 1000) - secondsAgo;
  const { name, avatar_url, bio } = githubUserFixture(login);
  return jwt.sign(
    { sub: login, iss: 'devradar', iat: exp - SEVEN_DAYS_SECONDS, exp, profile: { name, avatar_url, bio } },
    TEST_JWT_SECRET,
    { algorithm: 'HS256' }
  );
}

async function openWithStoredToken(page, token) {
  await page.goto('/');
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [SESSION_TOKEN_KEY, token]);
  await page.reload();
}

async function signInWithGithub(page) {
  await page.getByRole('button', { name: SIGN_IN_BUTTON }).click();
}

// --- Given -------------------------------------------------------------------------------------

Given('GitHub will sign me in as {string}', async function ({ context }, login) {
  await fakeGithubAuthorize(context, approveAs(login));
});

Given("I will cancel on GitHub's consent page", async function ({ context }) {
  await fakeGithubAuthorize(context, (state) => ({
    error: 'access_denied',
    error_description: 'The user has denied your application access.',
    state,
  }));
});

Given('GitHub will fail to sign me in', async function ({ context }) {
  await fakeGithubAuthorize(context, (state) => ({ code: GITHUB_DOWN_CODE, state }));
});

Given('I am signed in with GitHub as {string}', async function ({ page, context }, login) {
  await fakeGithubAuthorize(context, approveAs(login));
  await page.goto('/');
  await signInWithGithub(page);
  await expect(page.getByTestId('signed-in-username')).toHaveText(login);
  expect(githubRequests.get(context), 'the browser must not contact github.com').toEqual([]);
});

// --- When --------------------------------------------------------------------------------------

When('I sign in with GitHub', async function ({ page }) {
  await signInWithGithub(page);
});

When('I sign out', async function ({ page }) {
  await page.getByRole('button', { name: SIGN_OUT_BUTTON }).click();
});

When('I reload the page', async function ({ page }) {
  await page.reload();
});

When('my session token expires', async function ({ page }) {
  const login = await page.getByTestId('signed-in-username').textContent();
  const token = expiredSessionToken(login);
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [SESSION_TOKEN_KEY, token]);
});

When('I open the DevRadar web app with an expired session token for {string}', async function ({ page }, login) {
  await openWithStoredToken(page, expiredSessionToken(login));
});

When('I open the DevRadar web app with the session token {string}', async function ({ page }, token) {
  await openWithStoredToken(page, token);
});

When('I open the sign-in callback link {string}', async function ({ page }, link) {
  await page.goto(link);
});

// --- Then --------------------------------------------------------------------------------------

Then('I should see the signed-out view', async function ({ page }) {
  await expect(page.getByRole('button', { name: SIGN_IN_BUTTON })).toBeVisible();
  await expect(page.getByLabel('Tecnologias')).toHaveCount(0);
  await expect(page.locator('form')).toHaveCount(0);
  await expect(page.locator('.dev-item')).toHaveCount(0);
  await expect(page.getByRole('button', { name: SIGN_OUT_BUTTON })).toHaveCount(0);
});

Then('I should see the message {string}', async function ({ page }, message) {
  await expect(page.getByRole('alert')).toHaveText(message);
});

Then('I should see no message', async function ({ page }) {
  await expect(page.getByRole('alert')).toHaveCount(0);
});

Then('I should be signed in as {string}', async function ({ page }, login) {
  await expect(page.getByTestId('signed-in-username')).toHaveText(login);
  const avatar = page.getByRole('img', { name: `Avatar de ${login}` });
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveAttribute('src', githubUserFixture(login).avatar_url);
  await expect(page.getByRole('button', { name: SIGN_OUT_BUTTON })).toBeVisible();
  await expect(page.getByRole('button', { name: SIGN_IN_BUTTON })).toHaveCount(0);
});

Then('I should see the registration form', async function ({ page }) {
  await expect(page.getByLabel('Tecnologias')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar' })).toBeVisible();
});

Then('the registration form should have no username field', async function ({ page }) {
  await expect(page.getByLabel('Tecnologias')).toBeVisible();
  await expect(page.getByLabel('Usuário GitHub')).toHaveCount(0);
  await expect(page.locator('input[name="github_username"]')).toHaveCount(0);
});

Then('GitHub should have been asked for sign-in with a state and no extra scope', async function ({ context }) {
  const visits = authorizeVisits.get(context) || [];
  expect(visits).toHaveLength(1);
  const params = visits[0].searchParams;
  expect(params.get('client_id')).toBe('web-test-client-id');
  expect(params.get('redirect_uri')).toBe(`${BACKEND_URL}/auth/github/callback`);
  expect(params.get('state')).toBeTruthy();
  expect(params.has('scope')).toBe(false);
  expect(githubRequests.get(context)).toEqual([]);
});

Then('the address bar should show the app without a sign-in code', async function ({ page, baseURL }) {
  await expect(page).toHaveURL(new URL('/', baseURL).toString());
});

Then('the PKCE verifier should be cleared', async function ({ page }) {
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), PKCE_VERIFIER_KEY)).toBeNull();
});

Then('the session token should be cleared', async function ({ page }) {
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), SESSION_TOKEN_KEY)).toBeNull();
});
