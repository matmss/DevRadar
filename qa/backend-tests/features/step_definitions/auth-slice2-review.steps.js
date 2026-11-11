// Steps for features/auth-slice2-review.feature (QA review of auth slices 2 and 3).
const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { testSessionToken } = require('../support/session');

/**
 * Sends one POST /devs per token, all started before any is awaited, so the requests overlap
 * in the backend the way a double-click or two tabs do.
 * @param {object} world
 * @param {string[]} tokens
 * @param {object} body
 */
async function postConcurrently(world, tokens, body) {
  world.concurrentResponses = await Promise.all(
    tokens.map((token) => request(world.app)
      .post('/devs')
      .set('Authorization', `Bearer ${token}`)
      .send(body))
  );
}

// The same GitHub account (the fixture id is case-insensitive), signed in with another letter case.
Given('a second session token for {string}', function (username) {
  this.secondSessionToken = testSessionToken(username);
});

When(
  'I submit {int} registrations at the same time with techs {string}, latitude {string} and longitude {string}',
  async function (count, techs, latitude, longitude) {
    const tokens = Array.from({ length: count }, () => this.sessionToken);
    await postConcurrently(this, tokens, { techs, latitude, longitude });
  }
);

When(
  'both sessions submit a registration at the same time with techs {string}, latitude {string} and longitude {string}',
  async function (techs, latitude, longitude) {
    await postConcurrently(this, [this.sessionToken, this.secondSessionToken], { techs, latitude, longitude });
  }
);

Then('every concurrent registration should succeed with status {int}', function (status) {
  expect(this.concurrentResponses.map((res) => res.status)).to.deep.equal(this.concurrentResponses.map(() => status));
});

Then('every concurrent registration should return the same developer', function () {
  const ids = new Set(this.concurrentResponses.map((res) => String(res.body._id)));
  expect([...ids], 'all responses should be the one stored developer').to.have.lengthOf(1);
});

Then('exactly {int} developer should match github_username {string} case-insensitively', async function (count, username) {
  const devs = await Dev.find({ github_username: username }).collation({ locale: 'en', strength: 2 }).lean();
  expect(devs.map((dev) => dev.github_username)).to.have.lengthOf(count);
});
