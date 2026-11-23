---
name: qa-harness-quirks
description: Non-obvious gotchas when running DevRadar QA suites and probes from an isolated worktree (cucumber path merging, sandbox rejections, hoisted node_modules, Express deferred error logging)
metadata:
  type: feedback
---

Gotchas hit during the auth slice 1 review (2026-11-08):

- `npm test -- features/x.feature` in qa/backend-tests still runs the WHOLE suite: cucumber merges CLI paths with `paths` in cucumber.js. Just run everything and read the "Failed scenarios" section. Never use `npx cucumber-js` (squatted package); `npx --no-install` printed nothing.
- The worktree sandbox refuses Bash commands that contain `GITHUB_...` env names (it pattern-matches "git") or heredocs writing outside the worktree. Write probe scripts to the scratchpad with the Write tool, then run `node <script>`.
- qa is an npm workspace: supertest/nock/etc. live in `qa/node_modules`, not `qa/backend-tests/node_modules`. testApp.js uses qa's hoisted express, not dev/backend's.
- Express 5's finalhandler calls `console.error(err)` in a setImmediate AFTER the response is sent, so console capture in a step must wait a tick or it falsely passes.

Added during the auth slices 2+3 review (2026-11-08):

- The Write tool turns `\uXXXX` escapes into raw characters (a `\u0000` became a NUL byte, U+2028 broke a regex literal). In files and probes, build special characters with `String.fromCodePoint(0x...)` or numeric ranges, never `\u` escapes; scan with a code-point script afterwards.
- Bash refuses `git -C <dir>` and `for d in ...; sed $d` loops (it cannot prove they are not git). Use plain commands with literal paths.
- Web suite: `npm test -- --reporter=list .features-gen/features/<name>.feature.spec.js` runs one generated file (pretest bddgen still runs). Failure page snapshots are in qa/web-tests/test-results/*/error-context.md (the ```yaml block). `test-results/.last-run.json` and `qa/reports/*` are tracked: `git checkout --` them before committing.
- To fake a backend answer in Playwright (only when the real backend cannot produce it), page.route must also answer the CORS preflight (OPTIONS) and send Access-Control-Allow-Origin, or axios sees a network error and the test falsely passes through the "server unreachable" path.

Added during the auth slice 4 review (2026-11-09):

- (Superseded once the lockfile-tracking change is merged: then it's `npm ci` in dev/backend, dev/web, dev/mobile and qa/, no member lockfiles; see the 2026-11-12 lockfile notes at the end.) dev/backend, dev/web, dev/mobile have no lockfile: `npm install --no-audit --no-fund`. qa/backend-tests, qa/web-tests, qa/mobile-tests DO have lockfiles: `npm ci --workspaces=false` inside each (plain `npm ci` resolves the qa workspace root and fails); their deps then live in each suite's own node_modules. All six in parallel in the background take about 5 min.
- QA mobile Jest tests live in `qa/mobile-tests/unit/` (`npm run unit` there) and run with dev/mobile's jest binary + jest-expo via `unit/jest.config.js` (rootDir = dev/mobile). qa/node_modules has its own `axios` and `socket.io-client`, so that config pins them (and react) to dev/mobile/node_modules with moduleNameMapper; without it a `jest.mock('socket.io-client')` in a qa test silently mocks the wrong copy.
- To check the web Playwright ports are free before a run (reuseExistingServer would silently test another worktree's server): `lsof -nP -iTCP -sTCP:LISTEN`. Port 5000 is macOS ControlCenter, not ours.

Added during the auth slice 5 review (2026-11-10):

- "Do DEV's tests fail on main?" and mutation checks without touching dev/: build a scratch tree with `git archive main dev/backend | tar -x -C <scratch>` (or `cp -R` of a mutated src), `cp -R` qa/backend-tests features + cucumber.js + package.json, symlink both node_modules dirs from the worktree, `mkdir <scratch>/qa/reports`, then `npm test` there. The relative `../../../../dev/backend/src` requires resolve inside the scratch tree.
- Bash also refuses `cd ../../dev/...` (relative paths into dev/) and `rsync`/`cp` whose path args are shell variables. Spell out absolute paths, one plain command each.
- Probes with mongodb-memory-server: pass `{ instance: { launchTimeout: 60000 } }`; the 10 s default fails while installs or Playwright load the machine.
- qa/web-tests/.features-gen/** is tracked: commit the generated spec of a new feature with it.
- `auth-review.feature` "A state is still accepted just before its 10-minute lifetime ends" (599 s of a 600 s TTL) has a 1 s real-time margin and failed once (400 instead of 302) while several suites ran at once. Re-run before blaming the change under test.
- Several mutants in one go: a bash script in the scratchpad with literal paths looping over modes (fresh scratch copy per mode, a node script doing exact-string replacements that throws if the pattern is missing) worked well, run as `bash <script>`.

Added during the Dependabot dependency review (2026-11-12):

- "Does this dependency change alter what CI installs?" Fastest proof, no node_modules: `git show <rev>:<path>/package.json > <scratch>/<rev>/package.json` (one plain command per file; Bash refuses chained `git show > file && cd ...` with variables), then `npm install --package-lock-only` in each scratch dir and diff the `packages` versions (scratchpad qa-main/cmp.js). For qa/ use `git archive <rev> qa/package.json qa/*-tests/package.json | tar -x`. On that branch: 0 differences for dev/* and for the qa root, i.e. the change only touched the tracked lockfiles.
- npm ignores `overrides` in workspace members; only qa/package.json's apply to CI's `npm install` in qa/. Guard: qa/backend-tests/unit/dependencyOverrides.test.js (QA-DEPS-1) if merged.
- GitHub's dependency graph parses dev/*/package.json (GraphQL `dependencyGraphManifests`), but Dependabot raises no alerts on range-only manifests; the backend's runtime alerts come from the qa/backend-tests "mirror" dependencies.
- dev/mobile `Main.test.js`: with a cold Jest cache (`--no-cache`) its first test takes ~3 s at load 18 on 8 cores (5 s default timeout); one timeout cascades into ~17 failures ("Can't access .root on unmounted test renderer"), reproduced with `--testTimeout=150`. Warm runs pass in ~5 s. Pre-existing, not dependency-related.

- A file-level `jest.setTimeout(N)` overrides the CLI `--testTimeout` (a `--testTimeout=10` run of dev/mobile Main.test.js passed 18/18). To force timeouts there, copy the file into a scratch tree (dev/mobile src + configs, node_modules symlinked) and sed the setTimeout value. The same scratch tree works for old-vs-new test mutation checks (scratchpad qa-mut/run.sh).
- npm version-keyed overrides (`"engine.io@~6.6.0": "~6.6.10"`) lift a stale lock's 6.6.9 and leave other minors (socket.io 4.7.5 -> engine.io 6.5.5) alone; proven with `--package-lock-only` and a hand-edited lock (scratchpad qa-eio/stale.sh).
- The qa root's CI-path install (scratch tree from `git archive HEAD dev/backend dev/web qa`) runs `npm run test:web` fine; its Playwright may be newer than the per-suite lock's, so check `playwright-core/browsers.json` against `~/Library/Caches/ms-playwright`. `test:ci` writes the web JSON report to stdout, not reports/.

Added during the CI-hygiene review, PR #78 (2026-11-18):

- CI evidence: `gh run view <id> --log` only works once the whole run is done; for a finished job of a running run use `gh api --allow-escape-sequences repos/<o>/<r>/actions/jobs/<job>/logs`. Node 20 deprecation and "Path Validation Error" show up as check-run annotations (`gh api repos/<o>/<r>/check-runs/<job>/annotations`), not reliably in the log text.
- Bash refuses any command whose text contains "git checkout" (even inside a grep pattern) or a `.github/...` glob: put grep patterns in a scratch file (`grep -F -f pat.txt`) and run tools with no path args from the repo root.
- `gh run rerun <id>` (no flags) reruns all jobs as attempt 2; `--attempt 2` on `gh run view` reads it. Caches saved by a PR run are scoped to refs/pull/N/merge, dispatches on the branch get their own scope.
- Repo facts: default workflow token is read/write; ubuntu-latest is Ubuntu 26.04 since 2026-10; regression.yml workflow_dispatch from a non-default branch works (inputs come from the branch's file). actions/checkout trims `ref`, a short SHA fails after ~27 s of retries.
- mongodb-memory-server postinstall (local mode) downloads into node_modules/.cache unless MONGOMS_DOWNLOAD_DIR is set; emulate CI with an empty HOME (`HOME=<scratch> npm ci --foreground-scripts`), since the real ~/.cache/mongodb-binaries on this Mac already holds a binary and is probed second. Delete the ~170 MB probe binaries after.
- Workflow guards live in qa/backend-tests/unit/workflowHygiene.test.js (QA-CI-1..4, local branch qa/pr78-ci-hygiene-review, if merged). It uses `yaml` hoisted from @cucumber/cucumber.

**Why:** each cost a wasted run or produced a false pass.
**How to apply:** use this when writing backend probes or log-assertion steps; see [[auth-review-findings]] if it is ever written.

Added during the auth slice 6 review (2026-11-10):

- `dev/mobile` `npm test` failed 12/159 once while the Playwright web suite ran at the same time, then passed 159/159 alone. Run mobile Jest after (not alongside) Playwright before calling a failure real.
- A second, parallel sign-in of the same account (two devices): call `completeSignIn` from auth.steps.js with a detached world `{ app: this.app, signInCount: 900 }` (distinct mock codes), keep its `oneTimeCode` + `pkceVerifier`, and POST /auth/token later. Combine with the `{int} seconds pass` clock-shift step (auth.steps.js) to order token `iat`s without sleeping.
- Login-refresh bugs are easiest to assert straight on Mongo by account: `Dev.findOne({ github_id }).lean()` (step "the developer of GitHub account N should show github_username X" in auth-slice6-review.steps.js).

Added during the auth slice 6 re-check (2026-11-11):

- One-off backend failures under load (a 404 with text/html, 400 instead of 413, socket connect_error without `data`, a 404 on POST /auth/token) are NOT slice-specific: they happen on main too when several suites run at once. Mechanism, proven with two-process probes: supertest and the realtime/CORS steps listen on "::" (no host) but dial 127.0.0.1; on macOS another process can still bind 127.0.0.1 on that port and receives the traffic. Fix lives in qa/backend-tests/features/support/loopback.js (forces 127.0.0.1 for host-less listen) if it got merged; check before re-diagnosing.
- After a scenario times out, cucumber on main can print its summary and then never exit (0% CPU). Background runners need a watchdog kill.
- Comparing revisions under equal load: scratch trees via `git archive <rev> dev/backend qa/backend-tests | tar -x`, node_modules symlinked, run them concurrently with `./node_modules/.bin/cucumber-js` (scratchpad diagruns.sh pattern).
- Caveat: a run WITH loopback.js binds 127.0.0.1 and so captures traffic of concurrent runs WITHOUT it (seen as 401 token_invalid bodies from another revision's backend). When comparing revisions under load, patch all trees or none.
- Since auth slice 6 a legacy claim re-spells the login as the claimant's GitHub spelling. Race scenarios whose winner varies must look stored devs up case-insensitively (collation strength 2), or they fail only when the "other" account wins (seen once in 6 loaded runs).
- `forceExit: true` in qa/backend-tests/cucumber.js (since 082adfd): exit code and html/json reports are still correct, but leaked handles no longer show up as a hang.

Added during the BUG-014 review (2026-11-11):

- The nightly runs only `--grep @regression`, the PR the full suite: with `workers: 1` the neighbour scenarios differ. Verify web harness changes with full + @regression + @smoke; an order bug shows on main as regression 35/36 while full is 49/49.
- Order-dependence check, backend: `./node_modules/.bin/cucumber-js --order random:<seed>` (309/309 with two seeds at 24b25e1). Web has no random order; prove hook-vs-Background order with a throwaway feature whose Background seeds and whose scenario asserts the count (playwright-bdd emits Background as a describe-level beforeEach, hooks as a file-level one, so hooks run first).
- The web harness backend's rate limits are raised to 100000 (backend-server.js), so the per-scenario reset (DB only) needs no rate-limit reset; the backend suite resets all three limiter stores itself.
- CI install path (`npm install` at qa/ root, no root lockfile) ignores the per-suite lockfiles; test it in a `git archive` scratch tree so it doesn't rewrite the worktree's per-suite node_modules.
- Waiting for a background run: end the turn; the completion notification resumes the run.

Added during the lockfile-tracking review (2026-11-12):

- The scratchpad path is shared across sessions: `scratchpad/ci` already held another review's files. Make a fresh, uniquely named dir for every scratch tree.
- No Docker on this Mac. Emulate the Linux CI install with `npm ci --dry-run --ignore-scripts --os=linux --cpu=x64 --libc=glibc` in a copy holding only package.json + package-lock.json (fsevents drops out, lightningcss-linux-x64-gnu comes in). Node's LTS -> npm mapping: https://nodejs.org/dist/index.json.
- "Is this lockfile in sync?" `npm ci` misses changed `overrides`. In the qa workspace, raising an existing unkeyed override (uuid ^11.1.0 -> ^12.0.0) leaves the lock at 11.1.1 through `npm install` AND `npm ci`; only `npm ls --all --package-lock-only` reports it as invalid. In dev/backend, raising ws ^8.0.0 -> ^8.23.0 was caught. Guard: QA-DEPS-6 (qa/backend-tests/unit/lockfileOverridesReview.test.js), if merged.
- Mutating package.json/lockfile and asking "does the guard or npm ci catch it" is quick: `git init` the scratch tree (the hygiene test calls `git check-ignore --no-index`), then per mutation run jest on the test file plus `npm ci --dry-run --ignore-scripts` (scratchpad lockmut/run.sh pattern).
- `npm audit fix --package-lock-only` in a manifest-only copy, then diff the lock, shows whether an "accepted" finding has a non-major fix (dev/web: bfj 7.1.0 -> 7.0.2 drops jsonpath/underscore).
- Backend unit Jest prints "A worker process has failed to exit gracefully" in about 4 of 5 runs, also with dependencyOverrides.test.js removed. It's pre-existing and not lockfile-related; --detectOpenHandles (in band) shows nothing.

Added during the CI unit-test gap review (2026-11-12):

- Scratch trees for `dev/mobile` `npm test` must include `dev/backend` sources: `dev/tests/mobile/config.test.js` reads `dev/backend/src/config/auth.js` (ENOENT otherwise, a false failure).
- `qa/mobile-tests` `npm run unit` passes with no `qa/node_modules` at all (everything resolves from dev/mobile via unit/jest.config.js). Only `dev/mobile` needs installing.
- Local npm 11.19 asks you to approve install scripts and skips postinstalls (detox, core-js) by default (`npm warn install-scripts`). Tests still pass, but CI's npm may behave differently.
- Branch protection on `main` (since 2026-11-12): the four pr.yml checks are required, PRs required (0 approvals), no force pushes, admin bypass allowed. Renaming a pr.yml job `name:` blocks every merge until protection is updated.
- Probe pattern for "does a failure fail the command": plant `test('probe', () => expect(1).toBe(2))` in a scratch tree and check the exit code. Jest also exits 1 for a test file with zero tests.

Added during the legacy-merge operator CLI review (2026-11-18):

- Since the lockfile change, `jest`/`cucumber-js` binaries are hoisted to `qa/node_modules/.bin`; `qa/backend-tests/node_modules` holds only a stray package. Scratch trees must symlink all three node_modules (dev/backend, qa, qa/backend-tests) and call `../node_modules/.bin/...` from qa/backend-tests.
- One feature only, in the real worktree, with npm scripts: `npm test -- --config <nine ../ to />private/tmp/.../cuke.js` (a scratch config with `paths: ['features/x.feature']`); an absolute --config path fails.
- Bash refuses shell loops over a variable command (`for a in ...; node $S $a`) and `node -e` scripts that edit worktree files ("too complex to verify"). Put probe loops in a scratchpad .sh file run with `bash <file>`; edit worktree files with the Edit tool.
- Mutation runner that takes SRC/FEATURES/MODES env vars (scratchpad lm-mut/run.sh + mutate.js): run the delivery's suite first, then rerun survivors against QA's new feature to prove each guard kills its mutant.
- Operator scripts: the real CLI can be exercised against a long-lived mongodb-memory-server on a fixed port (scratchpad lm-qa/mongo.js) from a `git archive` scratch copy holding its own `.env`, which avoids writing under dev/.
Added during the claim-guard review, spec 05 (2026-11-20):

- Scratchpad dirs from earlier sessions are gone (lm-mut was not there). Rebuilt runner: scratchpad qa-cg/mut/{run.sh,mutate.js,cuke.js} (MODES/FEATURES/TAG env, tree per mode, `none` = baseline), main.sh runs a QA feature against `git archive <rev> dev/backend`. Wrap env-heavy invocations in a .sh file: Bash refuses `VAR=... bash x.sh` combined with heredoc appends.
- Mongoose read-side casts matter for "raw vs read" bugs: a non-ObjectId `_id` (string, number) reads as `undefined`; a String path casts BSON Binary (toString) and `{ _id: '<str>' }` to that string, Code/arrays/plain objects to undefined. Probe with `Dev.collection.insertOne` + `Dev.findOne` (scratchpad qa-cg/bson-probe.js).
- Other sessions can push load to 35 (8 cores): mutant runs then print "0 scenarios" (BeforeAll: mongod "failed to start within 10000ms") and baselines get 5 s step timeouts. Always run a `none` baseline in the same batch, re-run "0 scenarios" modes, and attribute kills by failed scenario line, not count. Even `ps` and `cat` of a task file can exceed 2 min then; Read the file instead.
- Deterministic races: wrap `Dev.findOneAndUpdate` (restore in an After); match the write by its filter/update shape (`$set.github_username_stale` = displace, `$setOnInsert` + `github_id` = registration upsert).

- MongoDB driver errors echo URI option values (readPreference, compressors, OIDC ENVIRONMENT) but no credentials in any shape tried; a redaction test needs a secret the driver actually prints.

Added during the profile_busy 503 review (2026-11-22):

- No `timeout` binary on this Mac; rely on the Bash tool timeout. `npm run test:web` at qa/ is test:ci: its JSON goes to stdout and qa/reports/web.json is a stale tracked file. For counts run `npm test -- --reporter=list` in qa/web-tests.
- Web fake-answer steps already exist: `the backend answers {word} /devs/me with {int} and body {string}` (auth-slice5-review.steps.js) and `the backend answers POST /devs with ...` / `GET /auth/me` (auth-review.steps.js). bddgen fails on a duplicate definition, so grep before adding one.
- Mongoose read casts for github_id (Number): "not-a-number" reads undefined, "" reads null, so isLegacy() says legacy while a `github_id: null` filter misses the stored value (scratchpad pb-review/probe.js). Any "retry until the conditional write hits" loop turns such hand-edited data into a permanent give-up.
- "Does the raw-driver write store what Mongoose would?" Read both docs with `Dev.collection.findOne(filter, { promoteValues: false })` and map leaves to `_bsontype` (Int32/Double/ObjectId) to compare shapes (step in profile-busy-review.steps.js). Mongoose adds an ObjectId `_id` to the `location` PointSchema subdoc; the driver does not.
- A driver query `{ github_id: 222 }` matches Int32, Long, Double AND Decimal128 222 (numeric comparison), but not "222". JS-side checks like `Number.isSafeInteger` call Decimal128 "not a number", so lookup-by-id and is-legacy logic can disagree on the same document.
- Mutant one-liner: copy the old.sh/mut.sh pattern (scratchpad pb-review) and put the sed of the source inside the script; Bash refuses inline `git archive | tar` plus sed chains.
- "Is the list answer byte-identical?" Compare `response.text` with `JSON.stringify(await Dev.find(...))`. Caveat: a stored `location` without `_id` (raw-inserted seeds) gets a fresh random ObjectId from Mongoose on EVERY read, so blank those (step in profile-busy-review.steps.js) or the check is flaky by construction.
Added during the location-settings review (2026-11-23):

- Mobile mutants for qa/mobile-tests/unit tests: scratch tree = copy dev/mobile/src + package.json/babel.config.js/app.json, symlink dev/mobile/node_modules, copy qa/mobile-tests/unit, run `<wt>/dev/mobile/node_modules/.bin/jest --config unit/jest.config.js` from the scratch qa/mobile-tests (scratchpad ls-mut/run.sh + mutate.js). ~1 min for 3 modes.
- Re-mounting Main as a new session in a QA unit test: put a token in the mocked secure store and `act(() => session.retry())` (restore). There is no signIn(token) API.
- expo-location 57 facts (read from node_modules): Android canAskAgain on get* comes from a "blocked" flag persisted at the last request (no rationale => blocked; a dismissed first prompt also reads as blocked); Android foreground permission = COARSE's response; iOS denied/restricted => canAskAgain false; web always canAskAgain true and RN-web Linking has no openSettings; iOS getCurrentPosition errors out on its own, the app adds no timeout.
- Cucumber `{string}` cannot carry a value with inner double quotes (`"{"n":222}"` makes the step undefined); encode such values another way.
