---
name: backend-race-hooks-model-writes
description: qa/backend-tests inject races by monkeypatching Dev.findOneAndUpdate and matching filter shapes (github_id === null, $set.github_username_stale), so ownership writes must stay on the model for normal data
metadata:
  type: project
---

Many backend scenarios (ownership, claim-guard-review, profile-busy, auth-slice5-recheck, profile.steps) force races or exhaustion by replacing `Dev.findOneAndUpdate` and recognising the write by its filter/update shape: a claim is `filter.github_id === null` with `$set.github_id`, a displacement is `$set.github_username_stale === true`. Some stubs return null without touching the DB.

**Why:** in the QA-PB-1 fix (2026-11-22) moving every conditional write to `Dev.collection` (the driver) would have silently disabled all of those stubs. The fix kept the model path for normal data and used the driver only for filters Mongoose would cast differently (hand-edited `_id`/`github_id`), and its "miss for good" check compares the stored doc AND re-evaluates the filter, so a non-mutating stub still counts as contention.

**How to apply:** when changing `services/devOwnership.js` writes, keep normal-case filters shaped as before (`github_id: null`, plain `_id`), keep `Dev.findOneAndUpdate` as the call, and grep `step_definitions` for `Dev.findOneAndUpdate =` before refactoring. See [[mutation-backup-timing]].
