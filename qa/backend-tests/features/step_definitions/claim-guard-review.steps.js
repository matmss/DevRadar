// Steps for features/claim-guard-review.feature (QA review of dev/docs/05-claim-guard-spec.md).
// Reuses the request steps of registration/profile.steps.js, the listing steps of
// legacy-merge.steps.js, the log and race steps of claim-guard.steps.js and the ownership
// assertions of ownership.steps.js.
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { expect } = require('chai');
const request = require('supertest');
// The same mongoose (and BSON) as dev/backend, see hooks.js.
const mongoose = require('../../../../dev/backend/node_modules/mongoose');
const Dev = require('../../../../dev/backend/src/models/Dev');
const { testSessionToken } = require('../support/session');

const { Binary } = mongoose.mongo.BSON;
const SEED_LOCATION = { type: 'Point', coordinates: [-46.6333, -23.5505] };
const HOUR_MS = 60 * 60 * 1000;
const BODY = { techs: 'Go', latitude: '-23.5505', longitude: '-46.6333' };

/** @param {number} id @returns {string} */
function avatarOf(id) {
  return `https://avatars.githubusercontent.com/u/${id}?v=4`;
}

/** @param {object} world @param {string} alias @param {unknown} _id */
function rememberAlias(world, alias, _id) {
  world.devIds = { ...(world.devIds || {}), [alias]: String(_id) };
}

/**
 * A legacy dev as the pre-auth backend stored it, with hand-edited fields.
 * @param {object} world
 * @param {string} login
 * @param {object} fields - avatar_url, _id, ...
 */
async function seedLegacy(world, login, fields) {
  const doc = {
    github_username: login,
    name: login,
    bio: 'stored by the pre-auth backend',
    techs: ['Node.js'],
    location: SEED_LOCATION,
    __v: 0,
    ...fields,
  };
  const { insertedId } = await Dev.collection.insertOne(doc);
  rememberAlias(world, login, insertedId);
  world.rawIds = { ...(world.rawIds || {}), [login]: insertedId };
}

/**
 * @param {object} world @param {string} alias
 * @returns {unknown} the stored _id of a dev seeded here or by legacy-merge/claim-guard.steps.js
 */
function rawIdOf(world, alias) {
  if (world.rawIds && world.rawIds[alias] !== undefined) return world.rawIds[alias];
  expect(world.devIds && world.devIds[alias], `no developer was seeded as "${alias}"`).to.be.a('string');
  return new mongoose.mongo.ObjectId(world.devIds[alias]);
}

// --- QA-CG-1: non-string avatars that Mongoose casts to a guarding URL ----------------------

const HAND_EDITED_AVATARS = {
  // A BSON Binary holding the URL's bytes: Mongoose's String cast calls its toString().
  'BSON Binary': (url) => new Binary(Buffer.from(url, 'utf8')),
  // An embedded document whose _id is the URL: Mongoose's String cast takes value._id.
  'embedded _id': (url) => ({ _id: url }),
};

Given(
  /^the legacy developer "([^"]+)" was stored before sign-in with a hand-edited (BSON Binary|embedded _id) avatar_url naming avatar id (\d+)$/,
  async function (login, kind, id) {
    await seedLegacy(this, login, { avatar_url: HAND_EDITED_AVATARS[kind](avatarOf(Number(id))) });
  }
);

When('GitHub account {int} as {string} updates their profile', async function (githubId, login) {
  this.response = await request(this.app)
    .put('/devs/me')
    .set('Authorization', `Bearer ${testSessionToken(login, githubId)}`)
    .send(BODY);
});

// What the operator tool says (claimable_by) must be what the API does: "login" lets whoever
// holds the login claim it, an id lets only that account claim it, "none" lets nobody.
Then(
  'the update should agree with the listing\'s claimable_by for {string} and GitHub account {int}',
  async function (alias, githubId) {
    expect(this.listing, 'a previous step should list the legacy developers').to.be.an('object');
    const entry = this.listing.devs.find((dev) => dev._id === this.devIds[alias]);
    expect(entry, `the listing should include "${alias}"`).to.not.equal(undefined);
    const claimable = entry.claimable_by === 'login' || entry.claimable_by === githubId;
    const { status, body } = this.response;
    expect(status, `PUT answered ${status} ${JSON.stringify(body)}`).to.be.below(500);
    const claimed = status === 200;
    expect(
      claimed,
      `list says claimable_by ${JSON.stringify(entry.claimable_by)}, but account ${githubId}'s PUT answered `
      + `${status} ${JSON.stringify(body)}`
    ).to.equal(claimable);
  }
);

// --- QA-CG-2: retry headroom ----------------------------------------------------------------

const realFindOneAndUpdate = Dev.findOneAndUpdate;
After(function () {
  Dev.findOneAndUpdate = realFindOneAndUpdate;
});

/** @returns {boolean} displace()'s conditional update */
function isDisplacement(update) {
  return Boolean(update && update.$set && update.$set.github_username_stale === true);
}

/** @returns {boolean} createOwnDev's upsert for the account */
function isRegistrationOf(githubId, filter, update) {
  return Boolean(filter && filter.github_id === githubId && update && update.$setOnInsert);
}

// Account 333's own POST /devs with a session read an hour ago (older than mine): it is guarded
// out of the legacy dev too, so it displaces it (write 1, under its own key only, since a legacy
// dev has none) and then registers the freed login (write 2). Each write lands right before my
// request's next conditional write: write 1 before my displacement of the legacy dev, write 2
// before my registration.
Given(
  'GitHub account {int} as {string}, with an older read, displaces {string} and then registers, interleaved with my registration',
  function (otherId, login, alias) {
    const readAt = new Date(Date.now() - HOUR_MS);
    const legacyId = rawIdOf(this, alias);
    let step = 0;
    Dev.findOneAndUpdate = function raced(filter, update, ...rest) {
      if (step === 0 && isDisplacement(update)) {
        step = 1;
        return Dev.collection.updateOne(
          { _id: legacyId, github_id: null, github_username: login },
          { $set: { github_username: `_stale_${legacyId}`, github_username_stale: true, github_username_seen_at: readAt } }
        ).then(() => realFindOneAndUpdate.call(Dev, filter, update, ...rest));
      }
      if (step === 1 && isRegistrationOf(222, filter, update)) {
        step = 2;
        this.raceRan = true;
        Dev.findOneAndUpdate = realFindOneAndUpdate;
        return Dev.collection.insertOne({
          github_id: otherId,
          github_username: login,
          github_username_seen_at: readAt,
          name: login,
          techs: ['Go'],
          location: SEED_LOCATION,
          __v: 0,
        }).then(() => realFindOneAndUpdate.call(Dev, filter, update, ...rest));
      }
      return realFindOneAndUpdate.call(Dev, filter, update, ...rest);
    }.bind(this); // `this` inside is the world
  }
);

// --- QA-CG-3: string _ids -------------------------------------------------------------------

Given(
  'the legacy developer {string} was stored before sign-in with the string _id {string} and avatar id {int}',
  async function (login, _id, id) {
    await seedLegacy(this, login, { _id, avatar_url: avatarOf(id) });
  }
);

// --- QA-CG-4: a stale flag on a real login ----------------------------------------------------

Given('the legacy developer {string} is flagged github_username_stale but still shows its login', async function (alias) {
  const { matchedCount } = await Dev.collection.updateOne({ _id: rawIdOf(this, alias) }, { $set: { github_username_stale: true } });
  expect(matchedCount).to.equal(1);
});


// --- Mutation guards ------------------------------------------------------------------------

/** @returns {boolean} displace()'s conditional update of a legacy dev */
function isLegacyDisplacement(filter, update) {
  return Boolean(filter && filter.github_id === null && isDisplacement(update));
}

Given(
  'the avatar of the legacy developer {string} changes to avatar id {int} just before its displacement',
  function (alias, id) {
    const legacyId = rawIdOf(this, alias);
    Dev.findOneAndUpdate = function raced(filter, update, ...rest) {
      if (!isLegacyDisplacement(filter, update)) return realFindOneAndUpdate.call(Dev, filter, update, ...rest);
      Dev.findOneAndUpdate = realFindOneAndUpdate;
      this.raceRan = true;
      return Dev.collection.updateOne({ _id: legacyId }, { $set: { avatar_url: avatarOf(id) } })
        .then(() => realFindOneAndUpdate.call(Dev, filter, update, ...rest));
    }.bind(this); // `this` inside is the world
  }
);

Then('every guard warning should say {string}', function (what) {
  expect(this.logLines, 'a previous step should record the log').to.be.an('array');
  this.logLines
    .filter(({ level, text }) => level === 'warn' && text.startsWith('Legacy developer '))
    .forEach(({ text }) => expect(text).to.include(`Legacy developer ${what}:`));
});

Then(
  'the listing entry for {string} should have claimable_by equal to its avatar_id, the number {int}',
  function (alias, id) {
    const entry = this.listing.devs.find((dev) => dev._id === this.devIds[alias]);
    expect(entry, `the listing should include "${alias}"`).to.not.equal(undefined);
    expect(entry.avatar_id).to.equal(id);
    expect(entry.claimable_by).to.equal(id);
  }
);
