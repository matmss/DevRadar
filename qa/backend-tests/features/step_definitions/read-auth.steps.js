// Steps for features/read-auth.feature (GET /devs and GET /search behind requireAuth, slice 4).
const { When, Then } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const { withSession } = require('../support/session');

// Sends the session token of a previous step as `Authorization: Bearer`, if any.
When('I call GET {string}', async function (path) {
  this.response = await withSession(request(this.app).get(path), this);
});

// The usual names a careless client would put a token under; none of them may count.
When('I call GET {string} with the session token in the query string', async function (path) {
  const url = new URL(path, 'http://localhost');
  ['token', 'access_token', 'authorization'].forEach((name) => url.searchParams.set(name, this.sessionToken));
  this.response = await request(this.app).get(`${url.pathname}${url.search}`);
});

Then('the response should not reveal any developer', function () {
  expect(this.response.text).to.not.include('github_username');
  expect(this.response.body).to.not.be.an('array');
  expect(this.response.body).to.not.have.property('devs');
});
