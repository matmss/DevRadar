// Steps for features/auth-review.feature (QA review of auth slice 1). Shared steps (sign-in,
// callback, status, token assertions) come from auth.steps.js and the other step files.
const crypto = require('crypto');
const { When, Then, After } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

/** RFC 7636 S256: BASE64URL(SHA256(ascii(code_verifier))). */
function s256(verifier) {
  return crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

function codeFromLocation(response) {
  const { location } = response.headers;
  return location ? new URL(location).searchParams.get('code') : null;
}

// console.error capture, so a scenario can assert what the server logged. Always restored.
const realConsoleError = console.error;
let capturedLog = null;

function startCapturingLog() {
  capturedLog = [];
  console.error = (...args) => {
    capturedLog.push(args.map((arg) => (typeof arg === 'string' ? arg : require('util').inspect(arg))).join(' '));
  };
}

After(function () {
  console.error = realConsoleError;
  capturedLog = null;
});

When(
  'I start GitHub sign-in with redirect {string} and a PKCE challenge for verifier {string}',
  async function (redirect, verifier) {
    this.response = await request(this.app)
      .get('/auth/github')
      .query({ redirect, code_challenge: s256(verifier), code_challenge_method: 'S256' });
    expect(this.response.status, 'sign-in start should redirect to GitHub').to.equal(302);
    const location = this.response.headers.location;
    expect(location.startsWith(AUTHORIZE_URL)).to.equal(true);
    this.authState = new URL(location).searchParams.get('state');
  }
);

When('I exchange the one-time code with PKCE verifier {string}', async function (verifier) {
  const code = codeFromLocation(this.response);
  expect(code, 'the callback should have issued a one-time code').to.be.a('string').that.is.not.empty;
  const body = verifier === '' ? { code } : { code, code_verifier: verifier };
  this.response = await request(this.app).post('/auth/token').send(body);
});

When('I send a {word} request to {string}', async function (method, path) {
  this.response = await request(this.app)[method.toLowerCase()](path);
});

When('I send the raw token request body {string}', async function (body) {
  this.response = await request(this.app).post('/auth/token').set('Content-Type', 'application/json').send(body);
});

When('I send the raw token request body an oversized JSON payload', async function () {
  const body = JSON.stringify({ code: 'a'.repeat(200 * 1024) }); // express.json() limit is 100kb
  this.response = await request(this.app).post('/auth/token').set('Content-Type', 'application/json').send(body);
});

When('I send a malformed token request containing the one-time code', async function () {
  expect(this.oneTimeCode).to.be.a('string').that.is.not.empty;
  startCapturingLog();
  // A trailing comma: a plausible client bug, and the code inside is still valid for ~60 s.
  this.response = await request(this.app)
    .post('/auth/token')
    .set('Content-Type', 'application/json')
    .send(`{"code":"${this.oneTimeCode}",}`);
  // Express's finalhandler defers its error logger with setImmediate, i.e. after the response
  // is sent; wait for it before restoring console.error, or the capture misses the log line.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 20));
  console.error = realConsoleError;
});

Then('the response should be a JSON error with details and no stack trace', function () {
  expect(this.response.headers['content-type'], 'error body should be JSON').to.match(/^application\/json/);
  expect(this.response.body.error).to.be.a('string').that.is.not.empty;
  expect(this.response.body.details).to.be.an('array');
  expect(this.response.text).to.not.match(/SyntaxError|PayloadTooLargeError|\bat [\w.<>]+ \(|node_modules/);
});

Then('the server log should not contain the one-time code', function () {
  expect(capturedLog, 'log capture should have run').to.be.an('array');
  const leaked = capturedLog.filter((line) => line.includes(this.oneTimeCode));
  expect(leaked, 'the one-time code was written to the server log').to.deep.equal([]);
});
