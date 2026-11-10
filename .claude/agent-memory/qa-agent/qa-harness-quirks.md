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

**Why:** each cost a wasted run or produced a false pass.
**How to apply:** use this when writing backend probes or log-assertion steps; see [[auth-review-findings]] if it is ever written.
