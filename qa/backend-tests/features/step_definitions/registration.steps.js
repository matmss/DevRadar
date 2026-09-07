const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
// Same-instance requirement as hooks.js — see comment there.
const mongoose = require('../../../../dev/backend/node_modules/mongoose');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { mockGithubUser, mockGithubUserNotFound } = require('../support/github-mock');

Given('the developer database is empty', async function () {
  await Dev.deleteMany({});
});

Given('{string} is a valid GitHub username', function (username) {
  mockGithubUser(username);
});

Given('{string} is not a valid GitHub username', function (username) {
  mockGithubUserNotFound(username);
});

Given('a developer already exists with github_username {string} and techs {string}', async function (username, techs) {
  mockGithubUser(username);
  await Dev.create({
    github_username: username,
    name: username,
    avatar_url: 'https://example.com/avatar.png',
    bio: 'seed fixture',
    techs: techs.split(','),
    location: { type: 'Point', coordinates: [-46.6333, -23.5505] },
  });
});

When(
  'I submit a registration with github_username {string}, techs {string}, latitude {string} and longitude {string}',
  async function (github_username, techs, latitude, longitude) {
    this.response = await request(this.app)
      .post('/devs')
      .send({ github_username, techs, latitude, longitude });
  }
);

Then('the response status should be {int}', function (statusCode) {
  expect(this.response.status).to.equal(statusCode);
});

Then('the response status should indicate a client error', function () {
  // Documents the DESIRED contract (see docs/03-test-cases.md TC-011/TC-012).
  // As of this audit, DevController.store has no validation/error handling for these
  // paths, so this step is expected to FAIL until BUG-003/BUG-004 are fixed —
  // that failure is the point: it's the automated proof the gap exists.
  expect(this.response.status).to.be.within(400, 499);
});

Then("the response should include the developer's name, avatar_url and bio from GitHub", function () {
  expect(this.response.body).to.have.property('name');
  expect(this.response.body).to.have.property('avatar_url');
  expect(this.response.body).to.have.property('bio');
});

Then("the developer's techs should be {string}", function (expectedCsv) {
  expect(this.response.body.techs).to.deep.equal(expectedCsv.split(','));
});

Then('the developer should be persisted with a GeoJSON location of type {string}', async function (type) {
  const dev = await Dev.findOne({ github_username: this.response.body.github_username });
  expect(dev).to.not.be.null;
  expect(dev.location.type).to.equal(type);
  expect(dev.location.coordinates).to.have.lengthOf(2);
});

Then('exactly {int} developer with github_username {string} should exist in the database', async function (count, username) {
  const found = await Dev.countDocuments({ github_username: username });
  expect(found).to.equal(count);
});

Then('no developer with github_username {string} should be persisted', async function (username) {
  const found = await Dev.countDocuments({ github_username: username });
  expect(found).to.equal(0);
});
