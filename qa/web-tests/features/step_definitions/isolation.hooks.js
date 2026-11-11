// Every web scenario starts from an empty harness backend, whatever ran before it (BUG-014).
//
// All scenarios share one backend and its database (playwright.config.js, workers: 1), and
// scenarios that do not seed anything used to inherit the previous scenario's developers. Since
// auth slice 5 a leftover profile of the signed-in user changes what the app shows ("Atualizar"
// instead of "Salvar"), so a scenario's result depended on which scenario happened to run before
// it: "The session survives a page reload" failed in every `--grep @regression` run, right after
// a slice 5 review scenario that registers "gaearon", but passed in the full suite, where a
// @smoke scenario that resets ran in between. `Given the backend has ...` steps still reset (and
// seed) explicitly; this hook makes the empty start the default instead of a step to remember.
const { createBdd } = require('playwright-bdd');
const { resetBackend } = require('../support/test-data');

const { Before } = createBdd();

Before(async function () {
  await resetBackend();
});
