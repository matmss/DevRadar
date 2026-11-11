// Steps for features/profile.feature: the update form, "Atualizar" and "Excluir meu perfil"
// (US-6 "Already registered", US-4; auth slice 5).
const { createBdd } = require('playwright-bdd');
const { expect } = require('@playwright/test');
const { INTEGRATION_BACKEND_PORT } = require('../support/global-setup');
const { harnessSessionToken, inspectorAuthHeaders } = require('../support/auth-fixtures');

const { Given, When, Then } = createBdd();

const BACKEND_URL = `http://127.0.0.1:${INTEGRATION_BACKEND_PORT}`;
const PUT_DELAY_MS = 1500;

const isPutMe = (request) => request.method() === 'PUT' && request.url() === `${BACKEND_URL}/devs/me`;

// Per browser context (one per scenario).
const dialogs = new WeakMap();
const sentUpdates = new WeakMap();

/** @returns {Promise<object[]>} every developer, over the real HTTP API */
async function backendDevs() {
  const res = await fetch(`${BACKEND_URL}/devs`, { headers: inspectorAuthHeaders() });
  if (!res.ok) throw new Error(`Failed to list the backend's developers: ${res.status}`);
  return res.json();
}

/** @param {string} login @returns {Promise<object | undefined>} matched case-insensitively */
async function backendDev(login) {
  return (await backendDevs()).find((dev) => dev.github_username.toLowerCase() === login.toLowerCase());
}

// --- Given -------------------------------------------------------------------------------------

Given(
  'the backend has a developer {string} with techs {string} at latitude {string} and longitude {string}',
  async function ({}, github_username, techs, latitude, longitude) {
    const res = await fetch(`${BACKEND_URL}/__test__/seed-dev`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github_username, techs, latitude, longitude }),
    });
    if (!res.ok) throw new Error(`Failed to seed developer "${github_username}": ${res.status}`);
  }
);

// Any window.alert/confirm/prompt is recorded and dismissed (an unhandled one would block the page).
Given('native dialogs are watched', async function ({ page, context }) {
  dialogs.set(context, []);
  page.on('dialog', async (dialog) => {
    dialogs.get(context).push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.dismiss();
  });
});

// Only delays the real request (the real backend still answers it), and counts what is sent.
Given('the backend answers PUT \\/devs\\/me slowly', async function ({ page, context }) {
  sentUpdates.set(context, 0);
  await page.route((url) => url.origin === BACKEND_URL && url.pathname === '/devs/me', async (route) => {
    if (!isPutMe(route.request())) {
      await route.fallback();
      return;
    }
    sentUpdates.set(context, sentUpdates.get(context) + 1);
    await new Promise((resolve) => setTimeout(resolve, PUT_DELAY_MS));
    await route.continue();
  });
});

// Another device of the same user deletes the profile through the real API.
Given('my profile is deleted from another device', async function ({ page }) {
  const login = await page.getByTestId('signed-in-username').textContent();
  const res = await fetch(`${BACKEND_URL}/devs/me`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${harnessSessionToken(login)}` },
  });
  expect(res.status).toBe(204);
});

/** Calls the real API as the signed-in user from "another device" (a fresh harness token). */
async function asOtherDevice(page, method, path, body) {
  const login = await page.getByTestId('signed-in-username').textContent();
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${harnessSessionToken(login)}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.status;
}

Given('my profile is registered from another device with techs {string}', async function ({ page }, techs) {
  // Wait until this tab has decided it has no profile (registration form), then register elsewhere.
  await expect(page.getByRole('button', { name: 'Salvar' })).toBeVisible();
  expect(await asOtherDevice(page, 'POST', '/devs', { techs, latitude: '-23.5505', longitude: '-46.6333' })).toBe(200);
});

Given('my profile is deleted and registered again from another device with techs {string}', async function ({ page }, techs) {
  await expect(page.getByRole('button', { name: 'Atualizar' })).toBeVisible();
  expect(await asOtherDevice(page, 'DELETE', '/devs/me')).toBe(204);
  expect(await asOtherDevice(page, 'POST', '/devs', { techs, latitude: '-23.5505', longitude: '-46.6333' })).toBe(200);
});

// --- When --------------------------------------------------------------------------------------

When(
  'I change techs to {string}, latitude to {string} and longitude to {string} and update',
  async function ({ page }, techs, latitude, longitude) {
    await page.getByLabel('Tecnologias').fill(techs);
    await page.getByLabel('Latitude').fill(latitude);
    await page.getByLabel('Longitude').fill(longitude);
    await page.getByRole('button', { name: 'Atualizar' }).click();
  }
);

When('I change techs to {string} and double-click {string}', async function ({ page }, techs, name) {
  await page.getByLabel('Tecnologias').fill(techs);
  await page.getByRole('button', { name }).dblclick();
});

When('I click {string}', async function ({ page }, name) {
  await page.getByRole('button', { name }).click();
});

When('I confirm the deletion', async function ({ page }) {
  await page.getByRole('button', { name: 'Confirmar exclusão' }).click();
});

When('I cancel the deletion', async function ({ page }) {
  await page.getByRole('button', { name: 'Cancelar' }).click();
});

// --- Then --------------------------------------------------------------------------------------

Then('the form should be in update mode', async function ({ page }) {
  await expect(page.getByRole('button', { name: 'Atualizar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excluir meu perfil' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar' })).toHaveCount(0);
});

Then('the form should be in registration mode', async function ({ page }) {
  await expect(page.getByRole('button', { name: 'Salvar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Atualizar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Excluir meu perfil' })).toHaveCount(0);
});

Then('I should see the status {string}', async function ({ page }, message) {
  await expect(page.getByRole('status')).toHaveText(message);
});

Then('I should see a status containing {string}', async function ({ page }, message) {
  await expect(page.getByRole('status')).toContainText(message);
});

Then('the entry for {string} in the developer list should show techs {string}', async function ({ page }, login, techs) {
  const entry = page.locator('.dev-item', { hasText: login });
  await expect(entry).toHaveCount(1);
  await expect(entry.locator('.user-info span')).toHaveText(techs);
});

Then('there should be no entry for {string} in the developer list', async function ({ page }, login) {
  await expect(page.locator('.dev-item', { hasText: login })).toHaveCount(0);
});

Then(
  'the backend should have {string} with techs {string} at latitude {string} and longitude {string}',
  async function ({}, login, techs, latitude, longitude) {
    await expect.poll(async () => {
      const dev = await backendDev(login);
      return dev && { techs: dev.techs.join(','), coordinates: dev.location.coordinates };
    }).toEqual({ techs, coordinates: [Number(longitude), Number(latitude)] });
  }
);

Then('the backend should still have {string}', async function ({}, login) {
  expect(await backendDev(login)).toBeTruthy();
});

Then('the backend should not have {string}', async function ({}, login) {
  await expect.poll(async () => Boolean(await backendDev(login))).toBe(false);
});

Then('I should be asked to confirm the deletion in the page', async function ({ page }) {
  const confirmation = page.getByRole('group');
  await expect(confirmation).toContainText('Excluir seu perfil do DevRadar?');
  await expect(page.getByRole('button', { name: 'Confirmar exclusão' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancelar' })).toBeVisible();
});

Then('I should not be asked to confirm the deletion', async function ({ page }) {
  await expect(page.getByRole('button', { name: 'Confirmar exclusão' })).toHaveCount(0);
});

Then('no native dialog should have been opened', async function ({ context }) {
  expect(dialogs.get(context)).toEqual([]);
});

Then('the {string} button should be disabled until the update is answered', async function ({ page }, name) {
  await expect(page.getByRole('button', { name })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Excluir meu perfil' })).toBeDisabled();
  await page.waitForResponse((response) => isPutMe(response.request()));
  await expect(page.getByRole('button', { name })).toBeEnabled();
});

Then('exactly {int} PUT \\/devs\\/me request(s) should have been sent', async function ({ context }, count) {
  expect(sentUpdates.get(context)).toBe(count);
});
