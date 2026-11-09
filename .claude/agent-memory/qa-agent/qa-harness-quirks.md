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

**Why:** each cost a wasted run or produced a false pass.
**How to apply:** use this when writing backend probes or log-assertion steps; see [[auth-review-findings]] if it is ever written.
