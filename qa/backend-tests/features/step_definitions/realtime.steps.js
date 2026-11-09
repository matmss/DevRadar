const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('chai');
const io = require('socket.io-client');
const { findConnections } = require('../../../../dev/backend/src/websocket');
// Note: the "When I submit a registration with ..." step used by these scenarios is
// defined once in registration.steps.js and reused here — Cucumber.js errors on duplicate
// step definitions ("ambiguous step"), so it must not be redefined in this file.

Given(
  'a client {string} is connected via WebSocket at latitude {string}, longitude {string} watching techs {string}',
  async function (alias, latitude, longitude, techs) {
    // Start the underlying HTTP server on an ephemeral port so socket.io-client can connect.
    if (!this.server.listening) await new Promise((resolve) => this.server.listen(0, resolve));
    const { port } = this.server.address();

    const socket = io(`http://127.0.0.1:${port}`, {
      query: { latitude, longitude, techs },
      transports: ['websocket'],
      forceNew: true,
    });

    this.receivedEvents[alias] = [];
    socket.on('new-dev', (payload) => {
      this.receivedEvents[alias].push({ event: 'new-dev', payload });
    });

    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
    });

    this.sockets.push(socket);
    this.socketsByAlias = { ...(this.socketsByAlias || {}), [alias]: socket };
  }
);

Then('client {string} should receive a {string} event within {int} seconds', async function (alias, eventName, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (this.receivedEvents[alias].some((e) => e.event === eventName)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  expect.fail(`Expected client "${alias}" to receive a "${eventName}" event within ${seconds}s, but it did not.`);
});

Then('client {string} should not receive a {string} event within {int} seconds', async function (alias, eventName, seconds) {
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const received = this.receivedEvents[alias].some((e) => e.event === eventName);
  expect(received, `Expected client "${alias}" NOT to receive a "${eventName}" event, but it did.`).to.be.false;
});

// Waits the whole window, then counts: proves no extra event arrives late.
Then('client {string} should receive exactly {int} {string} event(s) within {int} seconds', async function (alias, count, eventName, seconds) {
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const received = this.receivedEvents[alias].filter((e) => e.event === eventName).length;
  expect(received, `client "${alias}" "${eventName}" events`).to.equal(count);
});

Then('the event payload for {string} should contain github_username {string}', function (alias, username) {
  const match = this.receivedEvents[alias].find((e) => e.payload.github_username === username);
  expect(match, `No "new-dev" event with github_username "${username}" found for "${alias}"`).to.not.be.undefined;
});

async function ensureListening(server) {
  if (!server.listening) await new Promise((resolve) => server.listen(0, resolve));
  return server.address().port;
}

async function waitUntil(predicate, timeoutMs = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

function subscriptionCount(latitude, longitude, techs) {
  return findConnections({ latitude: Number(latitude), longitude: Number(longitude) }, techs.split(',')).length;
}

Then(
  /^there should be (\d+) live subscriptions? near latitude "([^"]*)", longitude "([^"]*)" for techs "([^"]*)"$/,
  async function (count, latitude, longitude, techs) {
    // Disconnect handling is async on the server side, so poll briefly before asserting.
    await waitUntil(() => subscriptionCount(latitude, longitude, techs) === Number(count));
    expect(subscriptionCount(latitude, longitude, techs)).to.equal(Number(count));
  }
);

When('client {string} disconnects', function (alias) {
  const socket = this.socketsByAlias[alias];
  socket.disconnect();
});

When('a client connects via WebSocket without query params', async function () {
  const port = await ensureListening(this.server);
  this.rejectedSocket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  this.sockets.push(this.rejectedSocket);
  this.rejectedSocketDisconnected = new Promise((resolve) => this.rejectedSocket.on('disconnect', resolve));
});

Then('that client should be disconnected by the server', async function () {
  const reason = await Promise.race([
    this.rejectedSocketDisconnected,
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 2000)),
  ]);
  expect(reason).to.equal('io server disconnect');
});
