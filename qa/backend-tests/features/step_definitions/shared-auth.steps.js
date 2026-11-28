// Steps for shared-auth.feature (multi-instance PR1): the OAuth state, the one-time sign-in codes
// and the rate-limit counters live in MongoDB (auth_one_time, rate_limits) and are shared by every
// backend instance. Instances "A" and "B" come from multi-instance.steps.js ("backend instances
// ... share the database"); helpers from support/instances.js and support/shared-state.js.
const util = require('util');
const crypto = require('crypto');
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
const {
  instanceNamed,
  startSignIn,
  callBackRequest,
  mockNextGithubSignIn,
  noteSecret,
  noteResponseSecrets,
  redeemRequest,
  CLIENT_REDIRECT,
} = require('../support/instances');
const {
  AuthOneTime,
  RateLimit,
  storedIdOf,
  storedOneTimeDoc,
  expireOneTimeValue,
  allOneTimeDocs,
  allRateLimitDocs,
  setTtlMonitor,
  mongoNow,
  indexesOf,
} = require('../support/shared-state');

const WINDOW_SECONDS = 15 * 60;
const LIFETIME_SLACK_MS = 5000;

// --- Restoring what a scenario changed -----------------------------------------------------------

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'];
const realConsole = Object.fromEntries(CONSOLE_METHODS.map((method) => [method, console[method]]));

After(async function () {
  for (const method of CONSOLE_METHODS) console[method] = realConsole[method];
  // Store failures are one-shot own properties over Mongoose's collection methods.
  for (const { collection, method } of this.storeFailures || []) delete collection[method];
  this.storeFailures = [];
  if (this.ttlMonitorOff) {
    await setTtlMonitor(true);
    this.ttlMonitorOff = false;
  }
});

// --- Sign-in across instances --------------------------------------------------------------------

/**
 * @param {string} first @param {string} second @param {number} times
 * @returns {string[]} the two instance names, alternating, `times` each
 */
function interleave(first, second, times) {
  return Array.from({ length: times }, () => [first, second]).flat();
}

When(
  'GitHub sends the browser back {int} times at once to each of instances {string} and {string} with that state',
  async function (times, first, second) {
    expect(this.authState, 'a sign-in should have been started').to.be.a('string');
    this.concurrentResponses = await Promise.all(
      interleave(first, second, times).map((name) => callBackRequest(this, name).then((r) => noteResponseSecrets(this, r)))
    );
  }
);

When(
  'the one-time code is redeemed {int} times at once on each of instances {string} and {string}',
  async function (times, first, second) {
    const body = { code: this.oneTimeCode, code_verifier: this.pkceVerifier };
    this.concurrentResponses = await Promise.all(
      interleave(first, second, times).map((name) => redeemRequest(this, name, body).then((r) => noteResponseSecrets(this, r)))
    );
  }
);

When('the one-time code is redeemed on instance {string} with a wrong verifier', async function (name) {
  const wrongVerifier = crypto.randomBytes(32).toString('base64url');
  noteSecret(this, wrongVerifier);
  this.response = noteResponseSecrets(
    this,
    await redeemRequest(this, name, { code: this.oneTimeCode, code_verifier: wrongVerifier })
  );
});

Then('exactly one of those callbacks should send the browser back to the client with a one-time code', function () {
  const winners = this.concurrentResponses.filter((response) => response.status === 302
    && new URL(response.headers.location).searchParams.get('code'));
  expect(winners, 'callbacks answered with a one-time code').to.have.length(1);
  const location = new URL(winners[0].headers.location);
  expect(`${location.origin}${location.pathname}`).to.equal(CLIENT_REDIRECT);
  this.oneTimeCode = location.searchParams.get('code');
  this.concurrentLosers = this.concurrentResponses.filter((response) => response !== winners[0]);
});

Then('exactly one of those redemptions should carry a session token for {string}', function (username) {
  const winners = this.concurrentResponses.filter((response) => response.status === 200);
  expect(winners, 'redemptions answered with a session token').to.have.length(1);
  expect(winners[0].body.token).to.be.a('string').that.is.not.empty;
  expect(winners[0].body.user.github_username).to.equal(username);
  this.concurrentLosers = this.concurrentResponses.filter((response) => response !== winners[0]);
});

Then('every other one should be answered 400 with the auth error code {string}', function (code) {
  expect(this.concurrentLosers, 'the other responses').to.be.an('array').that.is.not.empty;
  for (const response of this.concurrentLosers) {
    expect(response.status, `answer ${JSON.stringify(response.body)}`).to.equal(400);
    expect(response.body.code).to.equal(code);
  }
});

Then('the session token should work on instance {string}', async function (name) {
  const { token, user } = this.response.body;
  expect(token, 'a session token from the previous response').to.be.a('string').that.is.not.empty;
  const me = await request(instanceNamed(this, name).url).get('/auth/me').set('Authorization', `Bearer ${token}`);
  expect(me.status).to.equal(200);
  expect(me.body.github_username).to.equal(user.github_username);
  expect(me.body.github_id).to.equal(user.github_id);
});

// --- The stored documents ------------------------------------------------------------------------

/** @param {object} world @param {string} which - "state" or "one-time code" @returns {string} raw value */
function rawValue(world, which) {
  const raw = which === 'state' ? world.authState : world.oneTimeCode;
  expect(raw, `a ${which} from an earlier step`).to.be.a('string').that.is.not.empty;
  return raw;
}

Given("MongoDB's TTL monitor is off", async function () {
  await setTtlMonitor(false);
  this.ttlMonitorOff = true; // turned back on by the After hook
});

Given(/^the stored (state|one-time code) expired (\d+) seconds? ago$/, async function (which, seconds) {
  const changed = await expireOneTimeValue(rawValue(this, which), Number(seconds) * 1000);
  expect(changed, `stored ${which} documents changed`).to.equal(1);
});

Then(/^the stored (state|one-time code) should (still be in|be gone from) the database$/, async function (which, where) {
  const doc = await storedOneTimeDoc(rawValue(this, which));
  if (where === 'still be in') {
    expect(doc, `the stored ${which}`).to.not.equal(null);
    expect(doc.kind).to.equal(which === 'state' ? 'state' : 'code');
  } else {
    expect(doc, `the stored ${which}`).to.equal(null);
  }
});

Then(
  /^the stored (state|one-time code) should expire (\d+) seconds after it was issued, by MongoDB's clock$/,
  async function (which, seconds) {
    const doc = await storedOneTimeDoc(rawValue(this, which));
    expect(doc, `the stored ${which}`).to.not.equal(null);
    const lifetimeLeftMs = doc.expiresAt.getTime() - (await mongoNow()).getTime();
    expect(lifetimeLeftMs, 'ms left by MongoDB\'s clock').to.be.at.most(Number(seconds) * 1000);
    expect(lifetimeLeftMs, 'ms left by MongoDB\'s clock').to.be.above(Number(seconds) * 1000 - LIFETIME_SLACK_MS);
  }
);

Then('the database should hold {int} stored state(s) and {int} stored one-time code(s)', async function (states, codes) {
  const docs = await allOneTimeDocs();
  expect(docs.filter((doc) => doc.kind === 'state'), 'stored states').to.have.length(states);
  expect(docs.filter((doc) => doc.kind === 'code'), 'stored one-time codes').to.have.length(codes);
});

Then('each stored sign-in value should be keyed by the sha256 of its raw value', async function () {
  const state = await AuthOneTime.collection.findOne({ _id: storedIdOf(rawValue(this, 'state')) });
  const code = await AuthOneTime.collection.findOne({ _id: storedIdOf(rawValue(this, 'one-time code')) });
  expect(state && state.kind, 'the state, under sha256(state)').to.equal('state');
  expect(code && code.kind, 'the code, under sha256(code)').to.equal('code');
});

/**
 * @param {unknown} value
 * @returns {string[]} every string in a document: keys, values, nested
 */
function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (value instanceof Date || value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  return Object.entries(value).flatMap(([key, inner]) => [key, ...stringsIn(inner)]);
}

Then('no stored sign-in value should contain a raw state, one-time code, PKCE verifier or GitHub access token', async function () {
  const secrets = [...(this.secretsSeen || [])];
  expect(secrets, 'secrets this scenario handled').to.include.members([
    rawValue(this, 'state'), rawValue(this, 'one-time code'), this.pkceVerifier, this.githubAccessToken,
  ]);
  const stored = (await allOneTimeDocs()).flatMap(stringsIn);
  for (const secret of secrets) {
    expect(stored.filter((text) => text.includes(secret)), 'stored strings containing a secret').to.deep.equal([]);
  }
  expect(stored.filter((text) => text.startsWith('gho_')), 'stored GitHub tokens').to.deep.equal([]);
});

Then('the stored one-time code should carry the sign-in of {string} and nothing else', async function (username) {
  const { payload } = await storedOneTimeDoc(rawValue(this, 'one-time code'));
  expect(Object.keys(payload).sort()).to.deep.equal(['codeChallenge', 'githubId', 'githubUsername', 'loginReadAt', 'profile']);
  expect(payload.githubUsername).to.equal(username);
  expect(Object.keys(payload.profile).sort()).to.deep.equal(['avatar_url', 'bio', 'name']);
});

Then(/^the (auth_one_time|rate_limits) collection should have a TTL index on "([^"]*)"$/, async function (collection, field) {
  const model = collection === 'auth_one_time' ? AuthOneTime : RateLimit;
  const ttl = (await indexesOf(model)).filter((index) => index.expireAfterSeconds !== undefined);
  expect(ttl.map((index) => ({ key: index.key, expireAfterSeconds: index.expireAfterSeconds })))
    .to.deep.equal([{ key: { [field]: 1 }, expireAfterSeconds: 0 }]);
});

// --- Rate limits ---------------------------------------------------------------------------------

When('I check my session on instance {string}', async function (name) {
  this.response = await request(instanceNamed(this, name).url)
    .get('/auth/me')
    .set('Authorization', `Bearer ${this.sessionToken}`);
});

When(
  'I update my profile on instance {string} with techs {string}, latitude {string} and longitude {string}',
  async function (name, techs, latitude, longitude) {
    this.response = await request(instanceNamed(this, name).url)
      .put('/devs/me')
      .set('Authorization', `Bearer ${this.sessionToken}`)
      .send({ techs, latitude, longitude });
  }
);

When('the rate limits of instance {string} are reset', async function (name) {
  await instanceNamed(this, name).context.rateLimits.reset();
});

Then('no rate-limit counter should be stored', async function () {
  expect(await allRateLimitDocs()).to.deep.equal([]);
});

Then(/^the stored "([^"]*)" counter should be at (\d+)$/, async function (prefix, hits) {
  const counters = (await allRateLimitDocs()).filter((doc) => doc._id.startsWith(prefix));
  expect(counters.map((doc) => doc.hits), `"${prefix}" counters`).to.deep.equal([Number(hits)]);
});

Then(
  /^the response should be the 429 rate-limit answer for at most (\d+) (sign-in requests|session checks|profile changes)$/,
  function (limit, what) {
    const { status, body, headers } = this.response;
    expect(status).to.equal(429);
    expect(headers['content-type']).to.match(/^application\/json/);
    expect(body).to.deep.equal({
      error: 'Too many requests, try again later',
      code: 'rate_limited',
      details: [`At most ${limit} ${what} per 15 minutes`],
    });
    // express-rate-limit's draft-7 headers, plus Retry-After on a 429; no legacy X-RateLimit-*.
    expect(headers['ratelimit-policy']).to.equal(`${limit};w=${WINDOW_SECONDS}`);
    const match = /^limit=(\d+), remaining=0, reset=(\d+)$/.exec(headers.ratelimit || '');
    expect(match, `RateLimit header "${headers.ratelimit}"`).to.not.equal(null);
    expect(Number(match[1])).to.equal(Number(limit));
    expect(Number(match[2])).to.be.within(1, WINDOW_SECONDS);
    expect(Number(headers['retry-after'])).to.be.within(1, WINDOW_SECONDS);
    expect(Object.keys(headers).filter((name) => name.startsWith('x-ratelimit'))).to.deep.equal([]);
  }
);

// --- Store failures and logs ---------------------------------------------------------------------

Given('the server log is captured', function () {
  this.capturedLog = [];
  for (const method of CONSOLE_METHODS) {
    console[method] = (...args) => {
      this.capturedLog.push(args.map((arg) => (typeof arg === 'string' ? arg : util.inspect(arg, { depth: 5 }))).join(' '));
    };
  }
});

/**
 * Makes the next call of one of a model's collection methods fail like MongoDB would, with a
 * driver message that quotes the document key (as some server messages do). Not a duplicate-key
 * error: the stores retry those once. Restored by After.
 * @param {object} world
 * @param {import('mongoose').Model} model
 * @param {string} method
 */
function failNext(world, model, method) {
  const { collection } = model;
  world.storeFailures = world.storeFailures || [];
  world.storeFailures.push({ collection, method });
  world.failedStoreKeys = world.failedStoreKeys || [];
  collection[method] = async (filter) => {
    delete collection[method];
    world.failedStoreKeys.push(String(filter._id));
    const err = new Error(
      `Executor error during findAndModify :: caused by :: operation exceeded time limit, collection ${collection.name}, filter { _id: "${filter._id}" }`
    );
    err.name = 'MongoServerError';
    err.code = 50;
    err.codeName = 'MaxTimeMSExpired';
    throw err;
  };
}

Given('the shared sign-in store fails at its next consume', function () {
  failNext(this, AuthOneTime, 'findOneAndDelete');
});

Given('the shared rate-limit store fails at its next increment', function () {
  failNext(this, RateLimit, 'findOneAndUpdate');
});

Then('the captured server log should report a failed {string} without its key', function (operation) {
  expect(this.capturedLog, 'log capture should have run').to.be.an('array');
  expect(this.capturedLog.filter((line) => line.includes(`${operation} failed`)), `"${operation} failed" lines`)
    .to.have.length(1);
  expect(this.failedStoreKeys, 'keys the failing store was called with').to.have.length(1);
  const [storedKey] = this.failedStoreKeys;
  // The stored key, and the client key after a rate-limit prefix (e.g. the IP of "sign_in:<ip>").
  const keyParts = [storedKey, storedKey.replace(/^[a-z_]+:/, '')];
  for (const part of keyParts) {
    expect(this.capturedLog.filter((line) => line.includes(part)), `log lines naming "${part}"`).to.deep.equal([]);
  }
});

Then('the captured server log should contain no state, one-time code, PKCE verifier or token of this scenario', function () {
  expect(this.capturedLog, 'log capture should have run').to.be.an('array');
  const secrets = [...(this.secretsSeen || [])];
  expect(secrets.length, 'secrets this scenario handled').to.be.above(3);
  // The raw values, and the stored form of the states and codes.
  const forbidden = [...secrets, ...secrets.map(storedIdOf)];
  for (const text of forbidden) {
    expect(this.capturedLog.filter((line) => line.includes(text)), 'log lines with a secret').to.deep.equal([]);
  }
});

// Full sign-in on one instance (start, callback, token); the token response is kept.
When('{string} signs in on instance {string}', async function (username, name) {
  mockNextGithubSignIn(this, username);
  await startSignIn(this, name);
  expect(this.response.status, 'sign-in start').to.equal(302);
  this.response = noteResponseSecrets(this, await callBackRequest(this, name));
  expect(this.response.status, 'callback').to.equal(302);
  this.oneTimeCode = new URL(this.response.headers.location).searchParams.get('code');
  this.response = noteResponseSecrets(
    this,
    await redeemRequest(this, name, { code: this.oneTimeCode, code_verifier: this.pkceVerifier })
  );
  expect(this.response.status, 'token').to.equal(200);
});
