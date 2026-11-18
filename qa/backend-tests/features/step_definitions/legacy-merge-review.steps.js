// Steps for features/legacy-merge-review.feature (QA review of the legacy-devs operator tool,
// dev/docs/04-legacy-merge-spec.md). The operator commands, snapshots and outcome steps are DEV's
// (legacy-merge.steps.js); these only seed data the pre-auth API could not have written (hand
// edits, seed data), check the printed output character by character, and back the guard
// scenarios that close mutation gaps in the delivery's own suite.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Given, Then, After } = require('@cucumber/cucumber');
const { expect } = require('chai');
// The same mongoose (and BSON) as dev/backend, see hooks.js.
const mongoose = require('../../../../dev/backend/node_modules/mongoose');
const Dev = require('../../../../dev/backend/src/models/Dev');

const { EJSON } = mongoose.mongo.BSON;

const SEED_LOCATION = { type: 'Point', coordinates: [-46.6333, -23.5505] };

// Special characters are built from code points, never written literally or as escapes here.
const NAMED_CHARACTERS = {
  ESC: String.fromCodePoint(0x1b),
  BEL: String.fromCodePoint(0x07),
  RLO: String.fromCodePoint(0x202e),
};

/** @param {string} text @returns {string} "<ESC>", "<BEL>", "<RLO>" replaced by the characters */
function withNamedCharacters(text) {
  return text.replace(/<(ESC|BEL|RLO)>/g, (_match, name) => NAMED_CHARACTERS[name]);
}

/** Same alias map as legacy-merge.steps.js, so its "<alias>" placeholders and steps find the dev. */
function rememberAlias(world, alias, _id) {
  world.devIds = { ...(world.devIds || {}), [alias]: String(_id) };
}

/**
 * Same rule as escapeUnsafe in scripts/lib/legacyDevs.js (C0/C1 controls except the newline
 * that separates lines, U+2028/2029, and the bidi controls).
 * @param {number} codePoint
 * @returns {boolean}
 */
function isUnsafe(codePoint) {
  return (codePoint < 0x20 && codePoint !== 0x0a)
    || (codePoint >= 0x7f && codePoint <= 0x9f)
    || codePoint === 0x061c
    || codePoint === 0x200e || codePoint === 0x200f
    || codePoint === 0x2028 || codePoint === 0x2029
    || (codePoint >= 0x202a && codePoint <= 0x202e)
    || (codePoint >= 0x2066 && codePoint <= 0x2069);
}

Given(
  'a legacy developer with the raw _id {string} and login {string} and avatar {string}',
  async function (rawId, login, avatarUrl) {
    const _id = withNamedCharacters(rawId);
    await Dev.collection.insertOne({
      _id, github_username: login, name: login, avatar_url: avatarUrl, techs: ['Node.js'], location: SEED_LOCATION, __v: 0,
    });
    rememberAlias(this, login, _id);
  }
);

Given(
  'a developer with the raw _id {string} owned by GitHub account {int} as {string}',
  async function (rawId, githubId, login) {
    const _id = withNamedCharacters(rawId);
    await Dev.collection.insertOne({
      _id,
      github_id: githubId,
      github_username: login,
      github_username_seen_at: new Date(),
      name: login,
      techs: ['Go'],
      location: SEED_LOCATION,
      __v: 0,
    });
    rememberAlias(this, login, _id);
  }
);

// {raw} is a JSON value: 0, -1, 1.5, false, "501" (a string).
Given('a developer {string} with the raw github_id {word} already exists', async function (login, rawJson) {
  const githubId = JSON.parse(rawJson);
  const { insertedId } = await Dev.collection.insertOne({
    github_id: githubId,
    github_username: login,
    github_username_seen_at: new Date(),
    name: login,
    avatar_url: 'https://avatars.githubusercontent.com/u/501?v=4',
    techs: ['Go'],
    location: SEED_LOCATION,
    __v: 0,
  });
  const stored = await Dev.collection.findOne({ _id: insertedId });
  expect(stored.github_id, 'the raw github_id should be stored as given').to.deep.equal(githubId);
  rememberAlias(this, login, insertedId);
});

Then('the output should mention {string}', function (text) {
  expect(this.cli.output).to.include(text);
});

Then('the output should contain no raw control or bidi characters', function () {
  const found = [];
  for (const char of this.cli.output) {
    const codePoint = char.codePointAt(0);
    if (isUnsafe(codePoint)) found.push(`U+${codePoint.toString(16).padStart(4, '0').toUpperCase()}`);
  }
  const lines = this.cli.output.split('\n')
    .filter((line) => [...line].some((char) => isUnsafe(char.codePointAt(0))))
    .map((line) => JSON.stringify(line));
  expect(found, `raw characters in these lines:\n${lines.join('\n')}`).to.deep.equal([]);
});

// --- Guards for the delivery's safety claims ----------------------------------------------------

Given(
  'a legacy developer {string} whose login, name, bio and techs hold control and bidi characters, with avatar {string}',
  async function (alias, avatarUrl) {
    const cp = (codePoint) => String.fromCodePoint(codePoint);
    // ESC sequence, BEL, a C1 CSI, RLO, LRI, ALM, line separator, plus ordinary non-ASCII text.
    const odd = `x${cp(0x1b)}[31m${cp(0x07)}${cp(0x9b)}2J${cp(0x202e)}${cp(0x2066)}${cp(0x061c)}${cp(0x2028)}é東`;
    const { insertedId } = await Dev.collection.insertOne({
      github_username: `odd${odd}`,
      name: `name${odd}`,
      bio: `bio${odd}`,
      avatar_url: avatarUrl,
      techs: [`Node${odd}`, 'Go'],
      location: SEED_LOCATION,
      __v: 0,
    });
    rememberAlias(this, alias, insertedId);
  }
);

Given(
  'a recovery record file for a developer owned by GitHub account {int} as {string}',
  function (githubId, login) {
    const record = {
      _id: new mongoose.mongo.ObjectId(),
      github_id: githubId,
      github_username: login,
      name: login,
      techs: ['Go'],
      location: SEED_LOCATION,
      __v: 0,
    };
    // The cleanup After hook of legacy-merge.steps.js removes this directory.
    this.recoveryFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devradar-legacy-qa-')), 'record.json');
    fs.writeFileSync(this.recoveryFile, `${EJSON.stringify(record, { relaxed: false })}\n`);
  }
);

Given('the developers collection has lost its unique login index', async function () {
  await Dev.collection.dropIndex('github_username_unique_ci');
  this.qaDroppedIndexes = true;
});

After(async function () {
  if (this.qaDroppedIndexes) await Dev.syncIndexes();
});

Then('the github_id_unique index should still be missing', async function () {
  // A mongoose connection with autoIndex on starts building the schema's indexes when it opens;
  // give a build the process may have started a moment to show up.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const names = (await Dev.collection.indexes()).map((index) => index.name);
  expect(names).to.not.include('github_id_unique');
});
