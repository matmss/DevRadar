// Steps for features/profile-busy-review.feature (QA review of 503 profile_busy). Reuses the
// exhaustion stubs of profile-busy.steps.js ("every claim ... misses", restored by its After), the
// seeding steps of legacy-merge/claim-guard(-review).steps.js, the request steps of
// registration/profile.steps.js and the socket steps of realtime.steps.js.
const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { withSession } = require('../support/session');

const SEED_LOCATION = { type: 'Point', coordinates: [-46.6333, -23.5505] };

// Captured at load time, before any scenario stubs it (like profile-busy.steps.js, whose After
// restores it after every scenario anyway): the same original function.
const realFindOneAndUpdate = Dev.findOneAndUpdate;

When('claims of legacy developers stop missing', function () {
  Dev.findOneAndUpdate = realFindOneAndUpdate;
});

When('displacements of developers stop missing', function () {
  Dev.findOneAndUpdate = realFindOneAndUpdate;
});

Given(
  'the legacy developer {string} was stored before sign-in with the string _id {string} and no avatar',
  async function (login, _id) {
    const { insertedId } = await Dev.collection.insertOne({
      _id,
      github_username: login,
      name: login,
      bio: 'stored by the pre-auth backend',
      techs: ['Node.js'],
      location: SEED_LOCATION,
      __v: 0,
    });
    this.devIds = { ...(this.devIds || {}), [login]: String(insertedId) };
    this.rawIds = { ...(this.rawIds || {}), [login]: insertedId };
  }
);

// A github_id that Mongoose cannot read as a number: "not-a-number" reads as undefined, "" as null,
// so the API treats the dev as legacy (isLegacy) while the stored value is not null.
Given(
  'the legacy developer {string} was stored before sign-in with the hand-edited github_id {string}',
  async function (login, githubId) {
    const { insertedId } = await Dev.collection.insertOne({
      github_username: login,
      github_id: githubId,
      name: login,
      bio: 'stored by the pre-auth backend',
      techs: ['Node.js'],
      location: SEED_LOCATION,
      __v: 0,
    });
    this.devIds = { ...(this.devIds || {}), [login]: String(insertedId) };
    this.rawIds = { ...(this.rawIds || {}), [login]: insertedId };
  }
);

When(
  'I submit a registration with techs {string}, latitude {string} and longitude {string} again after {int} second(s)',
  async function (techs, latitude, longitude, seconds) {
    this.earlierResponses = [...(this.earlierResponses || []), this.response];
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    this.response = await withSession(request(this.app).post('/devs'), this).send({ techs, latitude, longitude });
  }
);

When(
  'I send {int} profile updates at once with techs {string}, latitude {string} and longitude {string}',
  async function (count, techs, latitude, longitude) {
    const send = () => withSession(request(this.app).put('/devs/me'), this).send({ techs, latitude, longitude });
    this.concurrentResponses = await Promise.all(Array.from({ length: count }, send));
  }
);

Then('every one of those updates should be answered 503 profile_busy with Retry-After {int}', function (seconds) {
  expect(this.concurrentResponses).to.not.be.empty;
  this.concurrentResponses.forEach((response, i) => {
    expect(response.status, `update ${i}: ${JSON.stringify(response.body)}`).to.equal(503);
    expect(response.body.code, `update ${i}`).to.equal('profile_busy');
    expect(response.headers['retry-after'], `update ${i}`).to.equal(String(seconds));
  });
});

Then('the response should have no Retry-After header', function () {
  expect(this.response.headers).to.not.have.property('retry-after');
});

Then('the response should not be 503 profile_busy', function () {
  const answers = [...(this.earlierResponses || []), this.response].map((r) => `${r.status} ${JSON.stringify(r.body)}`);
  [...(this.earlierResponses || []), this.response].forEach((response, i) => {
    expect(response.status, `request ${i + 1} of ${answers.length}: ${answers.join(' | ')}`).to.not.equal(503);
  });
});

Then(
  'client {string} should receive no {string}, {string} or {string} event within {int} second(s)',
  async function (alias, first, second, third, seconds) {
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    const names = [first, second, third];
    const received = this.receivedEvents[alias].filter((e) => names.includes(e.event)).map((e) => e.event);
    expect(received, `client "${alias}" received`).to.deep.equal([]);
  }
);
