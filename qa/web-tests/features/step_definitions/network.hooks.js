// Scenario hooks for every web scenario: GitHub's hosts are faked locally and any request to
// them that no fake answered fails the scenario (support/github-network.js).
const { createBdd } = require('playwright-bdd');
const { expect } = require('@playwright/test');
const { installGithubNetworkGuard, unexpectedGithubRequests } = require('../support/github-network');

const { Before, After } = createBdd();

Before(async function ({ context }) {
  await installGithubNetworkGuard(context);
});

After(async function ({ context }) {
  expect(unexpectedGithubRequests(context), 'the browser must not contact GitHub').toEqual([]);
});
