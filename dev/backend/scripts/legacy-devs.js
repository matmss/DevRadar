#!/usr/bin/env node
// Operator CLI for legacy and displaced developer profiles (dev/docs/04-legacy-merge-spec.md,
// option A): list them, assign one to its owner's GitHub account, or merge one into the owner's
// current profile. Run from dev/backend:
//
//   node scripts/legacy-devs.js help
//   node scripts/legacy-devs.js list
//   node scripts/legacy-devs.js assign <dev _id> --github-id <id> [--force] [--apply]
//   node scripts/legacy-devs.js merge <legacy dev _id> --into <dev _id> [--force] [--apply]
//   node scripts/legacy-devs.js restore <file> [--apply]
//
// Dry run unless --apply. Connects with MONGO_URI from the environment, else from
// dev/backend/.env (like the server; there is deliberately no option for it), and prints only
// its hosts and database name. Makes no other network call (no GitHub API) and sends no
// Socket.io event: connected clients see a change on their next search, reload or reconnect.
// The commands are in scripts/lib/legacyDevs.js; the runbook is in dev/docs/00-architecture.md.
const path = require('path');

// An explicit path, so it works from any directory; variables already set win (dotenv default).
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const mongoose = require('mongoose');
const { EXIT, HELP, parseArgs, isJsonListing, run } = require('./lib/legacyDevs');
const { formatMongoTarget, redactMongoUri } = require('./lib/mongoTarget');

const out = {
  log: (line) => process.stdout.write(`${line}\n`),
  error: (line) => process.stderr.write(`${line}\n`),
};

/**
 * @param {string[]} argv - the arguments after the script name
 * @returns {Promise<number>} the exit code
 */
async function main(argv) {
  // Usage errors and help need no database.
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    out.error(err.message);
    out.error('Run "node scripts/legacy-devs.js help" for usage.');
    return EXIT.USAGE;
  }
  if (parsed.command === 'help') {
    out.log(HELP);
    return EXIT.OK;
  }

  const uri = process.env.MONGO_URI;
  if (!uri) {
    out.error('Missing MONGO_URI: set it in the environment or in dev/backend/.env (see .env.example).');
    return EXIT.USAGE;
  }
  // With list --json, stdout is only the JSON; the target goes to stderr.
  (isJsonListing(parsed) ? out.error : out.log)(`MongoDB: ${formatMongoTarget(uri)}`);

  try {
    // autoIndex/autoCreate off: this tool never creates a collection or builds an index (the API
    // does that at startup); it checks the indexes it relies on instead.
    await mongoose.connect(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
    return await run(argv, out);
  } catch (err) {
    out.error(`Failed: ${redactMongoUri(err && err.message ? err.message : String(err), uri)}`);
    return EXIT.FAILED;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.exitCode = EXIT.FAILED;
  }
);
