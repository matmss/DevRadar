---
name: backend-suite-timing-and-paths
description: qa/backend-tests Cucumber flakes when the machine is loaded (e.g. npm installs running), and a feature path argument does not narrow the run
metadata:
  type: project
---

In auth slice 6 (2026-11-10) the backend Cucumber suite failed one scenario per run, a different one each time (a socket client "refused: undefined", a status assertion), in the first two runs. Those runs took ~70 s and overlapped with background `npm install`s for dev/web, dev/mobile and qa/web-tests. Every later run, including two full suites in parallel, passed 282/282 in ~31 s. The timing-sensitive scenarios (2 s handshake wait, 500 ms / 100 ms write-ordering races) are what break under load.

Also: `npm test -- features/legacy-profiles.feature` in qa/backend-tests still runs every feature, because `cucumber.js` sets `paths: ['features/**/*.feature']`.

**Why:** a load-induced failure looks like a regression, which can send you debugging working code or make you report a false red.

**How to apply:** finish all installs before the first suite run. If one scenario fails in a slow run (>60 s), rerun before debugging; a real regression fails the same scenario every time. To run a subset, use tags (`npm test -- --tags @smoke`), not a file path. See [[worktree-install-and-browsers]].
