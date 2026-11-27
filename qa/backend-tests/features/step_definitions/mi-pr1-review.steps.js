// Steps for features/mi-pr1-review.feature (QA review of multi-instance PR1). Reuses
// shared-auth.steps.js (log capture, its After hook restoring store failures and the console),
// multi-instance.steps.js and auth.steps.js (clock, its After hook restoring Date.now).
const { When, Then } = require('@cucumber/cucumber');
const { expect } = require('chai');
const { CLIENT_REDIRECT } = require('../support/instances');
const { AuthOneTime, storedIdOf } = require('../support/shared-state');

// --- QA-MI1-1: a failing one-time store write at the callback ----------------------------------

/**
 * Makes the next call of `AuthOneTime.collection.updateOne` (the store's insert-only issue) fail
 * like a server error would. Registered in world.storeFailures, which shared-auth.steps.js's After
 * hook deletes, so the collection's own method comes back.
 */
When('the shared sign-in store fails at its next issue', function () {
  const { collection } = AuthOneTime;
  this.storeFailures = this.storeFailures || [];
  this.storeFailures.push({ collection, method: 'updateOne' });
  collection.updateOne = async () => {
    delete collection.updateOne;
    const err = new Error('Executor error during update :: caused by :: operation exceeded time limit');
    err.name = 'MongoServerError';
    err.code = 50;
    err.codeName = 'MaxTimeMSExpired';
    throw err;
  };
});

Then(
  'the browser should be sent back to the client with error {string} and no one-time code',
  function (error) {
    const { status, headers, body } = this.response;
    expect(status, `callback answer ${JSON.stringify(body)}`).to.equal(302);
    const location = new URL(headers.location);
    expect(`${location.origin}${location.pathname}`).to.equal(CLIENT_REDIRECT);
    expect(location.searchParams.get('error')).to.equal(error);
    expect(location.searchParams.get('reason'), 'a reason code').to.match(/^[a-z_]+$/);
    expect(location.searchParams.get('code'), 'no one-time code').to.equal(null);
  }
);

// shared-auth.steps.js's log check wants more than 3 secrets; a callback that fails before the
// code exists has exactly 3 (state, PKCE verifier, GitHub access token).
Then('the captured server log should name none of the state, PKCE verifier or GitHub token', async function () {
  expect(this.capturedLog, 'log capture should have run').to.be.an('array');
  // Express's final handler may log after the response was sent (setImmediate).
  await new Promise((resolve) => setImmediate(resolve));
  const secrets = [this.authState, this.pkceVerifier, this.githubAccessToken];
  for (const secret of secrets) expect(secret, 'a secret of this scenario').to.be.a('string').that.is.not.empty;
  const forbidden = [...secrets, storedIdOf(this.authState)];
  for (const text of forbidden) {
    expect(this.capturedLog.filter((line) => line.includes(text)), 'log lines with a secret').to.deep.equal([]);
  }
});

// --- QA-MI1-2: rate-limit headers vs the instance's clock --------------------------------------

// An instance whose clock is off from MongoDB's. auth.steps.js's After hook restores Date.now.
When(/^the server clock runs (\d+) seconds (ahead of|behind) MongoDB's$/, function (seconds, direction) {
  const current = Date.now;
  const offset = Number(seconds) * 1000 * (direction === 'ahead of' ? 1 : -1);
  Date.now = () => current() + offset;
});

Then('the rate-limit headers should say the window ends in about {int} seconds', function (seconds) {
  const { headers } = this.response;
  const match = /^limit=\d+, remaining=\d+, reset=(\d+)$/.exec(headers.ratelimit || '');
  expect(match, `RateLimit header "${headers.ratelimit}"`).to.not.equal(null);
  const slack = 10;
  expect(Number(match[1]), 'RateLimit reset (s)').to.be.within(seconds - slack, seconds);
  expect(Number(headers['retry-after']), 'Retry-After (s)').to.be.within(seconds - slack, seconds);
});
