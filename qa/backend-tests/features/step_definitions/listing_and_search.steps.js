const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { mockGithubUser } = require('../support/github-mock');

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
  this.response = await request(this.app).get('/devs');
});

Then('the response should contain {int} developers', function (count) {
  expect(this.response.body).to.have.lengthOf(count);
});

When('I search at latitude {string}, longitude {string} for techs {string}', async function (latitude, longitude, techs) {
  this.response = await request(this.app).get('/search').query({ latitude, longitude, techs });
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
