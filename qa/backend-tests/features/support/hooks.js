const { Before, After, BeforeAll, AfterAll } = require('@cucumber/cucumber');
// Must be the SAME mongoose instance dev/backend/src/models/Dev.js uses (dev/backend/node_modules/mongoose),
// not this package's own copy — mongoose's connection is a module-level singleton, so connecting a
// different copy here leaves the app's models pointed at an unconnected instance and every query hangs.
const mongoose = require('../../../../dev/backend/node_modules/mongoose');
const nock = require('nock');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createTestApp } = require('./testApp');

let mongod;

BeforeAll({ timeout: 60000 }, async function () {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
});

AfterAll(async function () {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

Before(async function () {
  // Fresh app + server per scenario so websocket in-memory `connections` state
  // (see dev/backend/src/websocket.js) never leaks between scenarios.
  const { app, server } = createTestApp();
  this.app = app;
  this.server = server;

  // Empty the DB between scenarios (Background steps like
  // "Given the developer database is empty" rely on this already being true).
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }

  nock.cleanAll();
  nock.disableNetConnect();
  nock.enableNetConnect('127.0.0.1'); // allow supertest/socket.io-client local traffic
});

After(async function () {
  for (const socket of this.sockets) {
    if (socket.connected) socket.disconnect();
  }
  this.sockets = [];

  if (this.server && this.server.listening) {
    await new Promise((resolve) => this.server.close(resolve));
  }

  nock.cleanAll();
  nock.enableNetConnect();
});
