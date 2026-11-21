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

/**
 * Changes the legacy dev's stored avatar_url right before the next legacy displacement write.
 * @param {object} world @param {string} alias @param {unknown} avatarUrl
 */
function changeAvatarBeforeDisplacement(world, alias, avatarUrl) {
  const legacyId = rawIdOf(world, alias);
  Dev.findOneAndUpdate = (filter, update, ...rest) => {
    if (!isLegacyDisplacement(filter, update)) return realFindOneAndUpdate.call(Dev, filter, update, ...rest);
    Dev.findOneAndUpdate = realFindOneAndUpdate;
    world.raceRan = true;
    return Dev.collection.updateOne({ _id: legacyId }, { $set: { avatar_url: avatarUrl } })
      .then(() => realFindOneAndUpdate.call(Dev, filter, update, ...rest));
  };
}

Given(
  'the avatar of the legacy developer {string} changes to avatar id {int} just before its displacement',
  function (alias, id) {
    changeAvatarBeforeDisplacement(this, alias, avatarOf(id));
  }
);

Given(
  /^the avatar of the legacy developer "([^"]+)" changes to a hand-edited (BSON Binary|embedded _id) avatar_url naming avatar id (\d+) just before its displacement$/,
  function (alias, kind, id) {
    changeAvatarBeforeDisplacement(this, alias, HAND_EDITED_AVATARS[kind](avatarOf(Number(id))));
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

/** @param {number} githubId @param {string} login @param {Date} seenAt @returns {object} an owned dev */
function ownedDev(githubId, login, seenAt) {
  return {
    github_id: githubId,
    github_username: login,
    github_username_seen_at: seenAt,
    name: login,
    techs: ['Go'],
    location: SEED_LOCATION,
    __v: 0,
  };
}

// After every successful displacement, the next older holder (accounts 1001, 1002, ...) takes the
// freed login. Stops after 30, so a run without a cap ends too (and fails on the count).
Given(
  'the developer {string} owned by GitHub account {int} with an older login state is replaced by another older holder after every displacement',
  async function (login, firstId) {
    const seenAt = new Date(Date.now() - HOUR_MS);
    await Dev.collection.insertOne(ownedDev(firstId, login, seenAt));
    let next = firstId + 1;
    Dev.findOneAndUpdate = function raced(filter, update, ...rest) {
      const write = realFindOneAndUpdate.call(Dev, filter, update, ...rest);
      if (!isDisplacement(update) || next > firstId + 30) return write;
      return Promise.resolve(write).then(async (displaced) => {
        if (displaced) {
          await Dev.collection.insertOne(ownedDev(next, login, seenAt));
          next += 1;
        }
        return displaced;
      });
    };
  }
);

Then('at most {int} developers should have been displaced', async function (count) {
  const displaced = await Dev.collection.countDocuments({ github_username_stale: true });
  expect(displaced).to.be.at.least(1);
  expect(displaced).to.be.at.most(count);
});

// A 100-character string _id: a newline, an ESC colour code, a NUL and U+2028 in its first 20
// characters (built from code points, never escapes in this file), then "x" padding.
Given(
  'the legacy developer {string} was stored before sign-in with a {int}-character string _id holding control characters and avatar id {int}',
  async function (login, length, id) {
    const special = [0x0a, 0x1b, 0x00, 0x2028].map((code) => String.fromCodePoint(code));
    const head = `id${special[0]}a${special[1]}[31mred${special[2]}b${special[3]}c`;
    const _id = head + 'x'.repeat(length - head.length);
    expect(_id).to.have.lengthOf(length);
    this.oddId = _id;
    await seedLegacy(this, login, { _id, avatar_url: avatarOf(id) });
  }
);

Then(
  'the guard warning should name the first 64 characters of that _id with each non-printable character as {string}',
  function (replacement) {
    const expected = [...this.oddId].map((ch) => {
      const code = ch.codePointAt(0);
      return code >= 0x20 && code <= 0x7e ? ch : replacement;
    }).join('').slice(0, 64);
    const warnings = this.logLines.filter(({ level, text }) => level === 'warn' && text.startsWith('Legacy developer '));
    expect(warnings, JSON.stringify(warnings)).to.have.lengthOf(1);
    expect(warnings[0].text).to.include(`(dev ${expected}, login alice,`);
    [...warnings[0].text].forEach((ch) => {
      const code = ch.codePointAt(0);
      expect(code >= 0x20 && code <= 0x7e, `character U+${code.toString(16)} in the log line`).to.equal(true);
    });
  }
);
