// Steps for features/auth-slice5-review.feature (QA review of auth slice 5): positions a given
// distance north of a point, on MongoDB's 2dsphere sphere, like the radius.feature steps in
// registration.steps.js.
const { Given, When } = require('@cucumber/cucumber');
const request = require('supertest');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { withSession } = require('../support/session');

// MongoDB's 2dsphere Earth radius (BUG-002), not 6371.
const MONGO_EARTH_RADIUS_KM = 6378.1;

/** @param {number} km @param {string} latitude @returns {number} the latitude `km` further north */
function northOf(km, latitude) {
  return Number(latitude) + (km / MONGO_EARTH_RADIUS_KM) * (180 / Math.PI);
}

// Stored directly (no POST, so no new-dev push before the scenario's own action).
Given(
  'developer {string} with techs {string} is registered {float} km north of latitude {string} and longitude {string}',
  async function (username, techs, km, latitude, longitude) {
    await Dev.create({
      github_username: username,
      name: username,
      bio: 'seed fixture',
      techs: techs.split(','),
      location: { type: 'Point', coordinates: [Number(longitude), northOf(km, latitude)] },
    });
  }
);

When(
  'I update my profile with techs {string} {float} km north of latitude {string} and longitude {string}',
  async function (techs, km, latitude, longitude) {
    this.response = await withSession(request(this.app).put('/devs/me'), this)
      .send({ techs, latitude: String(northOf(km, latitude)), longitude });
  }
);
