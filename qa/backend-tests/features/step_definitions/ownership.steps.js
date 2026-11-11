// Steps for features/legacy-profiles.feature (auth slice 6: US-8 legacy profiles, Q10 profiles
// belong to a GitHub account id). Reuses the registration, profile, listing, realtime and auth
// steps; requests carry `Authorization: Bearer <this.sessionToken>` (withSession).
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { githubIdFor } = require('../support/github-mock');
const { mockGithubOAuthTokenExchange, mockGithubAuthenticatedUser } = require('../support/github-mock');
const { testSessionToken, sessionTokenFromSecondsAgo, decodeJwtPart } = require('../support/session');
const { signInThroughGithub, completeSignIn } = require('./auth.steps');

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
    this.sessionToken = sessionTokenFromSecondsAgo(username, githubId, days * 24 * 60 * 60);
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
// requires the dev to have no github_id, missing or null, and sets one).
const realFindOneAndUpdate = Dev.findOneAndUpdate;
After(function () {
  Dev.findOneAndUpdate = realFindOneAndUpdate;
});

Given('GitHub account {int} claims the legacy developer {string} just before my claim', function (githubId, username) {
  Dev.findOneAndUpdate = function claimedFirst(filter, update, ...rest) {
    const isClaim = Boolean(filter && filter.github_id === null && update && update.$set && update.$set.github_id);
    if (!isClaim) return realFindOneAndUpdate.call(Dev, filter, update, ...rest);
    Dev.findOneAndUpdate = realFindOneAndUpdate;
    // A real claim records the claimant's GitHub read, here a newer one than mine.
    return Dev.updateOne(
      { github_username: username, github_id: null },
      { $set: { github_id: githubId, github_username_seen_at: new Date(Date.now() + 1000) } }
    )
      .then(() => realFindOneAndUpdate.call(Dev, filter, update, ...rest));
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

When(
  'GitHub account {int} as {string} with a session from {int} days ago and GitHub account {int} as {string} register at the same time with techs {string}',
  async function (oldId, oldLogin, days, newId, newLogin, techs) {
    const tokens = [
      sessionTokenFromSecondsAgo(oldLogin, oldId, days * 24 * 60 * 60),
      testSessionToken(newLogin, newId),
    ];
    const responses = await Promise.all(tokens.map((token) => request(this.app).post('/devs')
      .set('Authorization', `Bearer ${token}`)
      .send({ techs, latitude: '-23.5505', longitude: '-46.6333' })));
    this.concurrent = [
      { githubId: oldId, login: oldLogin, response: responses[0] },
      { githubId: newId, login: newLogin, response: responses[1] },
    ];
  }
);

Then('every concurrent request should be answered 200 or 409 with code {string}', function (code) {
  this.concurrent.forEach(({ githubId, response }) => {
    if (response.status === 409) expect(response.body.code, `account ${githubId}`).to.equal(code);
    else expect(response.status, `account ${githubId}: ${JSON.stringify(response.body)}`).to.equal(200);
  });
});

Then('the developer showing github_username {string} should belong to GitHub account {int}', async function (login, githubId) {
  const dev = await Dev.findOne({ github_username: login }).collation({ locale: 'en', strength: 2 }).lean();
  expect(dev, `a developer should show "${login}"`).to.not.be.null;
  expect(dev.github_id).to.equal(githubId);
});

Then('no developer should show github_username {string} for GitHub account {int}', async function (login, githubId) {
  const dev = await Dev.findOne({ github_id: githubId }).lean();
  if (dev) expect(dev.github_username.toLowerCase()).to.not.equal(login.toLowerCase());
});

Then(
  'one concurrent request should be answered {int} and the other {int} with code {string}',
  function (winnerStatus, loserStatus, code) {
    const statuses = this.concurrent.map(({ response }) => response.status).sort();
    expect(statuses).to.deep.equal([winnerStatus, loserStatus].sort());
    const loser = this.concurrent.find(({ response }) => response.status === loserStatus);
    expect(loser.response.body.code).to.equal(code);
  }
);

// Case-insensitive: a claim takes the claimant's login as GitHub spells it (QA-AUTH6-2), so when
// the account that presented "ALICE" wins, the stored login is "ALICE". An exact-case lookup
// failed whenever the second request won the race (seen under load, QA final re-check).
Then('the stored developer {string} should belong to the GitHub account that was answered 200', async function (username) {
  const winner = this.concurrent.find(({ response }) => response.status === 200);
  expect(winner, 'one concurrent request should be answered 200').to.not.equal(undefined);
  const dev = await Dev.findOne({ github_username: username }).collation({ locale: 'en', strength: 2 }).lean();
  expect(dev, `developer "${username}" (any letter case) should be persisted`).to.not.be.null;
  expect(dev.github_id).to.equal(winner.githubId);
  expect(dev.github_username, "the winner's spelling of the login").to.equal(winner.login);
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
  expect(index.partialFilterExpression).to.deep.equal({ github_id: { $gt: 0 } });
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

// --- Displacement (QA-AUTH6-1) ------------------------------------------------------------------

const LOGIN_FIELDS = ['github_username', 'github_username_stale', 'github_username_seen_at'];
const STALE_LOGIN = /^_stale_[a-f\d]{24}$/;

/** @param {object} dev - a stored or API dev @returns {void} asserts it is displaced */
function expectDisplaced(dev) {
  expect(dev.github_username, 'a displaced dev shows a placeholder, never a GitHub login').to.match(STALE_LOGIN);
  expect(dev.github_username).to.equal(`_stale_${String(dev._id)}`);
  expect(dev.github_username_stale).to.equal(true);
}

Given(
  'a developer already exists with github_username {string}, a null github_id and techs {string}',
  async function (username, techs) {
    await Dev.create({
      github_id: null,
      github_username: username,
      name: username,
      avatar_url: 'https://example.com/avatar.png',
      bio: 'seed fixture',
      techs: techs.split(','),
      location: { type: 'Point', coordinates: [-46.6333, -23.5505] },
    });
    const stored = await Dev.collection.findOne({ github_username: username });
    expect(stored.github_id, 'the seed must store github_id as null').to.equal(null);
  }
);

Then('the remembered developer should be displaced, with everything else unchanged', async function () {
  const before = JSON.parse(this.rememberedDev.raw);
  const now = JSON.parse(await rawDocument({ _id: this.rememberedDev._id }));
  expect(now, 'the displaced developer must not be deleted').to.not.equal(null);
  expectDisplaced(now);
  // A name that was only the old login is cleared (clients show a neutral name); any other is kept.
  if (typeof before.name === 'string' && before.name.toLowerCase() === before.github_username.toLowerCase()) {
    expect(now.name, 'a name that was the old login is cleared').to.equal(null);
    delete before.name;
    delete now.name;
  }
  LOGIN_FIELDS.forEach((field) => {
    delete before[field];
    delete now[field];
  });
  expect(now).to.deep.equal(before);
});

Then('the remembered developer should be listed as displaced, with no GitHub login', function () {
  const listed = this.response.body.find((dev) => dev._id === String(this.rememberedDev._id));
  expect(listed, 'the displaced developer stays listed').to.not.equal(undefined);
  expectDisplaced(listed);
  expect(listed).to.not.have.property('github_username_seen_at');
});

Then('the {string} event for {string} should show a displaced developer with no GitHub login', function (event, alias) {
  const payloads = this.receivedEvents[alias].filter((e) => e.event === event).map((e) => e.payload);
  expect(payloads, `"${event}" events for "${alias}"`).to.have.lengthOf(1);
  expectDisplaced(payloads[0]);
  expect(payloads[0].github_id).to.equal(501);
});

Then('the developer of GitHub account {int} should be displaced', async function (githubId) {
  const dev = await Dev.findOne({ github_id: githubId }).lean();
  expect(dev, `GitHub account ${githubId} should own a developer`).to.not.be.null;
  expectDisplaced(dev);
});

Then('the developer of GitHub account {int} should not be marked stale', async function (githubId) {
  const dev = await Dev.findOne({ github_id: githubId }).lean();
  expect(dev, `GitHub account ${githubId} should own a developer`).to.not.be.null;
  expect(dev.github_username_stale == null, 'github_username_stale should be unset').to.equal(true);
  expect(dev.github_username).to.not.match(STALE_LOGIN);
});

Then('the developer of GitHub account {int} should have techs {string}', async function (githubId, techs) {
  const dev = await Dev.findOne({ github_id: githubId }).lean();
  expect(dev.techs.join(',')).to.equal(techs);
});

Then('the developer of GitHub account {int} should have no name', async function (githubId) {
  const dev = await Dev.findOne({ github_id: githubId }).lean();
  expect(dev.name == null, `name should be cleared, was ${JSON.stringify(dev.name)}`).to.equal(true);
});

Then('the developer of GitHub account {int} should have name {string}', async function (githubId, name) {
  const dev = await Dev.findOne({ github_id: githubId }).lean();
  expect(dev.name).to.equal(name);
});

Then('no developer should be marked stale', async function () {
  expect(await Dev.countDocuments({ github_username_stale: true })).to.equal(0);
});

When(
  'GitHub accounts sign in one after another in the order {word}, with {int} as {string}, {int} as {string} and {int} as {string}',
  async function (order, id1, login1, id2, login2, id3, login3) {
    const logins = { [id1]: login1, [id2]: login2, [id3]: login3 };
    for (const id of order.split(',').map(Number)) {
      await signInThroughGithub(this, logins[id], { id });
    }
  }
);

// Both sign-ins reach the callback first (GitHub read), then both redeem their codes at once, so
// their login refreshes (each locking both accounts) run concurrently.
When(
  'GitHub accounts {int} as {string} and {int} as {string} complete their sign-ins at the same time',
  async function (firstId, firstLogin, secondId, secondLogin) {
    const devices = [{ app: this.app, signInCount: 700 }, { app: this.app, signInCount: 800 }];
    await completeSignIn(devices[0], firstLogin, { id: firstId });
    await completeSignIn(devices[1], secondLogin, { id: secondId });
    this.concurrentSignIns = await Promise.all(devices.map((device) => request(this.app)
      .post('/auth/token')
      .send({ code: device.oneTimeCode, code_verifier: device.pkceVerifier })));
  }
);

Then('both concurrent sign-ins should succeed', function () {
  this.concurrentSignIns.forEach((response) => {
    expect(response.status, JSON.stringify(response.body)).to.equal(200);
  });
});

Then(
  "the session token's subject should be the GitHub id of {string} and its login claim {string}",
  function (username, login) {
    const claims = decodeJwtPart(this.sessionToken.split('.')[1]);
    expect(claims.sub).to.equal(String(githubIdFor(username)));
    expect(claims.login).to.equal(login);
  }
);
