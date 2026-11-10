// Steps for features/legacy-profiles.feature (auth slice 6: US-8 legacy profiles, Q10 profiles
// belong to a GitHub account id). Reuses the registration, profile, listing, realtime and auth
// steps; requests carry `Authorization: Bearer <this.sessionToken>` (withSession).
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const jwt = require('../../../../dev/backend/node_modules/jsonwebtoken');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { githubIdFor, githubUserFixture } = require('../support/github-mock');
const { mockGithubOAuthTokenExchange, mockGithubAuthenticatedUser } = require('../support/github-mock');
const { testSessionToken, decodeJwtPart, SEVEN_DAYS_SECONDS } = require('../support/session');
const { TEST_JWT_SECRET } = require('../support/auth-config');
const { signInThroughGithub } = require('./auth.steps');

/**
 * The raw stored document (what MongoDB holds, not what the API shows), as JSON for exact
 * comparisons (ObjectIds become hex strings; field order is kept).
 * @param {object} filter
 * @returns {Promise<string | null>}
 */
async function rawDocument(filter) {
  const doc = await Dev.collection.findOne(filter);
  return doc ? JSON.stringify(doc) : null;
}

/** @param {string} username @returns {Promise<object | null>} the stored dev, by exact login */
function storedDev(username) {
  return Dev.findOne({ github_username: username }).lean();
}

// --- Seeding ----------------------------------------------------------------------------------

Given(
  'a developer {string} owned by GitHub account {int} already exists with techs {string}',
  async function (username, githubId, techs) {
    await Dev.create({
      github_id: githubId,
      github_username: username,
      name: username,
      avatar_url: 'https://example.com/avatar.png',
      bio: 'seed fixture',
      techs: techs.split(','),
      location: { type: 'Point', coordinates: [-46.6333, -23.5505] },
    });
  }
);

Given('I remember the stored developer {string}', async function (username) {
  const dev = await storedDev(username);
  expect(dev, `developer "${username}" should exist`).to.not.be.null;
  this.rememberedDev = { _id: dev._id, raw: await rawDocument({ _id: dev._id }) };
});

// A database as an older backend left it: documents inserted with the driver (no mongoose
// defaults), and only the _id index. The After hook below rebuilds the indexes in any case.
Given(
  'the database holds these legacy developers, stored before sign-in existed and without the new indexes:',
  async function (dataTable) {
    await Dev.collection.dropIndexes();
    this.droppedDevIndexes = true;
    const docs = dataTable.hashes().map((row) => ({
      name: row.github_username,
      github_username: row.github_username,
      bio: 'stored by the pre-auth backend',
      avatar_url: 'https://example.com/avatar.png',
      techs: row.techs.split(','),
      location: { type: 'Point', coordinates: [Number(row.longitude), Number(row.latitude)] },
      __v: 0,
    }));
    await Dev.collection.insertMany(docs);
    this.legacySnapshot = JSON.stringify(await Dev.collection.find({}).sort({ _id: 1 }).toArray());
  }
);

After(async function () {
  if (this.droppedDevIndexes) await Dev.ensureIndexes();
});

// --- Signing in as a specific GitHub account --------------------------------------------------

Given('I am signed in as {string} with GitHub account {int}', function (username, githubId) {
  this.sessionToken = testSessionToken(username, githubId);
});

Given(
  'I am signed in as {string} with GitHub account {int}, in a session that began {int} days ago',
  function (username, githubId, days) {
    const iat = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
    const { name, avatar_url, bio } = githubUserFixture(username);
    this.sessionToken = jwt.sign(
      { sub: String(githubId), login: username, iss: 'devradar', iat, exp: iat + SEVEN_DAYS_SECONDS, profile: { name, avatar_url, bio } },
      TEST_JWT_SECRET,
      { algorithm: 'HS256' }
    );
  }
);

Given('I signed in through GitHub as {string} with GitHub account {int}', async function (username, githubId) {
  await signInThroughGithub(this, username, { id: githubId });
});

// `id` is the JSON value GET /user answers with ("<missing>": no id field at all).
Given(
  /^GitHub will sign in "([^"]+)" with id (\S+) for authorization code "([^"]+)"$/,
  function (username, id, code) {
    mockGithubOAuthTokenExchange(code, 'gho_test_access_token_without_id');
    mockGithubAuthenticatedUser('gho_test_access_token_without_id', username, {
      id: id === '<missing>' ? undefined : JSON.parse(id),
    });
  }
);

// Makes another GitHub account win the claim race deterministically: its claim lands after my
// read of the legacy dev and before my own conditional claim (the next findOneAndUpdate that
// requires github_id to be absent).
const realFindOneAndUpdate = Dev.findOneAndUpdate;
After(function () {
  Dev.findOneAndUpdate = realFindOneAndUpdate;
});

Given('GitHub account {int} claims the legacy developer {string} just before my claim', function (githubId, username) {
  Dev.findOneAndUpdate = function claimedFirst(filter, ...rest) {
    const isClaim = filter && filter.github_id && filter.github_id.$exists === false;
    if (!isClaim) return realFindOneAndUpdate.call(Dev, filter, ...rest);
    Dev.findOneAndUpdate = realFindOneAndUpdate;
    return Dev.updateOne({ github_username: username, github_id: { $exists: false } }, { $set: { github_id: githubId } })
      .then(() => realFindOneAndUpdate.call(Dev, filter, ...rest));
  };
});

// --- Concurrent requests from two accounts ----------------------------------------------------

/**
 * Sends one request per account, all started before any is awaited.
 * @param {object} world
 * @param {{ githubId: number, login: string }[]} accounts
 * @param {(token: string) => import('supertest').Test} send
 */
async function sendConcurrently(world, accounts, send) {
  const responses = await Promise.all(accounts.map(({ githubId, login }) => send(testSessionToken(login, githubId))));
  world.concurrent = accounts.map((account, i) => ({ ...account, response: responses[i] }));
}

When(
  'GitHub accounts {int} as {string} and {int} as {string} update their profile at the same time with techs {string}',
  async function (firstId, firstLogin, secondId, secondLogin, techs) {
    await sendConcurrently(this, [{ githubId: firstId, login: firstLogin }, { githubId: secondId, login: secondLogin }],
      (token) => request(this.app).put('/devs/me').set('Authorization', `Bearer ${token}`)
        .send({ techs, latitude: '-23.5505', longitude: '-46.6333' }));
  }
);

When(
  'GitHub accounts {int} as {string} and {int} as {string} register at the same time with techs {string}',
  async function (firstId, firstLogin, secondId, secondLogin, techs) {
    await sendConcurrently(this, [{ githubId: firstId, login: firstLogin }, { githubId: secondId, login: secondLogin }],
      (token) => request(this.app).post('/devs').set('Authorization', `Bearer ${token}`)
        .send({ techs, latitude: '-23.5505', longitude: '-46.6333' }));
  }
);

Then(
  'one concurrent request should be answered {int} and the other {int} with code {string}',
  function (winnerStatus, loserStatus, code) {
    const statuses = this.concurrent.map(({ response }) => response.status).sort();
    expect(statuses).to.deep.equal([winnerStatus, loserStatus].sort());
    const loser = this.concurrent.find(({ response }) => response.status === loserStatus);
    expect(loser.response.body.code).to.equal(code);
  }
);

Then('the stored developer {string} should belong to the GitHub account that was answered 200', async function (username) {
  const winner = this.concurrent.find(({ response }) => response.status === 200);
  const dev = await storedDev(username);
  expect(dev, `developer "${username}" should be persisted`).to.not.be.null;
  expect(dev.github_id).to.equal(winner.githubId);
});

// --- Startup ----------------------------------------------------------------------------------

// What index.js triggers at startup (Dev.init() runs Dev.ensureIndexes() once per process; it
// already ran in hooks.js, so it is called directly here).
When('the backend builds its indexes at startup', async function () {
  await Dev.ensureIndexes();
});

Then('every legacy document should be exactly as it was stored', async function () {
  const now = JSON.stringify(await Dev.collection.find({}).sort({ _id: 1 }).toArray());
  expect(now).to.equal(this.legacySnapshot);
});

Then('the developers collection should have a unique index on github_id that leaves out documents without one', async function () {
  const index = (await Dev.collection.indexes()).find((i) => i.name === 'github_id_unique');
  expect(index, 'github_id_unique index').to.not.be.undefined;
  expect(index.key).to.deep.equal({ github_id: 1 });
  expect(index.unique).to.equal(true);
  expect(index.partialFilterExpression).to.deep.equal({ github_id: { $exists: true } });
});

Then('the developers collection should still have the unique case-insensitive index on github_username', async function () {
  const index = (await Dev.collection.indexes()).find((i) => i.name === 'github_username_unique_ci');
  expect(index, 'github_username_unique_ci index').to.not.be.undefined;
  expect(index.unique).to.equal(true);
  expect(index.collation).to.include({ locale: 'en', strength: 2 });
});

// --- Stored state and responses ---------------------------------------------------------------

Then('the stored developer {string} should belong to the GitHub account of {string}', async function (stored, login) {
  const dev = await storedDev(stored);
  expect(dev, `developer "${stored}" should be persisted`).to.not.be.null;
  expect(dev.github_id).to.equal(githubIdFor(login));
});

Then('the stored developer {string} should belong to GitHub account {int}', async function (stored, githubId) {
  const dev = await storedDev(stored);
  expect(dev, `developer "${stored}" should be persisted`).to.not.be.null;
  expect(dev.github_id).to.equal(githubId);
});

Then('the stored developer {string} should be unchanged', async function (stored) {
  expect(this.rememberedDev, 'a previous step should remember the developer').to.not.equal(undefined);
  const dev = await storedDev(stored);
  expect(dev, `developer "${stored}" should be persisted`).to.not.be.null;
  expect(String(dev._id)).to.equal(String(this.rememberedDev._id));
  expect(await rawDocument({ _id: this.rememberedDev._id })).to.equal(this.rememberedDev.raw);
});

Then('the response should be the remembered developer', function () {
  expect(this.response.body._id).to.equal(String(this.rememberedDev._id));
});

Then('the response should carry github_id of {string} and no internal field', function (login) {
  expect(this.response.body.github_id).to.equal(githubIdFor(login));
  expect(this.response.body).to.not.have.property('github_username_seen_at');
});

Then(
  "the session token's subject should be the GitHub id of {string} and its login claim {string}",
  function (username, login) {
    const claims = decodeJwtPart(this.sessionToken.split('.')[1]);
    expect(claims.sub).to.equal(String(githubIdFor(username)));
    expect(claims.login).to.equal(login);
  }
);
