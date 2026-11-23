// Steps for features/profile-busy.feature: a profile write that gives up after too many concurrent
// changes answers 503 profile_busy (utils/profileBusyError.js, middleware/errorHandler.js).
// Reuses the seeding and stored-developer steps of legacy-merge/claim-guard.steps.js, the log
// capture of claim-guard.steps.js ("the server's log lines are being recorded"), the request
// steps of registration/profile.steps.js and the sign-in steps of auth/ownership.steps.js.
const { Given, Then, After } = require('@cucumber/cucumber');
const { expect } = require('chai');
const Dev = require('../../../../dev/backend/src/models/Dev');

const realFindOneAndUpdate = Dev.findOneAndUpdate;
After(function () {
  Dev.findOneAndUpdate = realFindOneAndUpdate;
});

/** @returns {boolean} resolveOwnDev's conditional claim of a legacy dev */
function isClaim(filter, update) {
  return Boolean(filter && filter.github_id === null && update && update.$set && update.$set.github_id);
}

/** @returns {boolean} displace()'s conditional update */
function isDisplacement(update) {
  return Boolean(update && update.$set && update.$set.github_username_stale === true);
}

/**
 * Every conditional write that `matches` misses (answers null, as when the record changed
 * between the read and the write), for the rest of the scenario. Every other write is real.
 * @param {object} world
 * @param {(filter: object, update: object) => boolean} matches
 */
function missEvery(world, matches) {
  Dev.findOneAndUpdate = function missing(filter, update, ...rest) {
    if (!matches(filter, update)) return realFindOneAndUpdate.call(Dev, filter, update, ...rest);
    world.raceRan = true;
    return Promise.resolve(null);
  };
}

Given('every claim of a legacy developer misses', function () {
  missEvery(this, isClaim);
});

Given('every displacement of a developer misses', function () {
  missEvery(this, (filter, update) => isDisplacement(update));
});

Then('the response should be 503 profile_busy, retry after 1 second', function () {
  const { response } = this;
  expect(response.status, JSON.stringify(response.body)).to.equal(503);
  expect(response.headers['content-type']).to.match(/^application\/json/);
  expect(response.headers['retry-after']).to.equal('1');
  expect(response.body).to.deep.equal({
    error: 'Profile is busy',
    code: 'profile_busy',
    details: ['Too many concurrent changes to this profile; try again'],
  });
});

Then('the log should have one profile_busy warning for {string} and no error', function (methodPath) {
  expect(this.logLines, 'a previous step should record the log').to.be.an('array');
  const all = JSON.stringify(this.logLines);
  const busy = this.logLines.filter(({ level, text }) => level === 'warn' && text.includes('profile_busy'));
  expect(busy, all).to.have.lengthOf(1);
  expect(busy[0].text).to.equal(`Gave up on ${methodPath}: profile_busy (503)`);
  expect(this.logLines.filter(({ level }) => level === 'error'), all).to.have.lengthOf(0);
});

// --- Hand-edited stored values (QA-PB-1) -----------------------------------------------------

const SEED_LOCATION = { type: 'Point', coordinates: [-46.6333, -23.5505] };

// An owned dev whose login state is no date (hand-edited): olderThan can never match it, so it
// can never be displaced, however often a write retries.
Given(
  'a developer {string} owned by GitHub account {int} with the hand-edited github_username_seen_at {string}',
  async function (login, githubId, seenAt) {
    const { insertedId } = await Dev.collection.insertOne({
      github_id: githubId,
      github_username: login,
      github_username_seen_at: seenAt,
      name: login,
      techs: ['Go'],
      location: SEED_LOCATION,
      __v: 0,
    });
    this.devIds = { ...(this.devIds || {}), [login]: String(insertedId) };
  }
);

Then('the response should have the _id {string}', function (_id) {
  expect(this.response.body, JSON.stringify(this.response.body)).to.have.property('_id', _id);
});

Then(
  'the developer stored with _id {string} should belong to GitHub account {int} with techs {string}',
  async function (_id, githubId, techs) {
    const stored = await Dev.collection.findOne({ _id });
    expect(stored, `a developer should be stored with _id "${_id}"`).to.not.equal(null);
    expect(stored.github_id).to.equal(githubId);
    expect(stored.techs.join(',')).to.equal(techs);
    expect(await Dev.collection.countDocuments({ github_id: githubId })).to.equal(1);
  }
);

Then('no developer should be stored with _id {string}', async function (_id) {
  expect(await Dev.collection.countDocuments({ _id })).to.equal(0);
});

Then('the {string} event for {string} should have the _id {string}', function (event, alias, _id) {
  const events = this.receivedEvents[alias].filter((e) => e.event === event);
  expect(events, `client "${alias}" should have received "${event}"`).to.have.lengthOf(1);
  expect(events[0].payload._id).to.equal(_id);
});

Then('the log should have one error saying the developer {string} cannot be {word}', function (alias, what) {
  expect(this.logLines, 'a previous step should record the log').to.be.an('array');
  const all = JSON.stringify(this.logLines);
  const errors = this.logLines.filter(({ level }) => level === 'error');
  expect(errors, all).to.have.lengthOf(1);
  expect(errors[0].text).to.include(`Developer ${this.devIds[alias]} cannot be ${what}:`);
  expect(this.logLines.filter(({ text }) => text.includes('profile_busy')), all).to.have.lengthOf(0);
});

// QA-PB-3: read without promoting BSON values, so the stored type is visible.
Then(
  'the github_id of the developer {string} should be stored as the BSON {word} {int}',
  async function (alias, type, githubId) {
    const mongoose = require('../../../../dev/backend/node_modules/mongoose');
    const stored = await Dev.collection.findOne(
      { _id: new mongoose.mongo.ObjectId(this.devIds[alias]) },
      { promoteValues: false }
    );
    expect(stored, `developer "${alias}" should exist`).to.not.equal(null);
    expect(stored.github_id._bsontype, JSON.stringify(stored.github_id)).to.equal(type);
    expect(Number(stored.github_id.toString())).to.equal(githubId);
    expect(await Dev.collection.countDocuments({ github_id: githubId })).to.equal(1);
  }
);

Then('the search response should list the developer with the _id {string}', function (_id) {
  const ids = this.response.body.devs.map((dev) => dev._id);
  expect(ids, JSON.stringify(this.response.body)).to.include(_id);
});

Then('the log should say the login could not be refreshed at sign-in', function () {
  expect(this.logLines, 'a previous step should record the log').to.be.an('array');
  const lines = this.logLines.filter(({ text }) => text.startsWith('Could not refresh the developer login at sign-in:'));
  expect(lines, JSON.stringify(this.logLines)).to.have.lengthOf(1);
  expect(lines[0].text).to.include('too many concurrent changes');
});
