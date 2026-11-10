// Steps for features/auth-slice6.feature. Reuses the sign-in fake (auth.steps.js), the stored
// token steps (auth-review.steps.js) and the profile steps (profile.steps.js).
const { createBdd } = require('playwright-bdd');
const { expect } = require('@playwright/test');
const { INTEGRATION_BACKEND_PORT } = require('../support/global-setup');
const { githubIdFor, inspectorAuthHeaders } = require('../support/auth-fixtures');

const { Given, Then } = createBdd();

// A GitHub account id that no fixture login maps to (auth-fixtures.js githubIdFor is >= 1000000).
const OTHER_GITHUB_ACCOUNT = 4242;

Given(
  'the backend has a developer {string} named {string}, owned by another GitHub account, with techs {string} at latitude {string} and longitude {string}',
  async function ({}, github_username, name, techs, latitude, longitude) {
    const res = await fetch(`${BACKEND_URL}/__test__/seed-dev`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github_username, github_id: OTHER_GITHUB_ACCOUNT, name, techs, latitude, longitude }),
    });
    if (!res.ok) throw new Error(`Failed to seed developer "${github_username}": ${res.status}`);
  }
);

Then('the entry named {string} should have no GitHub link and say {string}', async function ({ page }, name, text) {
  const entry = page.locator('.dev-item', { has: page.locator('strong', { hasText: name }) });
  await expect(entry).toHaveCount(1);
  await expect(entry.getByRole('link')).toHaveCount(0);
  await expect(entry).toContainText(text);
  await expect(entry).not.toContainText('_stale_');
});

Then('exactly one entry should link to {string}', async function ({ page }, href) {
  await expect(page.locator(`.dev-item a[href="${href}"]`)).toHaveCount(1);
});

const BACKEND_URL = `http://localhost:${INTEGRATION_BACKEND_PORT}`;

/** @param {string} login @returns {Promise<object | undefined>} the backend's dev, exact login */
async function backendDevExactly(login) {
  const res = await fetch(`${BACKEND_URL}/devs`, { headers: inspectorAuthHeaders() });
  if (!res.ok) throw new Error(`Failed to list the backend's developers: ${res.status}`);
  return (await res.json()).find((dev) => dev.github_username === login);
}

Then("the backend's developer {string} should not belong to any GitHub account yet", async function ({}, login) {
  const dev = await backendDevExactly(login);
  expect(dev, `developer "${login}"`).toBeTruthy();
  expect(dev.github_id).toBeUndefined();
});

Then("the backend's developer {string} should belong to the GitHub account of {string}", async function ({}, login, owner) {
  await expect.poll(async () => {
    const dev = await backendDevExactly(login);
    return dev && dev.github_id;
  }).toBe(githubIdFor(owner));
});
