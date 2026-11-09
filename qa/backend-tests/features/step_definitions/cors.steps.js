const { When, Then } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const io = require('socket.io-client');

When('I request the list of all developers from origin {string}', async function (origin) {
  this.response = await request(this.app).get('/devs').set('Origin', origin);
});

When('a browser at origin {string} sends a preflight for {string} {string}', async function (origin, method, path) {
  this.response = await request(this.app)
    .options(path)
    .set('Origin', origin)
    .set('Access-Control-Request-Method', method)
    .set('Access-Control-Request-Headers', 'content-type');
});

Then('the response should allow origin {string}', function (origin) {
  expect(this.response.headers['access-control-allow-origin']).to.equal(origin);
});

Then('the response should not allow any origin', function () {
  expect(this.response.headers).to.not.have.property('access-control-allow-origin');
});

When('a browser client at origin {string} connects via WebSocket watching techs {string}', async function (origin, techs) {
  if (!this.server.listening) await new Promise((resolve) => this.server.listen(0, resolve));
  const { port } = this.server.address();

  const socket = io(`http://127.0.0.1:${port}`, {
    query: { latitude: '-23.5505', longitude: '-46.6333', techs },
    transports: ['websocket'],
    extraHeaders: { Origin: origin },
    forceNew: true,
    reconnection: false,
  });
  this.sockets.push(socket);

  this.handshakeResult = await new Promise((resolve) => {
    socket.on('connect', () => resolve('accepted'));
    socket.on('connect_error', () => resolve('refused'));
    setTimeout(() => resolve('timeout'), 2000);
  });
});

Then('that WebSocket connection should be refused', function () {
  expect(this.handshakeResult).to.equal('refused');
});

Then('that WebSocket connection should be accepted', function () {
  expect(this.handshakeResult).to.equal('accepted');
});
