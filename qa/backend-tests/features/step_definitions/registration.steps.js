const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { signSessionToken } = require('../../../../dev/backend/src/utils/sessionToken');
const { githubUserFixture } = require('../support/github-mock');

// POST /devs requires a session token (US-3). The registration steps send
// `Authorization: Bearer <this.sessionToken>` when a previous step set one: "I am signed in as"
// below, "I signed in through GitHub as" (auth.steps.js, the real OAuth flow), or the forged
// tokens of auth.steps.js ("I have a <kind> session token"). Without one, no header is sent.

/**
 * @param {import('supertest').Test} req
 * @param {{ sessionToken?: string }} world
 * @returns {import('supertest').Test}
 */
function withSession(req, world) {
  return world.sessionToken ? req.set('Authorization', `Bearer ${world.sessionToken}`) : req;
}

/** @param {object} world @param {object} body */
async function postDev(world, body) {
  world.response = await withSession(request(world.app).post('/devs'), world).send(body);
  return world.response;
}

/** The name, avatar and bio a dev registered by `username` must have (DevController's rules). */
function expectedProfile(username) {
  const { name, avatar_url, bio } = githubUserFixture(username);
  return { name: name || username, avatar_url, bio };
}

Given('the developer database is empty', async function () {
  await Dev.deleteMany({});
});

// Test-only sign-in: a session token signed with the test JWT_SECRET (auth-config.js), as
// POST /auth/token would issue after GitHub sign-in, with the fixture's GitHub profile as the
// token's sign-in snapshot (github-mock.js FIXTURES).
Given('I am signed in as {string}', function (username) {
  this.sessionToken = signSessionToken(username, githubUserFixture(username)).token;
});

// Seeds the document directly, the way a dev created before sign-in existed looks (US-8).
Given('a developer already exists with github_username {string} and techs {string}', async function (username, techs) {
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
  'I submit a registration with techs {string}, latitude {string} and longitude {string}',
  async function (techs, latitude, longitude) {
    await postDev(this, { techs, latitude, longitude });
  }
);

// Sends a body github_username too, which the backend must ignore (auth spec Q9).
When(
  'I submit a registration with github_username {string}, techs {string}, latitude {string} and longitude {string}',
  async function (github_username, techs, latitude, longitude) {
    await postDev(this, { github_username, techs, latitude, longitude });
  }
);

// Places a point due north of the origin on MongoDB's 2dsphere sphere (radius 6378.1 km),
// so the distance MongoDB computes for it is exactly `km`.
When(
  'I register with techs {string} {float} km north of latitude {string} and longitude {string}',
  async function (techs, km, latitude, longitude) {
    const MONGO_EARTH_RADIUS_KM = 6378.1;
    const northLatitude = Number(latitude) + (km / MONGO_EARTH_RADIUS_KM) * (180 / Math.PI);
    await postDev(this, { techs, latitude: String(northLatitude), longitude });
    expect(this.response.status).to.equal(200);
  }
);

Then('the response status should be {int}', function (statusCode) {
  expect(this.response.status).to.equal(statusCode);
});

Then('the response status should indicate a client error', function () {
  expect(this.response.status).to.be.within(400, 499);
});

Then('the registered developer should be {string}', function (username) {
  expect(this.response.body.github_username).to.equal(username);
});

Then("the response should include the name, avatar_url and bio of {string}'s GitHub profile", function (username) {
  expect(this.response.body).to.include(expectedProfile(username));
});

Then("the stored developer {string} should have the name, avatar_url and bio of {string}'s GitHub profile", async function (stored, username) {
  const dev = await Dev.findOne({ github_username: stored }).lean();
  expect(dev, `developer "${stored}" should be persisted`).to.not.be.null;
  expect({ name: dev.name, avatar_url: dev.avatar_url, bio: dev.bio }).to.deep.equal(expectedProfile(username));
});

Then('the stored developer {string} should have {word} {string}', async function (stored, field, expected) {
  const dev = await Dev.findOne({ github_username: stored }).lean();
  expect(dev, `developer "${stored}" should be persisted`).to.not.be.null;
  // "<none>" means the field was not set (null or absent). Arrays (techs) compare as CSV.
  const actual = Array.isArray(dev[field]) ? dev[field].join(',') : dev[field];
  if (expected === '<none>') expect(actual == null, `${field} should not be set`).to.equal(true);
  else expect(actual).to.equal(expected);
});

Then('the stored developer {string} should have a {word} of {int} characters', async function (stored, field, length) {
  const dev = await Dev.findOne({ github_username: stored }).lean();
  expect(dev, `developer "${stored}" should be persisted`).to.not.be.null;
  expect(Array.from(dev[field])).to.have.lengthOf(length);
});

Then("no call should have been made to GitHub's public users API", function () {
  expect(this.githubUsersApi.calls).to.deep.equal([]);
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
