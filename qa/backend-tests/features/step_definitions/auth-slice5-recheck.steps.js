// Steps for features/auth-slice5-recheck.feature (QA re-check of the slice 5 hardening). Reuses
// profile.steps.js ("the database answers my next update N ms late", "no write should be queued
// for any login", "the delete should be answered", ...) and the shared sign-in helpers.
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { withSession, testSessionToken } = require('../support/session');

const realFindOneAndUpdate = Dev.findOneAndUpdate;
After(function () {
  Dev.findOneAndUpdate = realFindOneAndUpdate;
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

Given('the database fails my next update', function () {
  Dev.findOneAndUpdate = function failOnce() {
    Dev.findOneAndUpdate = realFindOneAndUpdate;
    return Promise.reject(new Error('simulated database failure'));
  };
});

Given('I have no session token', function () {
  this.sessionToken = undefined;
});

When(
  'I register with techs {string}, latitude {string} and longitude {string} and, {int} ms later, delete my profile',
  async function (techs, latitude, longitude, delayMs) {
    const registration = withSession(request(this.app).post('/devs'), this).send({ techs, latitude, longitude });
    const registered = registration.then((response) => response); // sends now
    await wait(delayMs);
    const [registrationResponse, deleteResponse] = await Promise.all([
      registered,
      withSession(request(this.app).delete('/devs/me'), this),
    ]);
    this.registrationResponse = registrationResponse;
    this.deleteResponse = deleteResponse;
  }
);

Then('the registration should be answered {int}', function (status) {
  expect(this.registrationResponse.status).to.equal(status);
});

// Records the order in which the two responses arrive.
When(
  '{string} updates their profile and, {int} ms later, {string} updates theirs',
  async function (first, delayMs, second) {
    const finished = [];
    const update = (login) => request(this.app).put('/devs/me')
      .set('Authorization', `Bearer ${testSessionToken(login)}`)
      .send({ techs: 'Go', latitude: '-23.5505', longitude: '-46.6333' })
      .then((response) => {
        finished.push(login);
        return response;
      });
    const firstDone = update(first);
    await wait(delayMs);
    this.updateResponses = await Promise.all([firstDone, update(second)]);
    this.finishedLogins = finished;
  }
);

Then('both updates should be answered {int}', function (status) {
  this.updateResponses.forEach((response) => expect(response.status).to.equal(status));
});

Then('the update of {string} should be answered before the update of {string}', function (earlier, later) {
  expect(this.finishedLogins).to.deep.equal([earlier, later]);
});
