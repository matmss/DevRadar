// Steps for features/legacy-merge.feature: the operator tool for legacy and displaced profiles
// (dev/docs/04-legacy-merge-spec.md, option A; dev/backend/scripts/legacy-devs.js).
//
// "When the operator runs ..." calls the tool's run() in-process, with exactly the arguments the
// command line takes, against this suite's MongoDB (the connection hooks.js opened). "When the
// operator runs the command line ..." starts the real script as a separate process with MONGO_URI
// in its environment. In a command, "<alias>" becomes the _id of the developer seeded or known as
// "alias", "<file>" the path of the saved recovery record and "<mongo-port>" this suite's MongoDB
// port. Every operator command snapshots the whole collection first (raw documents as canonical
// Extended JSON, so field order and BSON types count), for "nothing written" and "unchanged".
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const io = require('socket.io-client');
// The same mongoose (and BSON) as dev/backend, see hooks.js.
const mongoose = require('../../../../dev/backend/node_modules/mongoose');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { run } = require('../../../../dev/backend/scripts/lib/legacyDevs');
const { testSessionToken } = require('../support/session');
const { signInThroughGithub } = require('./auth.steps');

const { EJSON } = mongoose.mongo.BSON;
const BACKEND_DIR = path.resolve(__dirname, '../../../../dev/backend');
const SCRIPT = path.join(BACKEND_DIR, 'scripts/legacy-devs.js');
const SEED_LOCATION = { type: 'Point', coordinates: [-46.6333, -23.5505] };

// --- Helpers ------------------------------------------------------------------------------------

/** @param {object} doc @returns {string} exact: canonical Extended JSON */
function exact(doc) {
  return EJSON.stringify(doc, { relaxed: false });
}

/** @returns {Promise<Map<string, string>>} every stored dev by _id, as exact JSON */
async function snapshot() {
  const docs = await Dev.collection.find({}).sort({ _id: 1 }).toArray();
  return new Map(docs.map((doc) => [String(doc._id), exact(doc)]));
}

/** @param {object} world @param {string} alias @param {unknown} _id */
function rememberAlias(world, alias, _id) {
  world.devIds = { ...(world.devIds || {}), [alias]: String(_id) };
}

/**
 * @param {object} world
 * @param {string} alias - a seeded alias, or else the login of a stored dev (any letter case)
 * @returns {Promise<string>} the dev's _id
 */
async function devIdOf(world, alias) {
  if (world.devIds && world.devIds[alias]) return world.devIds[alias];
  const dev = await Dev.findOne({ github_username: alias }).collation({ locale: 'en', strength: 2 }).lean();
  expect(dev, `no developer is known as "${alias}"`).to.not.be.null;
  rememberAlias(world, alias, dev._id);
  return String(dev._id);
}

/** @param {object} world @param {string} text @returns {Promise<string>} placeholders replaced */
async function substitute(world, text) {
  let result = text;
  for (const [, name] of text.matchAll(/<([^<>\s]+)>/g)) {
    let value;
    if (name === 'file') value = world.recoveryFile;
    else if (name === 'mongo-port') value = String(Dev.db.port);
    else value = await devIdOf(world, name);
    expect(value, `nothing to put in <${name}>`).to.be.a('string');
    result = result.split(`<${name}>`).join(value);
  }
  return result;
}

/** @param {string} command @returns {string[]} */
function argvOf(command) {
  return command.split(' ').filter((part) => part !== '');
}

/**
 * Runs one operator command in-process.
 * @param {object} world
 * @param {string} command - with placeholders
 * @returns {Promise<{ code: number, stdout: string[], stderr: string[] }>}
 */
async function runOperator(world, command) {
  const argv = argvOf(await substitute(world, command));
  const stdout = [];
  const stderr = [];
  const code = await run(argv, { log: (line) => stdout.push(line), error: (line) => stderr.push(line) });
  return { code, stdout, stderr };
}

/** @param {object} world @param {{ code: number, stdout: string[], stderr: string[] }} result */
function keepResult(world, result) {
  world.cli = { ...result, output: [...result.stdout, ...result.stderr].join('\n') };
}

/** @param {object} world @returns {Promise<void>} */
async function takeSnapshot(world) {
  world.before = await snapshot();
  world.snapshots = [...(world.snapshots || []), world.before];
}

/** @returns {string} this suite's MongoDB, as the tool would get it in MONGO_URI */
function suiteMongoUri() {
  return `mongodb://${Dev.db.host}:${Dev.db.port}/${Dev.db.name}`;
}

/**
 * Runs the real script as a separate process.
 * @param {string[]} argv
 * @param {string} mongoUri
 * @returns {Promise<{ code: number, stdout: string[], stderr: string[] }>}
 */
function runProcess(argv, mongoUri) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [SCRIPT, ...argv],
      { cwd: BACKEND_DIR, env: { ...process.env, MONGO_URI: mongoUri }, timeout: 30000, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
        const lines = (text) => text.split('\n').filter((line) => line !== '');
        resolve({ code, stdout: lines(stdout), stderr: lines(stderr) });
      }
    );
  });
}

/** @param {object} world @param {string} alias @returns {Promise<object | null>} the raw stored dev */
async function rawDev(world, alias) {
  const _id = new mongoose.mongo.ObjectId(await devIdOf(world, alias));
  return Dev.collection.findOne({ _id });
}

// --- Seeding ------------------------------------------------------------------------------------

/**
 * A dev the way the pre-auth backend stored it (mongoose create: no github_id, __v 0).
 * @param {object} world
 * @param {string} login
 * @param {string | undefined} avatarUrl - undefined: no avatar_url field
 */
async function seedLegacy(world, login, avatarUrl) {
  const doc = {
    github_username: login,
    name: login,
    bio: 'stored by the pre-auth backend',
    techs: ['Node.js'],
    location: SEED_LOCATION,
    __v: 0,
  };
  if (avatarUrl !== undefined) doc.avatar_url = avatarUrl;
  const { insertedId } = await Dev.collection.insertOne(doc);
  rememberAlias(world, login, insertedId);
}

Given('the legacy developer {string} was stored before sign-in with avatar {string}', async function (login, avatarUrl) {
  await seedLegacy(this, login, avatarUrl);
});

Given('the legacy developer {string} was stored before sign-in without an avatar', async function (login) {
  await seedLegacy(this, login, undefined);
});

// What services/devOwnership.js displace() writes when an account that owns a dev takes the login.
Given('the legacy developer {string} has been displaced', async function (alias) {
  const dev = await rawDev(this, alias);
  const set = { github_username: `_stale_${dev._id}`, github_username_stale: true, github_username_seen_at: new Date() };
  if (dev.name === dev.github_username) set.name = null;
  await Dev.collection.updateOne({ _id: dev._id, github_id: null }, { $set: set });
});

Given(
  'a developer {string} owned by GitHub account {int} with avatar {string} already exists',
  async function (login, githubId, avatarUrl) {
    const { insertedId } = await Dev.collection.insertOne({
      github_id: githubId,
      github_username: login,
      github_username_seen_at: new Date(),
      name: login,
      bio: 'registered after sign-in',
      avatar_url: avatarUrl,
      techs: ['Go'],
      location: SEED_LOCATION,
      __v: 0,
    });
    rememberAlias(this, login, insertedId);
  }
);

// For Scenario Outline rows that need no extra setup.
Given('the developer database is not otherwise touched', function () {});

// A snapshot for "exactly as before the command" without running a command (AC-24).
Given('I remember every stored developer', async function () {
  await takeSnapshot(this);
});

Given('the developers collection has lost its unique github_id index', async function () {
  await Dev.collection.dropIndex('github_id_unique');
  this.droppedGithubIdIndex = true;
});

After(async function () {
  if (this.droppedGithubIdIndex) await Dev.syncIndexes();
});

// --- Operator commands --------------------------------------------------------------------------

When('the operator runs {string}', async function (command) {
  await takeSnapshot(this);
  keepResult(this, await runOperator(this, command));
});

When('the operator lists the legacy developers as JSON', async function () {
  await takeSnapshot(this);
  const result = await runOperator(this, 'list --json');
  keepResult(this, result);
  expect(result.code, result.stderr.join('\n')).to.equal(0);
  // stdout is only the JSON; the database is named on stderr.
  expect(result.stderr[0]).to.match(/^Database "[^"]+" on /);
  this.listing = JSON.parse(result.stdout.join('\n'));
});

When('two operators run {string} and {string} at the same time', async function (first, second) {
  await takeSnapshot(this);
  this.concurrent = await Promise.all([runOperator(this, first), runOperator(this, second)]);
});

When('the operator runs the command line {string}', async function (command) {
  await takeSnapshot(this);
  keepResult(this, await runProcess(argvOf(await substitute(this, command)), suiteMongoUri()));
});

When('the operator runs the command line {string} with MONGO_URI {string}', async function (command, uri) {
  await takeSnapshot(this);
  keepResult(this, await runProcess(argvOf(await substitute(this, command)), await substitute(this, uri)));
});

When('the operator saves the recovery record to a file', function () {
  const lines = this.cli.stdout;
  const at = lines.findIndex((line) => line.startsWith('Recovery record'));
  expect(at, 'the output should have a recovery record').to.be.greaterThan(-1);
  this.recoveryRecord = lines[at + 1];
  this.recoveryFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devradar-legacy-')), 'record.json');
  fs.writeFileSync(this.recoveryFile, `${this.recoveryRecord}\n`);
});

After(function () {
  if (this.recoveryFile) fs.rmSync(path.dirname(this.recoveryFile), { recursive: true, force: true });
});

// Races (AC-14, AC-18): the API changes the dev after the operator's read and before its
// conditional write. The tool's next findOneAndUpdate / findOneAndDelete on the collection first
// runs `action` through the real app (the interception is removed before, so the app's own
// writes go through untouched), then proceeds.
const collection = Dev.collection;
const realCollectionWrites = {
  findOneAndUpdate: collection.findOneAndUpdate,
  findOneAndDelete: collection.findOneAndDelete,
};

function restoreCollectionWrites() {
  Object.keys(realCollectionWrites).forEach((method) => {
    // The real methods live on the collection's prototype: dropping the override restores them.
    delete collection[method];
    if (collection[method] !== realCollectionWrites[method]) collection[method] = realCollectionWrites[method];
  });
}

After(restoreCollectionWrites);

/** @param {object} world @param {() => Promise<void>} action */
function beforeOperatorWrite(world, action) {
  Object.keys(realCollectionWrites).forEach((method) => {
    collection[method] = async function interceptedOnce(...args) {
      restoreCollectionWrites();
      await action();
      world.raceRan = true;
      return realCollectionWrites[method].apply(collection, args);
    };
  });
}

const PROFILE_BODY = { techs: 'Go', latitude: '-22.9068', longitude: '-43.1729' };

Given(
  /^GitHub account (\d+) as "([^"]+)" (updates their profile|deletes their profile|registers|signs in) just before the operator's write$/,
  function (githubIdText, login, action) {
    const githubId = Number(githubIdText);
    const token = testSessionToken(login, githubId);
    beforeOperatorWrite(this, async () => {
      let response;
      if (action === 'updates their profile') {
        response = await request(this.app).put('/devs/me').set('Authorization', `Bearer ${token}`).send(PROFILE_BODY);
      } else if (action === 'deletes their profile') {
        response = await request(this.app).delete('/devs/me').set('Authorization', `Bearer ${token}`);
      } else if (action === 'registers') {
        response = await request(this.app).post('/devs').set('Authorization', `Bearer ${token}`).send(PROFILE_BODY);
      } else {
        await signInThroughGithub(this, login, { id: githubId });
        response = this.response;
      }
      expect(response.status, `the API should accept: ${action}`).to.be.oneOf([200, 204]);
    });
  }
);

// --- Outcome of a command -----------------------------------------------------------------------

/** @param {object} world @param {number} code */
function expectExit(world, code) {
  expect(world.cli, 'an operator command should have run').to.not.equal(undefined);
  expect(world.cli.code, `exit code; output:\n${world.cli.output}`).to.equal(code);
}

Then('the command should succeed', function () {
  expectExit(this, 0);
});

Then('the command should be refused', function () {
  expectExit(this, 1);
});

Then('the command should be refused with {string}', async function (text) {
  expectExit(this, 1);
  expect(this.cli.stderr.join('\n')).to.include(await substitute(this, text));
});

Then('the command should be rejected as invalid with {string}', async function (text) {
  expectExit(this, 2);
  expect(this.cli.stderr.join('\n')).to.include(await substitute(this, text));
});

Then('the command should exit with code {int}', function (code) {
  expectExit(this, code);
});

Then('the race should have happened', function () {
  expect(this.raceRan, 'the API change should have run between the read and the write').to.equal(true);
});

Then('the output should contain {string}', async function (text) {
  expect(this.cli.output).to.include(await substitute(this, text));
});

Then('the output should not contain {string}', async function (text) {
  expect(this.cli.output).to.not.include(await substitute(this, text));
});

Then('the output should name the database before anything else', function () {
  expect(this.cli.stdout[0], 'first line').to.match(/^MongoDB: mongodb:\/\/127\.0\.0\.1:\d+, database "[^"]+"$/);
  expect(this.cli.stdout[1], 'second line').to.match(/^Database "[^"]+" on 127\.0\.0\.1:\d+ /);
});

Then('the output should name the database before the line starting {string}', function (prefix) {
  const target = this.cli.stdout.findIndex((line) => line.startsWith('MongoDB: '));
  const change = this.cli.stdout.findIndex((line) => line.startsWith(prefix));
  expect(target, 'a target line').to.equal(0);
  expect(change, `a line starting "${prefix}"`).to.be.greaterThan(target);
});

Then('nothing should have been written to the database', async function () {
  const now = await snapshot();
  expect([...now.entries()]).to.deep.equal([...this.before.entries()]);
});

Then('exactly one of the two commands should succeed and the other be refused', function () {
  const codes = this.concurrent.map((result) => result.code).sort();
  expect(codes, this.concurrent.map((result) => result.stderr.join('\n')).join('\n')).to.deep.equal([0, 1]);
  this.cli = this.concurrent.find((result) => result.code === 1);
  this.cli.output = [...this.cli.stdout, ...this.cli.stderr].join('\n');
});

// --- Stored developers --------------------------------------------------------------------------

Then('the developer {string} should belong to GitHub account {int}', async function (alias, githubId) {
  const dev = await rawDev(this, alias);
  expect(dev, `developer "${alias}" should exist`).to.not.be.null;
  expect(dev.github_id).to.equal(githubId);
});

Then('the developer {string} should still be legacy', async function (alias) {
  const dev = await rawDev(this, alias);
  expect(dev, `developer "${alias}" should exist`).to.not.be.null;
  expect(dev.github_id == null, 'github_id should be missing or null').to.equal(true);
});

Then('the developer {string} should be displaced', async function (alias) {
  const dev = await rawDev(this, alias);
  expect(dev, `developer "${alias}" should exist`).to.not.be.null;
  expect(dev.github_username).to.equal(`_stale_${dev._id}`);
  expect(dev.github_username_stale).to.equal(true);
});

Then('the developer {string} should no longer exist', async function (alias) {
  expect(await rawDev(this, alias)).to.equal(null);
});

Then('the developer {string} should be exactly as before the command', async function (alias) {
  const _id = await devIdOf(this, alias);
  const now = await snapshot();
  expect(now.get(_id), `developer "${alias}" should exist`).to.be.a('string');
  expect(now.get(_id)).to.equal(this.before.get(_id));
});

Then('the developer {string} should be exactly as before the first operator command', async function (alias) {
  const _id = await devIdOf(this, alias);
  const now = await snapshot();
  expect(now.get(_id), `developer "${alias}" should exist`).to.be.a('string');
  expect(now.get(_id)).to.equal(this.snapshots[0].get(_id));
});

// AC-8: the only difference is github_id (set in place if it was null, else added at the end).
Then(
  'the developer {string} should be exactly as before the command except github_id {int}',
  async function (alias, githubId) {
    const _id = await devIdOf(this, alias);
    const before = EJSON.parse(this.before.get(_id), { relaxed: false });
    const now = await snapshot();
    expect(now.get(_id), `developer "${alias}" should exist`).to.be.a('string');
    const stored = EJSON.parse(now.get(_id), { relaxed: false });
    expect(EJSON.parse(now.get(_id), { relaxed: true }).github_id).to.equal(githubId);
    expect(Object.keys(stored)).to.deep.equal(Object.keys({ ...before, github_id: githubId }));
    // Every other field exactly as before (the id's BSON number type is the driver's choice).
    const withoutId = ({ github_id, ...rest }) => exact(rest);
    expect(withoutId(stored)).to.equal(withoutId(before));
  }
);

Then('exactly {int} developer(s) should belong to GitHub account {int}', async function (count, githubId) {
  expect(await Dev.collection.countDocuments({ github_id: githubId })).to.equal(count);
});

Then('the recovery record should be the full deleted document of {string}', async function (alias) {
  const _id = await devIdOf(this, alias);
  const lines = this.cli.stdout;
  const at = lines.findIndex((line) => line.startsWith('Recovery record'));
  expect(at, 'the output should have a recovery record').to.be.greaterThan(-1);
  expect(exact(EJSON.parse(lines[at + 1], { relaxed: false }))).to.equal(this.before.get(_id));
});

// --- Listing ------------------------------------------------------------------------------------

/** @param {object} world @param {string} alias @returns {Promise<object | undefined>} */
async function listingEntry(world, alias) {
  const _id = await devIdOf(world, alias);
  return world.listing.devs.find((dev) => dev._id === _id);
}

/** @param {object} value @param {string} dotted @returns {unknown} */
function at(value, dotted) {
  return dotted.split('.').reduce((current, key) => (current == null ? undefined : current[key]), value);
}

Then('the listing should contain {int} developer(s)', function (count) {
  expect(this.listing.devs).to.have.length(count);
});

Then('the listing should not include the developer {string}', async function (alias) {
  expect(await listingEntry(this, alias)).to.equal(undefined);
});

Then('the listing entry for {string} should show:', async function (alias, table) {
  const entry = await listingEntry(this, alias);
  expect(entry, `the listing should include "${alias}"`).to.not.equal(undefined);
  for (const [field, expectedText] of Object.entries(table.rowsHash())) {
    const value = at(entry, field);
    const actual = typeof value === 'string' ? value : JSON.stringify(value);
    expect(actual, field).to.equal(await substitute(this, expectedText));
  }
});

Then('the listing summary should be:', function (docString) {
  expect(this.listing.summary).to.deep.equal(JSON.parse(docString));
});

// --- Through the API ----------------------------------------------------------------------------

Then('the response should be the developer {string}', async function (alias) {
  expect(this.response.body._id).to.equal(await devIdOf(this, alias));
});

/** @param {unknown} body - GET /devs (an array) or GET /search ({ devs }) @returns {string[]} */
function listedIds(body) {
  const devs = Array.isArray(body) ? body : body && body.devs;
  expect(devs, 'the response should list developers').to.be.an('array');
  return devs.map((dev) => dev._id);
}

Then('the response should not include the developer {string}', async function (alias) {
  const _id = await devIdOf(this, alias);
  expect(listedIds(this.response.body)).to.not.include(_id);
});

Then('the response should include the developer {string}', async function (alias) {
  const _id = await devIdOf(this, alias);
  expect(listedIds(this.response.body)).to.include(_id);
});

Then('the response should have techs {string} at latitude {float} and longitude {float}', function (techs, latitude, longitude) {
  expect(this.response.body.techs).to.deep.equal(techs.split(','));
  expect(this.response.body.location.coordinates).to.deep.equal([longitude, latitude]);
});

// AC-24: every field that could name an owner, in the body, the query and headers.
async function ownershipClaims(world, alias) {
  const _id = await devIdOf(world, alias);
  const dev = await rawDev(world, alias);
  return {
    github_id: 501,
    _id,
    id: _id,
    avatar_url: dev.avatar_url,
    github_username: dev.github_username,
    profile: { name: 'Owner', avatar_url: dev.avatar_url, bio: null },
    merge: _id,
    assign: 501,
  };
}

When(
  'I send a signed-in {word} request to {string} carrying every ownership field of {string}',
  async function (method, route, alias) {
    const claims = await ownershipClaims(this, alias);
    const query = Object.fromEntries(Object.entries(claims).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)]));
    this.response = await request(this.app)[method.toLowerCase()](route)
      .set('Authorization', `Bearer ${this.sessionToken}`)
      .set('X-Github-Id', '501')
      .set('X-Dev-Id', claims._id)
      .set('X-Avatar-Url', String(claims.avatar_url))
      .query(query)
      .send({ ...claims, techs: 'Go', latitude: '-23.5505', longitude: '-46.6333' });
  }
);

When('a signed-in client connects via WebSocket carrying every ownership field of {string}', async function (alias) {
  const claims = await ownershipClaims(this, alias);
  if (!this.server.listening) await new Promise((resolve) => this.server.listen(0, resolve));
  const socket = io(`http://127.0.0.1:${this.server.address().port}`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: { token: this.sessionToken, ...claims },
    query: {
      latitude: '-23.5505',
      longitude: '-46.6333',
      techs: 'Node.js',
      ...Object.fromEntries(Object.entries(claims).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)])),
    },
  });
  this.sockets.push(socket);
  const outcome = await new Promise((resolve) => {
    socket.on('connect', () => resolve('connected'));
    socket.on('connect_error', () => resolve('refused'));
    setTimeout(() => resolve('timeout'), 2000);
  });
  expect(outcome).to.equal('connected');
});

/** @param {object} layerStack - an Express router stack @returns {string[]} every route path */
function routePaths(layerStack) {
  return layerStack.flatMap((layer) => {
    if (layer.route) return [String(layer.route.path)];
    if (layer.handle && Array.isArray(layer.handle.stack)) return routePaths(layer.handle.stack);
    return [];
  });
}

Then('the API should have no route for operating on legacy developers', function () {
  const paths = routePaths(this.app.router.stack);
  expect(paths, 'the app should expose its routes').to.include('/devs/me');
  paths.forEach((routePath) => {
    expect(routePath).to.not.match(/admin|legacy|merge|assign|restore|operator/i);
  });
});
