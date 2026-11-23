// Steps for features/profile-busy-review.feature (QA review of 503 profile_busy). Reuses the
// exhaustion stubs of profile-busy.steps.js ("every claim ... misses", restored by its After), the
// seeding steps of legacy-merge/claim-guard(-review).steps.js, the request steps of
// registration/profile.steps.js and the socket steps of realtime.steps.js.
const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { withSession } = require('../support/session');
// The same mongoose (and BSON) as dev/backend, see hooks.js.
const mongoose = require('../../../../dev/backend/node_modules/mongoose');

const SEED_LOCATION = { type: 'Point', coordinates: [-46.6333, -23.5505] };
const { Int32, Long, Double, Decimal128 } = mongoose.mongo.BSON;

// --- Re-check of the QA-PB-1 fix -----------------------------------------------------------------

/** @param {number} id @param {string} type @returns {unknown} `id` as the BSON type `type` */
function asBsonType(id, type) {
  if (type === 'String') return String(id);
  if (type === 'Decimal128') return Decimal128.fromString(String(id));
  if (type === 'Int32') return new Int32(id);
  if (type === 'Long') return Long.fromNumber(id);
  if (type === 'Double') return new Double(id);
  throw new Error(`Unknown BSON type ${type}`);
}

// A dev registered by account <id> whose github_id was rewritten in another BSON type (a mongo
// shell edit, an export/import), with no avatar evidence and no login state (older than any read).
Given(
  'the developer {string} was stored with the github_id {int} as a BSON {word} and no avatar',
  async function (login, id, type) {
    const { insertedId } = await Dev.collection.insertOne({
      github_username: login,
      github_id: asBsonType(id, type),
      name: login,
      bio: 'registered, then hand-edited',
      techs: ['Node.js'],
      location: SEED_LOCATION,
      __v: 0,
    });
    this.devIds = { ...(this.devIds || {}), [login]: String(insertedId) };
  }
);

// ABA race around the claim (missesForGood): another writer changes the legacy dev just before my
// claim (so it misses) and changes it back before my re-read. The document is then as read and
// the filter matches it again: a retry, never the "cannot be claimed" 500. Once only; the After
// of profile-busy.steps.js restores Dev.findOneAndUpdate.
Given('the legacy developer {string} is changed and changed back around my next claim', function (alias) {
  const world = this;
  Dev.findOneAndUpdate = async function abaClaim(filter, update, ...rest) {
    const isClaim = Boolean(filter && update && update.$set && update.$set.github_id && !update.$setOnInsert);
    if (!isClaim) return realFindOneAndUpdate.call(Dev, filter, update, ...rest);
    Dev.findOneAndUpdate = realFindOneAndUpdate;
    const _id = new mongoose.mongo.ObjectId(world.devIds[alias]);
    await Dev.collection.updateOne({ _id }, { $set: { avatar_url: 'https://avatars.githubusercontent.com/u/111?v=4' } });
    const missed = await realFindOneAndUpdate.call(Dev, filter, update, ...rest);
    await Dev.collection.updateOne({ _id }, { $unset: { avatar_url: 1 } });
    world.raceRan = missed === null;
    return missed;
  };
});

/**
 * @param {unknown} value - read with promoteValues: false
 * @returns {unknown} the shape of `value`: every leaf replaced by its BSON type name
 */
function bsonShape(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.map(bsonShape);
  if (value instanceof Date) return 'Date';
  if (typeof value === 'object') {
    if (value._bsontype) return value._bsontype;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, bsonShape(value[key])]));
  }
  return typeof value;
}

/** @param {number} githubId @returns {Promise<object>} the stored dev, BSON values not promoted */
async function storedByAccount(githubId) {
  const doc = await Dev.collection.findOne({ github_id: githubId }, { promoteValues: false });
  expect(doc, `a developer should belong to GitHub account ${githubId}`).to.not.equal(null);
  return doc;
}

Then(
  'the stored developers of GitHub accounts {int} and {int} should have the same fields with the same BSON types',
  async function (first, second) {
    const a = bsonShape(await storedByAccount(first));
    const b = bsonShape(await storedByAccount(second));
    // The _id itself differs on purpose (ObjectId vs hand-edited string).
    delete a._id;
    delete b._id;
    expect(b, `account ${second} (driver path) vs account ${first} (model path)`).to.deep.equal(a);
  }
);

Then(
  'the stored developers of GitHub accounts {int} and {int} should have the same techs and location',
  async function (first, second) {
    const pick = (doc) => JSON.parse(JSON.stringify({ techs: doc.techs, location: { ...doc.location, _id: undefined } }));
    const a = await Dev.collection.findOne({ github_id: first });
    const b = await Dev.collection.findOne({ github_id: second });
    expect(pick(b)).to.deep.equal(pick(a));
  }
);

// Captured at load time, before any scenario stubs it (like profile-busy.steps.js, whose After
// restores it after every scenario anyway): the same original function.
const realFindOneAndUpdate = Dev.findOneAndUpdate;

When('claims of legacy developers stop missing', function () {
  Dev.findOneAndUpdate = realFindOneAndUpdate;
});

When('displacements of developers stop missing', function () {
  Dev.findOneAndUpdate = realFindOneAndUpdate;
});

Given(
  'the legacy developer {string} was stored before sign-in with the string _id {string} and no avatar',
  async function (login, _id) {
    const { insertedId } = await Dev.collection.insertOne({
      _id,
      github_username: login,
      name: login,
      bio: 'stored by the pre-auth backend',
      techs: ['Node.js'],
      location: SEED_LOCATION,
      __v: 0,
    });
    this.devIds = { ...(this.devIds || {}), [login]: String(insertedId) };
    this.rawIds = { ...(this.rawIds || {}), [login]: insertedId };
  }
);

// A github_id that Mongoose cannot read as a number: "not-a-number" reads as undefined, "" as null,
// so the API treats the dev as legacy (isLegacy) while the stored value is not null.
Given(
  'the legacy developer {string} was stored before sign-in with the hand-edited github_id {string}',
  async function (login, githubId) {
    const { insertedId } = await Dev.collection.insertOne({
      github_username: login,
      github_id: githubId,
      name: login,
      bio: 'stored by the pre-auth backend',
      techs: ['Node.js'],
      location: SEED_LOCATION,
      __v: 0,
    });
    this.devIds = { ...(this.devIds || {}), [login]: String(insertedId) };
    this.rawIds = { ...(this.rawIds || {}), [login]: insertedId };
  }
);

When(
  'I submit a registration with techs {string}, latitude {string} and longitude {string} again after {int} second(s)',
  async function (techs, latitude, longitude, seconds) {
    this.earlierResponses = [...(this.earlierResponses || []), this.response];
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    this.response = await withSession(request(this.app).post('/devs'), this).send({ techs, latitude, longitude });
  }
);

When(
  'I send {int} profile updates at once with techs {string}, latitude {string} and longitude {string}',
  async function (count, techs, latitude, longitude) {
    const send = () => withSession(request(this.app).put('/devs/me'), this).send({ techs, latitude, longitude });
    this.concurrentResponses = await Promise.all(Array.from({ length: count }, send));
  }
);

Then('every one of those updates should be answered 503 profile_busy with Retry-After {int}', function (seconds) {
  expect(this.concurrentResponses).to.not.be.empty;
  this.concurrentResponses.forEach((response, i) => {
    expect(response.status, `update ${i}: ${JSON.stringify(response.body)}`).to.equal(503);
    expect(response.body.code, `update ${i}`).to.equal('profile_busy');
    expect(response.headers['retry-after'], `update ${i}`).to.equal(String(seconds));
  });
});

Then('the response should have no Retry-After header', function () {
  expect(this.response.headers).to.not.have.property('retry-after');
});

Then('the response should not be 503 profile_busy', function () {
  const answers = [...(this.earlierResponses || []), this.response].map((r) => `${r.status} ${JSON.stringify(r.body)}`);
  [...(this.earlierResponses || []), this.response].forEach((response, i) => {
    expect(response.status, `request ${i + 1} of ${answers.length}: ${answers.join(' | ')}`).to.not.equal(503);
  });
});

Then(
  'client {string} should receive no {string}, {string} or {string} event within {int} second(s)',
  async function (alias, first, second, third, seconds) {
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    const names = [first, second, third];
    const received = this.receivedEvents[alias].filter((e) => names.includes(e.event)).map((e) => e.event);
    expect(received, `client "${alias}" received`).to.deep.equal([]);
  }
);
