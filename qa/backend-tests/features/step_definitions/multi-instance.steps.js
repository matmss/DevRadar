// Steps for multi-instance.feature (also used by shared-auth.feature): two backend instances in
// this process, sharing the database and the GitHub mock, each with its own server context
// (dev/backend/src/serverContext.js). "A" is the scenario's own instance (hooks.js), "B" one
// started by support/testApp.js startTestInstance. Both listen on 127.0.0.1 and every request
// and socket dials 127.0.0.1 (BUG-013). Helpers: support/instances.js.
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const io = require('socket.io-client');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { startTestInstance } = require('../support/testApp');
const { testSessionToken } = require('../support/session');
const {
  CLIENT_REDIRECT,
  listenOnLoopback,
  instanceNamed,
  startSignIn,
  callBack,
  mockNextGithubSignIn,
  noteResponseSecrets,
  redeemRequest,
} = require('../support/instances');

const SOCKET_VIEWER = 'socket-viewer';
const HELD_DELETE_TIMEOUT_MS = 2000;

// --- Instances --------------------------------------------------------------------------------

Given('backend instances {string} and {string} share the database', async function (first, second) {
  this.instancesByName = {
    [first]: { context: this.context, url: await listenOnLoopback(this.server) },
  };
  const other = await startTestInstance(this);
  this.instancesByName[second] = { context: other.context, url: other.url };
  expect(other.context, 'each instance has its own server context').to.not.equal(this.context);
});

// --- Sign-in ----------------------------------------------------------------------------------

Given('GitHub will sign in {string} at the next callback', function (username) {
  mockNextGithubSignIn(this, username);
});

When('sign-in is started on instance {string}', async function (name) {
  await startSignIn(this, name);
});

When('sign-in is started {int} times on instance {string}', async function (times, name) {
  for (let i = 0; i < times; i += 1) {
    await startSignIn(this, name);
    expect(this.response.status, `sign-in start ${i + 1} on instance "${name}"`).to.equal(302);
  }
});

When('GitHub sends the browser back to instance {string} with that state', async function (name) {
  expect(this.authState, 'a sign-in should have been started').to.be.a('string');
  await callBack(this, name);
});

Then('the browser should be sent back to the client with a one-time code', function () {
  expect(this.response.status).to.equal(302);
  const location = new URL(this.response.headers.location);
  expect(`${location.origin}${location.pathname}`).to.equal(CLIENT_REDIRECT);
  this.oneTimeCode = location.searchParams.get('code');
  expect(this.oneTimeCode, 'one-time code in the redirect').to.be.a('string').that.is.not.empty;
});

Given('{string} got a one-time sign-in code from instance {string}', async function (username, name) {
  mockNextGithubSignIn(this, username);
  await startSignIn(this, name);
  expect(this.response.status, 'sign-in start').to.equal(302);
  await callBack(this, name);
  expect(this.response.status, 'GitHub callback').to.equal(302);
  this.oneTimeCode = new URL(this.response.headers.location).searchParams.get('code');
  expect(this.oneTimeCode, 'one-time code in the redirect').to.be.a('string').that.is.not.empty;
});

When('the one-time code is redeemed on instance {string}', async function (name) {
  this.response = noteResponseSecrets(
    this,
    await redeemRequest(this, name, { code: this.oneTimeCode, code_verifier: this.pkceVerifier })
  );
});

Then('the response should carry a session token for {string}', function (username) {
  expect(this.response.status).to.equal(200);
  expect(this.response.body.token).to.be.a('string').that.is.not.empty;
  expect(this.response.body.user.github_username).to.equal(username);
});

// --- Sockets ----------------------------------------------------------------------------------

/**
 * @param {import('socket.io-client').Socket} socket
 * @returns {Promise<string | null>} null once connected, else why not
 */
function connectOutcome(socket) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), 2000);
    socket.on('connect', () => { clearTimeout(timer); resolve(null); });
    socket.on('connect_error', (err) => { clearTimeout(timer); resolve((err.data && err.data.code) || err.message); });
  });
}

Given(
  'a signed-in client {string} is connected to instance {string} at latitude {string}, longitude {string} watching techs {string}',
  async function (alias, name, latitude, longitude, techs) {
    const socket = io(instanceNamed(this, name).url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { token: testSessionToken(SOCKET_VIEWER) },
      query: { latitude, longitude, techs },
    });
    this.receivedEvents[alias] = [];
    socket.onAny((event, payload) => this.receivedEvents[alias].push({ event, payload }));
    this.sockets.push(socket); // closed by hooks.js
    const refused = await connectOutcome(socket);
    expect(refused, `client "${alias}" should be connected to instance "${name}"`).to.equal(null);
  }
);

Then(
  /^instance "([^"]*)" should have (\d+) live subscriptions? near latitude "([^"]*)", longitude "([^"]*)" for techs "([^"]*)"$/,
  async function (name, count, latitude, longitude, techs) {
    const { realtime } = instanceNamed(this, name).context;
    const matching = () => realtime.findConnections(
      { latitude: Number(latitude), longitude: Number(longitude) },
      techs.split(',')
    ).length;
    const deadline = Date.now() + 2000;
    while (matching() !== Number(count) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(matching(), `live subscriptions on instance "${name}"`).to.equal(Number(count));
    // Every socket connected to this instance matches here, so none of the other's is listed.
    expect(realtime.connectionCount(), `sockets connected to instance "${name}"`).to.equal(Number(count));
  }
);

// --- Profile writes ---------------------------------------------------------------------------

/**
 * POST /devs on `name` as the signed-in user.
 * @param {object} world
 * @param {string} name
 * @param {{ techs: string, latitude: string, longitude: string }} body
 */
async function register(world, name, body) {
  world.response = await request(instanceNamed(world, name).url)
    .post('/devs')
    .set('Authorization', `Bearer ${world.sessionToken}`)
    .send(body);
}

When(
  'I register on instance {string} with techs {string}, latitude {string} and longitude {string}',
  async function (name, techs, latitude, longitude) {
    await register(this, name, { techs, latitude, longitude });
  }
);

Given(
  'I registered on instance {string} with techs {string}, latitude {string} and longitude {string}',
  async function (name, techs, latitude, longitude) {
    await register(this, name, { techs, latitude, longitude });
    expect(this.response.status, 'registration').to.equal(200);
  }
);

/** @param {object} world @param {string} name @returns {import('supertest').Test} */
function deleteOwnProfile(world, name) {
  return request(instanceNamed(world, name).url)
    .delete('/devs/me')
    .set('Authorization', `Bearer ${world.sessionToken}`);
}

// Holds the next Dev.findOneAndDelete (the delete of a normal dev, services/devOwnership.js
// deleteStored) until "the held delete is released", so that request stays queued on its
// instance. Later deletes go straight to the database.
const realFindOneAndDelete = Dev.findOneAndDelete;
After(function () {
  Dev.findOneAndDelete = realFindOneAndDelete;
  if (this.releaseHeldDelete) this.releaseHeldDelete();
});

Given('the next profile delete is held at the database', function () {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  this.releaseHeldDelete = release;
  this.heldDeleteReached = new Promise((reached) => {
    Dev.findOneAndDelete = function held(...args) {
      Dev.findOneAndDelete = realFindOneAndDelete;
      reached();
      return gate.then(() => realFindOneAndDelete.apply(Dev, args));
    };
  });
});

When('I start deleting my profile on instance {string}', async function (name) {
  // A supertest request starts when then() is called; its answer is awaited after the release.
  this.heldDelete = deleteOwnProfile(this, name).then((response) => response);
  const reached = await Promise.race([
    this.heldDeleteReached.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), HELD_DELETE_TIMEOUT_MS)),
  ]);
  expect(reached, 'the delete should have reached the database').to.equal(true);
});

When('I delete my profile on instance {string}', async function (name) {
  this.response = await deleteOwnProfile(this, name);
});

When('the held delete is released', async function () {
  this.releaseHeldDelete();
  this.response = await this.heldDelete;
});

Then(/^instance "([^"]*)" should have (\d+) accounts? with a write queued$/, function (name, count) {
  const { ownership } = instanceNamed(this, name).context;
  expect(ownership.pendingWrites(), `accounts with a write queued on instance "${name}"`).to.equal(Number(count));
});
