const { createBdd } = require('playwright-bdd');
const { expect } = require('@playwright/test');
const { INTEGRATION_BACKEND_PORT } = require('../support/global-setup');
const { inspectorAuthHeaders } = require('../support/auth-fixtures');

const { Given, When, Then } = createBdd();

const BACKEND_URL = `http://127.0.0.1:${INTEGRATION_BACKEND_PORT}`;

Given('the browser grants geolocation permission at latitude {string} and longitude {string}', async function ({ context }, lat, lon) {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: Number(lat), longitude: Number(lon) });
});

Given('the browser denies geolocation permission', async function ({ context }) {
  // Playwright's default is "prompt" without grantPermissions — DevForm's
  // navigator.geolocation.getCurrentPosition error callback fires, leaving lat/lon blank.
  await context.clearPermissions();
});

// Talks to the real backend's test-only reset/seed routes (see
// features/support/backend-server.js) rather than mocking anything at the browser level —
// the app under test makes real HTTP calls to a real (ephemeral) MongoDB-backed server.

Given('the backend has no registered developers', async function () {
  const res = await fetch(`${BACKEND_URL}/__test__/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to reset the backend's data: ${res.status}`);
});

Given('the backend has {int} registered developers', async function ({}, count) {
  await fetch(`${BACKEND_URL}/__test__/reset`, { method: 'POST' });
  const res = await fetch(`${BACKEND_URL}/__test__/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count }),
  });
  if (!res.ok) throw new Error(`Failed to seed the backend's data: ${res.status}`);
});

When('I open the DevRadar web app', async function ({ page }) {
  await page.goto('/');
});

// The form has no username field: the backend registers the signed-in user (US-3).
When('I fill in techs {string} and submit', async function ({ page }, techs) {
  await page.getByLabel('Tecnologias').fill(techs);
  await page.getByRole('button', { name: 'Salvar' }).click();
});

When('I manually fill in latitude {string} and longitude {string}', async function ({ page }, lat, lon) {
  await page.getByLabel('Latitude').fill(lat);
  await page.getByLabel('Longitude').fill(lon);
});

Then('the latitude field should contain {string}', async function ({ page }, value) {
  await expect(page.getByLabel('Latitude')).toHaveValue(value);
});

Then('the longitude field should contain {string}', async function ({ page }, value) {
  await expect(page.getByLabel('Longitude')).toHaveValue(value);
});

Then('a new entry for {string} should appear in the developer list', async function ({ page }, username) {
  await expect(page.locator('.dev-item', { hasText: username })).toBeVisible();
});

Then('the techs field should be empty', async function ({ page }) {
  await expect(page.getByLabel('Tecnologias')).toHaveValue('');
});

Then('the developer list should show {int} entries', async function ({ page }, count) {
  await expect(page.locator('.dev-item')).toHaveCount(count);
});

Then('reloading the page should still show {string} in the developer list', async function ({ page }, username) {
  await page.reload();
  await expect(page.locator('.dev-item', { hasText: username })).toBeVisible();
});

Then('I should see the error {string}', async function ({ page }, message) {
  await expect(page.getByRole('alert')).toContainText(message);
});

Then('the techs field should contain {string}', async function ({ page }, value) {
  await expect(page.getByLabel('Tecnologias')).toHaveValue(value);
});

// Checked over the real HTTP API, signed in as a test-only inspector (GET /devs requires a
// session token since auth slice 4).
async function backendDevs() {
  const res = await fetch(`${BACKEND_URL}/devs`, { headers: inspectorAuthHeaders() });
  if (!res.ok) throw new Error(`Failed to list the backend's developers: ${res.status}`);
  return res.json();
}

Then('the backend should have exactly {int} developer, {string}', async function ({}, count, username) {
  const devs = await backendDevs();
  expect(devs.map((dev) => dev.github_username)).toEqual(Array(count).fill(username));
});

Then('the backend should have no developers', async function () {
  expect(await backendDevs()).toEqual([]);
});
