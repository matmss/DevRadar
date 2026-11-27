// Steps for shared-stores.feature: the MongoDB-backed stores of multi-instance PR1 called directly,
// against the suite's ephemeral mongod (hooks.js empties their collections before every scenario).
const crypto = require('crypto');
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { expect } = require('chai');
const { MongoRateLimitStore } = require('../../../../dev/backend/src/middleware/mongoRateLimitStore');
const { createSharedOneTimeStore } = require('../../../../dev/backend/src/utils/sharedOneTimeStore');
const { AuthOneTime, RateLimit, mongoNow } = require('../support/shared-state');

const WINDOW_SLACK_MS = 5000;

After(function () {
  if (this.restoreOneTimeInsert) this.restoreOneTimeInsert();
  this.restoreOneTimeInsert = null;
});

// --- Rate-limit store ----------------------------------------------------------------------------

/** @param {object} world @param {string} prefix @returns {MongoRateLimitStore} */
function rateLimitStore(world, prefix) {
  const store = world.rateLimitStores && world.rateLimitStores[prefix];
  if (!store) throw new Error(`No rate-limit store with prefix "${prefix}" in this scenario`);
  return store;
}

Given('a rate-limit store with prefix {string} and a {int} second window', function (prefix, seconds) {
  // Built with another window on purpose: express-rate-limit's init() passes the limiter's own.
  const store = new MongoRateLimitStore({ prefix, windowMs: 1 });
  store.init({ windowMs: seconds * 1000 });
  this.rateLimitStores = { ...(this.rateLimitStores || {}), [prefix]: store };
});

When(/^key "([^"]*)" gets (\d+) hits? in store "([^"]*)"$/, async function (key, times, prefix) {
  for (let i = 0; i < Number(times); i += 1) await rateLimitStore(this, prefix).increment(key);
});

When(/^key "([^"]*)" gets (\d+) hits? taken back in store "([^"]*)"$/, async function (key, times, prefix) {
  for (let i = 0; i < Number(times); i += 1) await rateLimitStore(this, prefix).decrement(key);
});

When('key {string} gets {int} hits at once in store {string}', async function (key, times, prefix) {
  const store = rateLimitStore(this, prefix);
  this.concurrentHits = await Promise.all(Array.from({ length: times }, () => store.increment(key)));
  this.concurrentHitsId = `${prefix}${key}`;
});

// The returned resetTime is on the instance's clock (Date.now() + time left), so it differs by a
// few ms per hit; the window itself is the one stored document.
Then('those hits should have counted 1 to {int}', async function (last) {
  const counted = this.concurrentHits.map((hit) => hit.totalHits).sort((a, b) => a - b);
  expect(counted).to.deep.equal(Array.from({ length: last }, (_, i) => i + 1));
  const stored = await RateLimit.collection.find({ _id: this.concurrentHitsId }).toArray();
  expect(stored.map((doc) => doc.hits), 'stored windows of that key').to.deep.equal([last]);
});

When('the window of key {string} in store {string} is over', async function (key, prefix) {
  const result = await RateLimit.collection.updateOne(
    { _id: `${prefix}${key}` },
    [{ $set: { resetTime: { $subtract: ['$$NOW', 1000] } } }]
  );
  expect(result.modifiedCount, 'counters changed').to.equal(1);
});

Then('store {string} should count no window for key {string}', async function (prefix, key) {
  expect(await rateLimitStore(this, prefix).get(key)).to.equal(undefined);
});

Then(
  /^store "([^"]*)" should count (\d+) hits? for key "([^"]*)" in a window ending about (\d+) seconds from now by MongoDB's clock$/,
  async function (prefix, hits, key, seconds) {
    const info = await rateLimitStore(this, prefix).get(key);
    expect(info, `the window of key "${key}"`).to.not.equal(undefined);
    expect(info.totalHits).to.equal(Number(hits));
    // Returned on this instance's clock (what express-rate-limit subtracts Date.now() from) ...
    const msLeftHere = info.resetTime.getTime() - Date.now();
    expect(msLeftHere, 'ms left, returned resetTime').to.be.at.most(Number(seconds) * 1000);
    expect(msLeftHere, 'ms left, returned resetTime').to.be.above(Number(seconds) * 1000 - WINDOW_SLACK_MS);
    // ... stored on MongoDB's.
    const stored = await RateLimit.collection.findOne({ _id: `${prefix}${key}` });
    const msLeftStored = stored.resetTime.getTime() - (await mongoNow()).getTime();
    expect(msLeftStored, 'ms left, stored resetTime').to.be.at.most(Number(seconds) * 1000);
    expect(msLeftStored, 'ms left, stored resetTime').to.be.above(Number(seconds) * 1000 - WINDOW_SLACK_MS);
  }
);

Then('the stored counter {string} should still be at {int}', async function (id, hits) {
  const doc = await RateLimit.collection.findOne({ _id: id });
  expect(doc && doc.hits, `stored counter "${id}"`).to.equal(hits);
});

When('key {string} of store {string} is reset', async function (key, prefix) {
  await rateLimitStore(this, prefix).resetKey(key);
});

When('store {string} is reset', async function (prefix) {
  await rateLimitStore(this, prefix).resetAll();
});

// --- One-time store ------------------------------------------------------------------------------

/** @param {object} world @param {string} kind */
function oneTimeStore(world, kind) {
  const store = world.oneTimeStores && world.oneTimeStores[kind];
  if (!store) throw new Error(`No one-time store for "${kind}" values in this scenario`);
  return store;
}

Given('a one-time store for {string} values living {int} seconds', function (kind, seconds) {
  this.oneTimeStores = { ...(this.oneTimeStores || {}), [kind]: createSharedOneTimeStore({ kind, ttlMs: seconds * 1000 }) };
  this.lastOneTimeKind = kind;
});

/** @param {string} kind @returns {object} a payload unique to this call */
function freshPayload(kind) {
  return { kind, nonce: crypto.randomBytes(8).toString('hex'), nested: { n: 1, none: null } };
}

When('it issues a key for a payload with the strings {string}, {string} and {string}', async function (first, second, third) {
  const payload = { redirect: first, nested: { value: second, none: null }, list: [third, 1] };
  this.issued = { payload, key: await oneTimeStore(this, this.lastOneTimeKind).issue(payload) };
});

When('the {string} store issues a key', async function (kind) {
  const payload = freshPayload(kind);
  this.issued = { payload, key: await oneTimeStore(this, kind).issue(payload) };
});

When('the {string} store issues another key', async function (kind) {
  await oneTimeStore(this, kind).issue(freshPayload(kind));
});

When('the {string} store tries to issue a key', async function (kind) {
  this.issueError = null;
  try {
    await oneTimeStore(this, kind).issue(freshPayload(kind));
  } catch (err) {
    this.issueError = err;
  }
});

When('the {string} store is cleared', async function (kind) {
  await oneTimeStore(this, kind).clear();
});

Then(
  /^consuming that key in the "([^"]*)" store (?:again )?should give (back the same payload|nothing)$/,
  async function (kind, outcome) {
    expect(this.issued, 'a key issued earlier').to.be.an('object');
    const got = await oneTimeStore(this, kind).consume(this.issued.key);
    if (outcome === 'nothing') expect(got).to.equal(null);
    else expect(got).to.deep.equal(this.issued.payload);
  }
);

Given(/^the next (\d+) inserts? of a one-time value fails? as a duplicate key$/, function (count) {
  const { collection } = AuthOneTime;
  const realUpdateOne = collection.updateOne;
  let failuresLeft = Number(count);
  this.oneTimeInsertFilters = [];
  collection.updateOne = (filter, ...rest) => {
    this.oneTimeInsertFilters.push(filter);
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      return Promise.reject(Object.assign(new Error('E11000 duplicate key error collection: auth_one_time'), {
        name: 'MongoServerError', code: 11000, codeName: 'DuplicateKey',
      }));
    }
    return realUpdateOne.call(collection, filter, ...rest);
  };
  this.restoreOneTimeInsert = () => { delete collection.updateOne; };
});

Then('it should have tried {int} different stored ids, each only if absent', function (count) {
  const filters = this.oneTimeInsertFilters;
  expect(filters).to.have.length(count);
  expect(new Set(filters.map((filter) => filter._id)).size, 'distinct stored ids').to.equal(count);
  for (const filter of filters) expect(filter).to.deep.equal({ _id: filter._id, expiresAt: { $exists: false } });
});

Then('issuing should have failed with {string}', function (message) {
  expect(this.issueError, 'issuing should have failed').to.be.an('error');
  expect(this.issueError.name).to.equal('SharedStateError');
  expect(this.issueError.message).to.equal(message);
});
