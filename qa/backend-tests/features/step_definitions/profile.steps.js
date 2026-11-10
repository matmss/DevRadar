// Steps for features/profile.feature: GET/PUT/DELETE /devs/me (US-4, auth slice 5) and the
// dev-updated / dev-deleted pushes. Requests carry `Authorization: Bearer <this.sessionToken>`
// when a previous step signed in (withSession, support/session.js), and no header otherwise.
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { withSession } = require('../support/session');

const OBJECT_ID = /^[a-f\d]{24}$/;

/** @param {object} world @param {object} body */
async function putMe(world, body) {
  world.response = await withSession(request(world.app).put('/devs/me'), world).send(body);
  return world.response;
}

/** @param {object} world */
async function deleteMe(world) {
  world.response = await withSession(request(world.app).delete('/devs/me'), world);
  return world.response;
}

/** @param {{ coordinates: number[] }} location @param {string} latitude @param {string} longitude */
function expectAt(location, latitude, longitude) {
  expect(location, 'location').to.be.an('object');
  expect(location.type).to.equal('Point');
  expect(location.coordinates).to.deep.equal([Number(longitude), Number(latitude)]);
}

// --- Requests ---------------------------------------------------------------------------------

When('I request my profile', async function () {
  this.response = await withSession(request(this.app).get('/devs/me'), this);
});

When(
  'I update my profile with techs {string}, latitude {string} and longitude {string}',
  async function (techs, latitude, longitude) {
    await putMe(this, { techs, latitude, longitude });
  }
);

When(
  'I update my profile with techs {string} and numeric latitude {float} and longitude {float}',
  async function (techs, latitude, longitude) {
    await putMe(this, { techs, latitude, longitude });
  }
);

When('I update my profile with only techs {string}', async function (techs) {
  await putMe(this, { techs });
});

// Q9: everything that could name or describe a profile is in the body, pointing at `other`'s
// record (its github_username and _id), plus a profile and a location the backend must not use.
When(
  'I update my profile with techs {string}, latitude {string} and longitude {string} and a body that claims to be {string}',
  async function (techs, latitude, longitude, other) {
    const victim = await Dev.findOne({ github_username: other }).lean();
    expect(victim, `developer "${other}" should exist`).to.not.be.null;
    await putMe(this, {
      techs,
      latitude,
      longitude,
      github_username: other,
      _id: String(victim._id),
      name: 'Mallory',
      avatar_url: 'https://evil.example/avatar.png',
      bio: 'pwned',
      location: { type: 'Point', coordinates: [0, 0] },
    });
  }
);

When('I delete my profile', async function () {
  await deleteMe(this);
});

When(
  'I send a signed-in {word} request to {string} with techs {string}, latitude {string} and longitude {string}',
  async function (method, path, techs, latitude, longitude) {
    const req = request(this.app)[method.toLowerCase()](path);
    this.response = await withSession(req, this).send({ techs, latitude, longitude });
  }
);

// --- Concurrency ------------------------------------------------------------------------------

// Half the updates are sent before the delete and half after, all without waiting.
When('I send {int} updates and a delete of my profile at the same time', async function (count) {
  const update = (i) => withSession(request(this.app).put('/devs/me'), this)
    .send({ techs: `Tech${i}`, latitude: '-23.5505', longitude: '-46.6333' });
  const before = Array.from({ length: Math.floor(count / 2) }, (_, i) => update(i));
  const remove = withSession(request(this.app).delete('/devs/me'), this);
  const after = Array.from({ length: count - before.length }, (_, i) => update(before.length + i));

  const [beforeResponses, deleteResponse, afterResponses] = await Promise.all([
    Promise.all(before),
    remove,
    Promise.all(after),
  ]);
  this.deleteResponse = deleteResponse;
  this.updateResponses = [...beforeResponses, ...afterResponses];
});

// Deterministic version of the race: the real DELETE /devs/me runs and completes between the
// PUT's validation and its database update.
const realFindOneAndUpdate = Dev.findOneAndUpdate;
After(function () {
  Dev.findOneAndUpdate = realFindOneAndUpdate;
});

Given('my profile is deleted just before my update is applied', function () {
  const world = this;
  Dev.findOneAndUpdate = function deletedFirst(...args) {
    Dev.findOneAndUpdate = realFindOneAndUpdate;
    return withSession(request(world.app).delete('/devs/me'), world).then((response) => {
      world.deleteResponse = response;
      return realFindOneAndUpdate.apply(Dev, args);
    });
  };
});

Then('the delete should be answered {int}', function (status) {
  expect(this.deleteResponse, 'the delete should have been sent').to.not.equal(undefined);
  expect(this.deleteResponse.status).to.equal(status);
});

Then('every update should be answered 200 or 404 dev_not_found', function () {
  expect(this.updateResponses).to.not.be.empty;
  this.updateResponses.forEach((response, i) => {
    if (response.status === 404) {
      expect(response.body.code, `update ${i}`).to.equal('dev_not_found');
    } else {
      expect(response.status, `update ${i}`).to.equal(200);
      expect(response.body.github_username, `update ${i}`).to.equal('gaearon');
    }
  });
});

// --- Responses and stored state ---------------------------------------------------------------

Then('the response body should be empty', function () {
  expect(this.response.text || '').to.equal('');
});

Then('the response should place the developer at latitude {string} and longitude {string}', function (latitude, longitude) {
  expectAt(this.response.body.location, latitude, longitude);
});

Then('the stored developer {string} should be at latitude {string} and longitude {string}', async function (stored, latitude, longitude) {
  const dev = await Dev.findOne({ github_username: stored }).lean();
  expect(dev, `developer "${stored}" should be persisted`).to.not.be.null;
  expectAt(dev.location, latitude, longitude);
});

// GET /devs answers an array (GET /search answers { devs }).
Then('the developer list should not include {string}', function (username) {
  expect(this.response.body).to.be.an('array');
  expect(this.response.body.map((dev) => dev.github_username.toLowerCase())).to.not.include(username.toLowerCase());
});

// --- Live pushes ------------------------------------------------------------------------------

/** @returns {object} the payload of the one `event` that `alias` received */
function onlyEvent(world, alias, event) {
  const received = world.receivedEvents[alias].filter((e) => e.event === event);
  expect(received, `"${event}" events received by "${alias}"`).to.have.lengthOf(1);
  return received[0].payload;
}

Then(
  'the {string} event for {string} should be {string} with techs {string} at latitude {string} and longitude {string}',
  function (event, alias, username, techs, latitude, longitude) {
    const payload = onlyEvent(this, alias, event);
    expect(payload._id).to.match(OBJECT_ID);
    expect(payload.github_username).to.equal(username);
    expect(payload.techs).to.deep.equal(techs.split(','));
    expectAt(payload.location, latitude, longitude);
  }
);

Then('the {string} event for {string} should only carry the _id and github_username {string}', function (event, alias, username) {
  const payload = onlyEvent(this, alias, event);
  expect(Object.keys(payload).sort()).to.deep.equal(['_id', 'github_username']);
  expect(payload._id).to.match(OBJECT_ID);
  expect(payload.github_username).to.equal(username);
});
