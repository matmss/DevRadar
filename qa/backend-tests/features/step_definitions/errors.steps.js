// Steps for features/errors.feature (global error middleware, BUG-012). The "JSON error with
// details and no stack trace" assertion lives in auth-review.steps.js.
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const Dev = require('../../../../dev/backend/src/models/Dev');

const realDevFind = Dev.find;

After(function () {
  Dev.find = realDevFind;
});

When('I send the raw registration body {string}', async function (body) {
  this.response = await request(this.app).post('/devs').set('Content-Type', 'application/json').send(body);
});

When('I send the raw registration body an oversized JSON payload', async function () {
  const body = JSON.stringify({ github_username: 'gaearon', bio: 'a'.repeat(200 * 1024) }); // limit is 100kb
  this.response = await request(this.app).post('/devs').set('Content-Type', 'application/json').send(body);
});

Given('the database fails when listing developers', function () {
  // Restored in the After hook above.
  Dev.find = () => Promise.reject(new Error('simulated database failure'));
});

Then('the response should be a JSON error with code {string}', function (code) {
  expect(this.response.headers['content-type']).to.match(/^application\/json/);
  expect(this.response.body.code).to.equal(code);
});

Then('the response should not mention {string}', function (text) {
  expect(this.response.text).to.not.include(text);
});
