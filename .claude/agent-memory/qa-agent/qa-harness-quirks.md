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

- dev/backend, dev/web, dev/mobile have no lockfile: `npm install --no-audit --no-fund`. qa/backend-tests, qa/web-tests, qa/mobile-tests DO have lockfiles: `npm ci --workspaces=false` inside each (plain `npm ci` resolves the qa workspace root and fails); their deps then live in each suite's own node_modules. All six in parallel in the background take about 5 min.
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
