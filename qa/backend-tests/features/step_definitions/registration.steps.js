const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
// Same-instance requirement as hooks.js — see comment there.
const mongoose = require('../../../../dev/backend/node_modules/mongoose');
const Dev = require('../../../../dev/backend/src/models/Dev');
const {
  mockGithubUser,
  mockGithubUserNotFound,
  mockGithubRateLimited,
  mockGithubForbidden,
  mockGithubUnreachable,
} = require('../support/github-mock');

Given('the developer database is empty', async function () {
  await Dev.deleteMany({});
});

Given('{string} is a valid GitHub username', function (username) {
  mockGithubUser(username);
});

Given('{string} is not a valid GitHub username', function (username) {
  mockGithubUserNotFound(username);
});

Given('{string} is a valid GitHub username with no display name', function (username) {
  mockGithubUser(username, { name: null });
});

Given('the GitHub API is rate limiting requests for {string} with status {int}', function (username, status) {
  mockGithubRateLimited(username, status);
});

Given('the GitHub API forbids requests for {string} without a rate limit', function (username) {
  mockGithubForbidden(username);
});

Given('the GitHub API is unreachable for {string}', function (username) {
  mockGithubUnreachable(username);
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

// Places a point due north of the origin on MongoDB's 2dsphere sphere (radius 6378.1 km),
// so the distance MongoDB computes for it is exactly `km`.
When(
  'I register {string} with techs {string} {float} km north of latitude {string} and longitude {string}',
  async function (github_username, techs, km, latitude, longitude) {
    const MONGO_EARTH_RADIUS_KM = 6378.1;
    const northLatitude = Number(latitude) + (km / MONGO_EARTH_RADIUS_KM) * (180 / Math.PI);
    this.response = await request(this.app)
      .post('/devs')
      .send({ github_username, techs, latitude: String(northLatitude), longitude });
    expect(this.response.status).to.equal(200);
  }
);

Then('the response status should be {int}', function (statusCode) {
  expect(this.response.status).to.equal(statusCode);
});

Then('the response status should indicate a client error', function () {
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

Then('no developer should be persisted', async function () {
  const found = await Dev.countDocuments({});
  expect(found).to.equal(0);
});

Then('the response should be an error with details', function () {
  expect(this.response.body.error).to.be.a('string').that.is.not.empty;
  expect(this.response.body.details).to.be.an('array');
});

Then('the database should contain exactly {int} developer(s)', async function (count) {
  expect(await Dev.countDocuments({})).to.equal(count);
});

Then("the developer's name should be {string}", function (name) {
  expect(this.response.body.name).to.equal(name);
});
