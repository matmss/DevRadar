// Steps for features/auth-slice6-review.feature (QA review of auth slice 6: login refresh of a
// renamed GitHub account, and the old-session guard). Reuses the ownership, registration,
// profile and auth steps.
const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { completeSignIn } = require('./auth.steps');

Then(
  'the developer of GitHub account {int} should show github_username {string}',
  async function (githubId, username) {
    const dev = await Dev.findOne({ github_id: githubId }).lean();
    expect(dev, `GitHub account ${githubId} should own a developer`).to.not.be.null;
    expect(dev.github_username, `login shown by GitHub account ${githubId}'s developer`).to.equal(username);
  }
);

// A second sign-in of the same account, kept apart from the scenario's own (its own PKCE verifier
// and one-time code, distinct mock codes), stopped after the callback: GitHub GET /user has
// answered `username`, the one-time code is issued and not redeemed yet.
Given(
  'another device of GitHub account {int} reached the sign-in callback as {string} and holds its one-time code',
  async function (githubId, username) {
    const device = { app: this.app, signInCount: 900 };
    await completeSignIn(device, username, { id: githubId });
    this.otherDevice = { code: device.oneTimeCode, verifier: device.pkceVerifier };
  }
);

When('the other device redeems its one-time code', async function () {
  expect(this.otherDevice, 'a previous step should start the other device sign-in').to.not.equal(undefined);
  this.otherDevice.response = await request(this.app)
    .post('/auth/token')
    .send({ code: this.otherDevice.code, code_verifier: this.otherDevice.verifier });
});

Then("the other device's sign-in should succeed", function () {
  const { response } = this.otherDevice;
  expect(response.status, JSON.stringify(response.body)).to.equal(200);
  expect(response.body.token).to.be.a('string').that.is.not.empty;
});
