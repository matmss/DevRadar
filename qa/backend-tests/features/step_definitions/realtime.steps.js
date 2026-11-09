const { Given, When, Then } = require('@cucumber/cucumber');
const { expect } = require('chai');
const io = require('socket.io-client');
const { findConnections } = require('../../../../dev/backend/src/websocket');
const { testSessionToken, expiredSessionToken, forgedSessionToken } = require('../support/session');
// Note: the "When I submit a registration with ..." step used by these scenarios is
// defined once in registration.steps.js and reused here — Cucumber.js errors on duplicate
// step definitions ("ambiguous step"), so it must not be redefined in this file.

// --- Connecting -------------------------------------------------------------------------------
// Since auth slice 4 the handshake must carry a session token in the Socket.io `auth` payload
// (dev/backend/src/websocket.js). A "signed-in client" is another signed-in user watching the
// map: its token is signed for SOCKET_VIEWER (test-only sign-in, support/session.js) and kept per
// alias, so a scenario can reuse it later (e.g. after it expired).
const SOCKET_VIEWER = 'socket-viewer';

/** Starts the HTTP server on an ephemeral port (once) so socket.io-client can connect. */
async function ensureListening(server) {
  if (!server.listening) await new Promise((resolve) => server.listen(0, resolve));
  return server.address().port;
}

/**
 * Opens a socket and records its `new-dev` events under `alias`. Never auto-reconnects, so a
 * refused handshake stays refused. Closed by the After hook in hooks.js.
 * @param {object} world
 * @param {string} alias
 * @param {object} options - socket.io-client options (auth, query, extraHeaders)
 * @returns {Promise<import('socket.io-client').Socket>}
 */
async function openSocket(world, alias, options) {
  const port = await ensureListening(world.server);
  const socket = io(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    ...options,
  });
  world.receivedEvents[alias] = [];
  socket.on('new-dev', (payload) => {
    world.receivedEvents[alias].push({ event: 'new-dev', payload });
  });
  world.sockets.push(socket);
  world.socketsByAlias = { ...(world.socketsByAlias || {}), [alias]: socket };
  return socket;
}

/**
 * Waits for the handshake outcome.
 * @param {import('socket.io-client').Socket} socket
 * @returns {Promise<{ connected: boolean, error: (Error & { data?: any }) | null, timedOut?: boolean }>}
 */
function handshakeOutcome(socket, timeoutMs = 2000) {
  return new Promise((resolve) => {
    socket.on('connect', () => resolve({ connected: true, error: null }));
    socket.on('connect_error', (error) => resolve({ connected: false, error }));
    setTimeout(() => resolve({ connected: false, error: null, timedOut: true }), timeoutMs);
  });
}

Given(
  'a signed-in client {string} is connected via WebSocket at latitude {string}, longitude {string} watching techs {string}',
  async function (alias, latitude, longitude, techs) {
    const token = testSessionToken(SOCKET_VIEWER);
    this.socketTokens = { ...(this.socketTokens || {}), [alias]: token };
    const socket = await openSocket(this, alias, { auth: { token }, query: { latitude, longitude, techs } });
    const outcome = await handshakeOutcome(socket);
    const reason = outcome.error && outcome.error.data ? outcome.error.data.code : outcome.timedOut && 'timeout';
    expect(outcome.connected, `client "${alias}" should be connected (refused: ${reason})`).to.equal(true);
  }
);

/**
 * Handshake options for the "tries to connect via WebSocket <how>" steps. `how`:
 *  - "without a session token"
 *  - "with an expired session token"            a genuine token whose 7 days are over
 *  - "with a <kind> session token"              forgedSessionToken kinds (tampered, malformed, ...)
 *  - "with the session token of client <alias>" the token a "signed-in client" connected with
 *  - "with a valid session token in the query string" / "... in an Authorization header"
 *  - "with a valid session token"
 * @param {object} world
 * @param {string} how
 * @returns {{ auth?: object, query?: object, extraHeaders?: object }}
 */
function handshakeOptions(world, how) {
  const valid = () => testSessionToken(SOCKET_VIEWER);
  if (how === 'without a session token') return {};
  if (how === 'with a valid session token') return { auth: { token: valid() } };
  if (how === 'with an expired session token') return { auth: { token: expiredSessionToken(SOCKET_VIEWER) } };
  if (how === 'with a valid session token in the query string') return { query: { token: valid() } };
  if (how === 'with a valid session token in an Authorization header') {
    return { extraHeaders: { Authorization: `Bearer ${valid()}` } };
  }
  const reuse = /^with the session token of client "([^"]+)"$/.exec(how);
  if (reuse) return { auth: { token: world.socketTokens[reuse[1]] } };
  const forged = /^with an? (\S+) session token$/.exec(how);
  if (forged) return { auth: { token: forgedSessionToken(forged[1]) } };
  throw new Error(`Unknown handshake: ${how}`);
}

When(
  /^client "([^"]+)" tries to connect via WebSocket (.+) at latitude "([^"]*)", longitude "([^"]*)" watching techs "([^"]*)"$/,
  async function (alias, how, latitude, longitude, techs) {
    const options = handshakeOptions(this, how);
    // A token "in the query string" goes next to the subscription params, like a careless client.
    options.query = { ...(options.query || {}), latitude, longitude, techs };
    const socket = await openSocket(this, alias, options);
    this.handshakes = { ...(this.handshakes || {}), [alias]: await handshakeOutcome(socket) };
  }
);

When(
  /^client "([^"]+)" tries to connect via WebSocket (.+) and without subscription params$/,
  async function (alias, how) {
    const socket = await openSocket(this, alias, handshakeOptions(this, how));
    this.handshakes = { ...(this.handshakes || {}), [alias]: await handshakeOutcome(socket) };
  }
);

When('{int} clients try to connect via WebSocket with a malformed session token', async function (count) {
  for (let i = 0; i < count; i += 1) {
    const socket = await openSocket(this, `rejected-${i}`, {
      auth: { token: 'not-a-jwt' },
      query: { latitude: '-23.5505', longitude: '-46.6333', techs: 'ReactJS' },
    });
    const outcome = await handshakeOutcome(socket);
    expect(outcome.connected, `rejected client ${i} should have been refused`).to.equal(false);
  }
});

Then('client {string} should be refused with code {string}', function (alias, code) {
  const outcome = this.handshakes[alias];
  expect(outcome.connected, `client "${alias}" should have been refused`).to.equal(false);
  expect(outcome.error, `client "${alias}" should have received a connect_error`).to.not.equal(null);
  expect(outcome.error.data, 'connect_error data').to.be.an('object');
  expect(outcome.error.data.code).to.equal(code);
  expect(outcome.error.data.details).to.be.an('array').that.is.not.empty;
  expect(outcome.error.message).to.be.a('string').that.is.not.empty;
});

Then('client {string} should not be connected', function (alias) {
  expect(this.socketsByAlias[alias].connected).to.equal(false);
});

Then('client {string} should still be connected', function (alias) {
  expect(this.socketsByAlias[alias].connected).to.equal(true);
});

Then('the refusal sent to client {string} should not contain a session token', function (alias) {
  const { error } = this.handshakes[alias];
  const sent = JSON.stringify({ message: error.message, data: error.data });
  expect(sent).to.not.match(/eyJ[\w-]+\.[\w-]+\./);
});

// --- Events -----------------------------------------------------------------------------------

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

// --- Subscriptions ----------------------------------------------------------------------------

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
