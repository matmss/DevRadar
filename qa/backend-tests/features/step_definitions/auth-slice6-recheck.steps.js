// Steps for features/auth-slice6-recheck.feature (QA re-check of the auth slice 6 fixes). Reuses
// the ownership, registration, profile, auth and auth-slice6-review steps.
const { Given, When, After } = require('@cucumber/cucumber');
const { expect } = require('chai');

Given('I keep this session as {string}', function (label) {
  expect(this.sessionToken, 'a previous step should sign in').to.be.a('string').that.is.not.empty;
  this.keptSessions = { ...(this.keptSessions || {}), [label]: this.sessionToken };
});

When('I use the session kept as {string}', function (label) {
  const token = this.keptSessions && this.keptSessions[label];
  expect(token, `a session kept as "${label}"`).to.be.a('string').that.is.not.empty;
  this.sessionToken = token;
});

// Moves Date.now() back. auth.steps.js's After hook restores the real Date.now after every
// scenario (captured at load time); this hook does too, in case hook order changes.
const realDateNow = Date.now;
After(function () {
  Date.now = realDateNow;
});

When('the server clock steps back by {int} ms', function (ms) {
  const current = Date.now;
  Date.now = () => current() - ms;
});
