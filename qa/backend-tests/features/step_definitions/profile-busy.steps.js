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

Then('the log should say the login could not be refreshed at sign-in', function () {
  expect(this.logLines, 'a previous step should record the log').to.be.an('array');
  const lines = this.logLines.filter(({ text }) => text.startsWith('Could not refresh the developer login at sign-in:'));
  expect(lines, JSON.stringify(this.logLines)).to.have.lengthOf(1);
  expect(lines[0].text).to.include('too many concurrent changes');
});
