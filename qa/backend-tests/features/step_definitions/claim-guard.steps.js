// Steps for features/claim-guard.feature: the avatar-id claim guard (dev/docs/05-claim-guard-spec.md,
// B1; services/devOwnership.js). Reuses the seeding, snapshot and stored-developer steps of
// legacy-merge.steps.js (aliases in world.devIds, "I remember every stored developer", "the
// developer <alias> should ..."), the request steps of registration/profile.steps.js, the
// sign-in steps of auth/ownership.steps.js and the WebSocket steps of realtime.steps.js.
const util = require('util');
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
// The same mongoose (and BSON) as dev/backend, see hooks.js.
const mongoose = require('../../../../dev/backend/node_modules/mongoose');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { testSessionToken, sessionTokenFromSecondsAgo } = require('../support/session');

const { EJSON } = mongoose.mongo.BSON;
// Where legacy-merge.steps.js seeds legacy devs (latitude -23.5505, longitude -46.6333).
const SEED_LOCATION = { type: 'Point', coordinates: [-46.6333, -23.5505] };
const DAY_MS = 24 * 60 * 60 * 1000;
const LOGIN_FIELDS = ['github_username', 'github_username_stale', 'github_username_seen_at'];

/** @param {number} id @returns {string} a GitHub avatar URL as GET /users/<login> answered it */
function avatarOf(id) {
  return `https://avatars.githubusercontent.com/u/${id}?v=4`;
}

/** @param {object} world @param {string} alias @returns {string} the seeded dev's _id */
function aliasId(world, alias) {
  const _id = world.devIds && world.devIds[alias];
  expect(_id, `no developer was seeded as "${alias}"`).to.be.a('string');
  return _id;
}

/** @param {object} world @param {string} alias @returns {Promise<object | null>} the raw stored dev */
function rawDev(world, alias) {
  return Dev.collection.findOne({ _id: new mongoose.mongo.ObjectId(aliasId(world, alias)) });
}

/**
 * Seeds a dev the way the pre-auth backend stored it, like legacy-merge.steps.js seedLegacy, with
 * the github_id and avatar_url variants hand-edited data can hold.
 * @param {object} world
 * @param {string} login
 * @param {{ githubId: 'missing' | 'null', avatarUrl: unknown }} options - avatarUrl undefined:
 *   no avatar_url field
 */
async function seedLegacy(world, login, { githubId, avatarUrl }) {
  const doc = {
    github_username: login,
    name: login,
    bio: 'stored by the pre-auth backend',
    techs: ['Node.js'],
    location: SEED_LOCATION,
    __v: 0,
  };
  if (githubId === 'null') doc.github_id = null;
  if (avatarUrl !== undefined) doc.avatar_url = avatarUrl;
  const { insertedId } = await Dev.collection.insertOne(doc);
  world.devIds = { ...(world.devIds || {}), [login]: String(insertedId) };
}

/** "<missing>", "<null>" and "<empty>" stand for no field, null and "" */
function avatarValue(text) {
  if (text === '<missing>') return undefined;
  if (text === '<null>') return null;
  if (text === '<empty>') return '';
  return text;
}

// --- Seeding ------------------------------------------------------------------------------------

Given('the legacy developer {string} was stored before sign-in with avatar id {int}', async function (login, id) {
  await seedLegacy(this, login, { githubId: 'missing', avatarUrl: avatarOf(id) });
});

Given(
  'the legacy developer {string} was stored before sign-in with github_id {word} and avatar id {int}',
  async function (login, githubId, id) {
    await seedLegacy(this, login, { githubId, avatarUrl: avatarOf(id) });
  }
);

Given(
  'the legacy developer {string} was stored before sign-in with avatar_url {string}',
  async function (login, text) {
    await seedLegacy(this, login, { githubId: 'missing', avatarUrl: avatarValue(text) });
  }
);

// Hand-edited data: values the pre-auth API never stored, but the database can hold.
Given(
  'the legacy developer {string} was stored before sign-in with the hand-edited avatar_url {word}',
  async function (login, json) {
    await seedLegacy(this, login, { githubId: 'missing', avatarUrl: JSON.parse(json) });
  }
);

Given('the legacy developer {string} has the name {string} and the bio {string}', async function (alias, name, bio) {
  await Dev.collection.updateOne({ _id: (await rawDev(this, alias))._id }, { $set: { name, bio } });
});

// AC-11: a (hypothetical) login state at least as recent as any session of this scenario.
Given('the legacy developer {string} has a login state newer than my session', async function (alias) {
  await Dev.collection.updateOne(
    { _id: (await rawDev(this, alias))._id },
    { $set: { github_username_seen_at: new Date(Date.now() + DAY_MS) } }
  );
});

// An owned dev with an explicit login state, older or newer than any session of this scenario.
Given(
  'a developer {string} owned by GitHub account {int} with avatar id {int} and an {word} login state',
  async function (login, githubId, avatarId, age) {
    expect(['older', 'newer']).to.include(age);
    const { insertedId } = await Dev.collection.insertOne({
      github_id: githubId,
      github_username: login,
      github_username_seen_at: new Date(Date.now() + (age === 'older' ? -DAY_MS : DAY_MS)),
      name: login,
      bio: 'registered after sign-in',
      avatar_url: avatarOf(avatarId),
      techs: ['Go'],
      location: SEED_LOCATION,
      __v: 0,
    });
    this.devIds = { ...(this.devIds || {}), [login]: String(insertedId) };
  }
);

// --- Log capture --------------------------------------------------------------------------------

const CONSOLE_METHODS = ['warn', 'error', 'log', 'info'];
const realConsole = Object.fromEntries(CONSOLE_METHODS.map((method) => [method, console[method]]));
After(function () {
  CONSOLE_METHODS.forEach((method) => { console[method] = realConsole[method]; });
});

Given("the server's log lines are being recorded", function () {
  this.logLines = [];
  CONSOLE_METHODS.forEach((method) => {
    console[method] = (...args) => {
      this.logLines.push({ level: method, text: util.format(...args) });
    };
  });
});

/** @param {object} world @returns {string[]} the recorded guard warnings */
function guardWarnings(world) {
  expect(world.logLines, 'a previous step should record the log').to.be.an('array');
  return world.logLines.filter(({ level, text }) => level === 'warn' && text.startsWith('Legacy developer '))
    .map(({ text }) => text);
}

Then(
  /^the log should have (\d+) guard warnings?, each naming the developer "([^"]+)", login "([^"]+)", account (\d+) and avatar id (\d+)$/,
  async function (count, alias, login, account, avatarId) {
    const warnings = guardWarnings(this);
    expect(warnings, warnings.join('\n')).to.have.lengthOf(Number(count));
    const _id = aliasId(this, alias);
    warnings.forEach((line) => {
      expect(line).to.include(`dev ${_id},`);
      expect(line).to.include(`login ${login},`);
      expect(line).to.include(`account ${account},`);
      expect(line).to.include(`avatar id ${avatarId})`);
    });
  }
);

Then('the log should have no guard warning', function () {
  expect(guardWarnings(this)).to.deep.equal([]);
});

Then(
  'no log line should contain the session token, an avatar URL, {string}, {string} or the coordinates',
  function (name, bio) {
    expect(this.logLines, 'a previous step should record the log').to.be.an('array');
    const forbidden = [this.sessionToken, 'avatars.githubusercontent.com', 'https://', name, bio, '-23.5505', '-46.6333', 'Node.js'];
    this.logLines.forEach(({ text }) => {
      forbidden.forEach((value) => expect(text, `log line ${JSON.stringify(text)}`).to.not.include(value));
    });
  }
);

// --- Concurrent requests ------------------------------------------------------------------------

const BODY = { techs: 'Node.js', latitude: '-23.5505', longitude: '-46.6333' };

When('I submit the same registration twice at the same time', async function () {
  const send = () => request(this.app).post('/devs').set('Authorization', `Bearer ${this.sessionToken}`).send(BODY);
  const responses = await Promise.all([send(), send()]);
  this.concurrent = responses.map((response) => ({ response }));
});

When(
  'GitHub account {int} as {string} with a session from {int} days ago updates their profile while GitHub account {int} as {string} registers',
  async function (ownerId, ownerLogin, days, newId, newLogin) {
    const ownerToken = sessionTokenFromSecondsAgo(ownerLogin, ownerId, days * DAY_MS / 1000);
    const newToken = testSessionToken(newLogin, newId);
    const responses = await Promise.all([
      request(this.app).put('/devs/me').set('Authorization', `Bearer ${ownerToken}`).send(BODY),
      request(this.app).post('/devs').set('Authorization', `Bearer ${newToken}`).send(BODY),
    ]);
    this.concurrent = [
      { githubId: ownerId, response: responses[0] },
      { githubId: newId, response: responses[1] },
    ];
  }
);

Then('no concurrent request should get a server error', function () {
  this.concurrent.forEach(({ response }) => {
    expect(response.status, JSON.stringify(response.body)).to.be.below(500);
  });
});

Then('the request of GitHub account {int} should be answered {int}', function (githubId, status) {
  const { response } = this.concurrent.find((entry) => entry.githubId === githubId);
  expect(response.status, JSON.stringify(response.body)).to.equal(status);
});

Then('both registrations should be answered 200 with the same developer', function () {
  const [first, second] = this.concurrent.map(({ response }) => response);
  expect(first.status, JSON.stringify(first.body)).to.equal(200);
  expect(second.status, JSON.stringify(second.body)).to.equal(200);
  expect(first.body._id).to.equal(second.body._id);
});

// --- Deterministic races (a write lands between the API's read and its conditional write) ----

const realFindOneAndUpdate = Dev.findOneAndUpdate;
After(function () {
  Dev.findOneAndUpdate = realFindOneAndUpdate;
});

/** @returns {boolean} the claim's conditional update (rule 2: sets a github_id on a legacy dev) */
function isClaim(filter, update) {
  return Boolean(filter && filter.github_id === null && update && update.$set && update.$set.github_id);
}

/** @returns {boolean} displace()'s conditional update of a legacy dev */
function isLegacyDisplacement(filter, update) {
  return Boolean(filter && filter.github_id === null && update && update.$set && update.$set.github_username_stale === true);
}

/**
 * Runs `change` once, right before the first findOneAndUpdate `matches`, then lets it through.
 * @param {object} world
 * @param {(filter: object, update: object) => boolean} matches
 * @param {() => Promise<unknown>} change
 */
function beforeNextWrite(world, matches, change) {
  Dev.findOneAndUpdate = function raced(filter, update, ...rest) {
    if (!matches(filter, update)) return realFindOneAndUpdate.call(Dev, filter, update, ...rest);
    Dev.findOneAndUpdate = realFindOneAndUpdate;
    world.raceRan = true;
    return change().then(() => realFindOneAndUpdate.call(Dev, filter, update, ...rest));
  };
}

// AC-14: the guard read one avatar, the write meets another.
Given(
  'the avatar of the legacy developer {string} changes to avatar id {int} just before my claim',
  function (alias, id) {
    beforeNextWrite(this, isClaim, async () => {
      await Dev.collection.updateOne({ _id: (await rawDev(this, alias))._id }, { $set: { avatar_url: avatarOf(id) } });
    });
  }
);

// AC-12: the real owner's claim lands between the guarded displacement's read and its write.
Given(
  'GitHub account {int} claims the legacy developer {string} with an older read just before its displacement',
  function (githubId, alias) {
    beforeNextWrite(this, isLegacyDisplacement, async () => {
      await Dev.collection.updateOne(
        { _id: (await rawDev(this, alias))._id, github_id: null },
        { $set: { github_id: githubId, github_username_seen_at: new Date(Date.now() - DAY_MS) } }
      );
    });
  }
);

// AC-12: a guarded displacement (another account's newer read) lands just before my claim.
Given('another account displaces the legacy developer {string} just before my claim', function (alias) {
  beforeNextWrite(this, isClaim, async () => {
    const dev = await rawDev(this, alias);
    await Dev.collection.updateOne(
      { _id: dev._id, github_id: null },
      { $set: { github_username: `_stale_${dev._id}`, github_username_stale: true, github_username_seen_at: new Date() } }
    );
  });
});

// --- Outcomes -----------------------------------------------------------------------------------

Then(
  'the response should be a new developer of GitHub account {int} with login {string}, not {string}',
  function (githubId, login, alias) {
    expect(this.response.status, JSON.stringify(this.response.body)).to.equal(200);
    expect(this.response.body.github_id).to.equal(githubId);
    expect(this.response.body.github_username).to.equal(login);
    expect(this.response.body._id).to.not.equal(aliasId(this, alias));
    expect(this.response.body).to.not.have.property('github_username_seen_at');
  }
);

Then('the developer {string} should be displaced, with everything else as before', async function (alias) {
  const _id = aliasId(this, alias);
  expect(this.before, 'a previous step should remember every stored developer').to.be.instanceOf(Map);
  const before = EJSON.parse(this.before.get(_id), { relaxed: false });
  const now = await rawDev(this, alias);
  expect(now, 'a displaced developer is never deleted').to.not.equal(null);
  expect(now.github_username).to.equal(`_stale_${_id}`);
  expect(now.github_username_stale).to.equal(true);
  expect(now.github_id == null, 'still no github_id').to.equal(true);
  expect('github_id' in now).to.equal('github_id' in before);
  // A name that was only the old login is cleared (displace()); everything else is kept.
  if (typeof before.name === 'string' && before.name.toLowerCase() === before.github_username.toLowerCase()) {
    expect(now.name).to.equal(null);
    delete before.name;
    delete now.name;
  }
  LOGIN_FIELDS.forEach((field) => {
    delete before[field];
    delete now[field];
  });
  expect(EJSON.stringify(now, { relaxed: false })).to.equal(EJSON.stringify(before, { relaxed: false }));
});

Then('the developer {string} should show login {string}', async function (alias, login) {
  const dev = await rawDev(this, alias);
  expect(dev, `developer "${alias}" should exist`).to.not.be.null;
  expect(dev.github_username).to.equal(login);
});

Then('the developer {string} should not belong to GitHub account {int}', async function (alias, githubId) {
  const dev = await rawDev(this, alias);
  if (dev) expect(dev.github_id).to.not.equal(githubId);
});

Then('the developer {string} should have the avatar id {int}', async function (alias, id) {
  expect((await rawDev(this, alias)).avatar_url).to.equal(avatarOf(id));
});

Then('at most one developer should show the login {string}, in any letter case', async function (login) {
  const count = await Dev.countDocuments({ github_username: login }).collation({ locale: 'en', strength: 2 });
  expect(count).to.be.at.most(1);
});

Then('the {string} event for {string} should be the developer {string}, displaced', function (event, client, alias) {
  const payloads = this.receivedEvents[client].filter((e) => e.event === event).map((e) => e.payload);
  expect(payloads, `"${event}" events for "${client}"`).to.have.lengthOf(1);
  const _id = aliasId(this, alias);
  expect(payloads[0]._id).to.equal(_id);
  expect(payloads[0].github_username).to.equal(`_stale_${_id}`);
  expect(payloads[0].github_username_stale).to.equal(true);
  expect(payloads[0]).to.not.have.property('github_username_seen_at');
});

// Neither its _id nor its avatar (whose id says whose it is) appears in the answer.
Then('the response should not reveal the developer {string}', async function (alias) {
  const dev = await rawDev(this, alias);
  expect(this.response.text).to.not.include(aliasId(this, alias));
  expect(this.response.text).to.not.include(dev.avatar_url);
});
