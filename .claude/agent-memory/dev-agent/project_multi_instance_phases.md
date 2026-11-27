---
name: multi-instance-phases
description: Multi-instance backend plan PR0-PR3 (user-approved, 2026-11-27); PR0 serverContext, PR1 auth state + rate limits in Mongo by $$NOW; multi-instance.feature is inverted per phase
metadata:
  type: project
---

The backend is being made to run as N instances on one MongoDB, in phases (PO plan, user-approved 2026-11-27):
PR0 per-server context, no behaviour change (branch feat/mi-pr0-instance-state, c75f24d); PR1 OAuth state, one-time codes and rate limits in Mongo (branch feat/mi-pr1-shared-auth, 2026-11-27); PR2 cross-instance push over a Mongo capped-collection bus (each instance keeps its own `connections` and runs isNearby locally); PR3 a Mongo lease lock per account under the local keyed queue.

**Why:** today's state was module singletons, so two servers in one process shared everything and multi-instance tests were impossible. Only MongoDB is allowed as infrastructure (standalone mongod, no replica set, no Redis).

**How to apply:** in PR2-PR3, swap the piece inside `createServerContext()` and invert the matching scenario in `qa/backend-tests/features/multi-instance.feature` (its header lists which scenario each phase flips; PR1 flipped 1-3). The queue scenario holds `Dev.findOneAndDelete` once; with PR3, B's delete should wait instead of answering 204. Helpers for more instances live in `qa/backend-tests/features/support/instances.js`.

PR1 lessons: the shared stores expire by MongoDB's clock (`$$NOW`), so the old Date.now-shifting steps ("601 seconds pass") would no longer expire anything; `auth.steps.js` shiftClock now also moves stored expiries back (`support/shared-state.js` ageSharedState). Any new time-travel step must do the same. "Instance clock vs Mongo clock" is only distinguishable by stepping Date.now without aging (the lifetime scenario does). Driver-level writes go through `Model.collection` (pipelines with `$literal` payloads); scenarios stub one collection method with an own property and `delete` it to restore. See [[backend-race-hooks-model-writes]], [[jest-mongodb-driver-handshake]].
