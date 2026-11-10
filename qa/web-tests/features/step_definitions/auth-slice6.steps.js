// Steps for features/auth-slice6.feature. Reuses the sign-in fake (auth.steps.js), the stored
// token steps (auth-review.steps.js) and the profile steps (profile.steps.js).
const { createBdd } = require('playwright-bdd');
const { expect } = require('@playwright/test');
const { INTEGRATION_BACKEND_PORT } = require('../support/global-setup');
const { githubIdFor, inspectorAuthHeaders } = require('../support/auth-fixtures');

const { Then } = createBdd();

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
