const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { withSession } = require('../support/session');

// GET /devs and GET /search require a session token since auth slice 4 (Q1). These steps send
// the one a previous step set ("I am signed in as", or a forged token from auth.steps.js), and
// no Authorization header otherwise (read-auth.feature checks those 401s).

Given('the following developers exist:', async function (dataTable) {
  const rows = dataTable.hashes();
  for (const row of rows) {
    await Dev.create({
      github_username: row.github_username,
      name: row.github_username,
      avatar_url: 'https://example.com/avatar.png',
      bio: 'seed fixture',
      techs: row.techs.split(','),
      location: {
        type: 'Point',
        coordinates: [Number(row.longitude), Number(row.latitude)],
      },
    });
  }
});

When('I request the list of all developers', async function () {
  this.response = await withSession(request(this.app).get('/devs'), this);
});

Then('the response should contain {int} developers', function (count) {
  expect(this.response.body).to.have.lengthOf(count);
});

When('I search at latitude {string}, longitude {string} for techs {string}', async function (latitude, longitude, techs) {
  this.response = await withSession(request(this.app).get('/search'), this).query({ latitude, longitude, techs });
});

Then('the response should contain exactly {int} developer', function (count) {
  expect(this.response.body.devs).to.have.lengthOf(count);
});

Then('the response should contain exactly {int} developers', function (count) {
  expect(this.response.body.devs).to.have.lengthOf(count);
});

Then('the response should include {string}', function (username) {
  const usernames = this.response.body.devs.map((d) => d.github_username);
  expect(usernames).to.include(username);
});

Then('the response should not include {string}', function (username) {
  const usernames = this.response.body.devs.map((d) => d.github_username);
  expect(usernames).to.not.include(username);
});
