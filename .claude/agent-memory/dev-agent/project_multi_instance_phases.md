---
name: multi-instance-phases
description: Multi-instance backend plan PR0-PR3 (user-approved, 2026-11-27); PR0 added serverContext; multi-instance.feature is written to be inverted by later phases
metadata:
  type: project
---

The backend is being made to run as N instances on one MongoDB, in phases (PO plan, user-approved 2026-11-27):
PR0 per-server context, no behaviour change (branch feat/mi-pr0-instance-state, c75f24d); PR1 OAuth state, one-time codes and rate limits in Mongo; PR2 cross-instance push over a Mongo capped-collection bus (each instance keeps its own `connections` and runs isNearby locally); PR3 a Mongo lease lock per account under the local keyed queue.

**Why:** today's state was module singletons, so two servers in one process shared everything and multi-instance tests were impossible.

**How to apply:** in PR1-PR3, swap the piece inside `createServerContext()` and invert the matching scenario in `qa/backend-tests/features/multi-instance.feature` (its header lists which scenario each phase flips). The queue scenario holds `Dev.findOneAndDelete` once; with PR3, B's delete should wait instead of answering 204. Proving a scenario: mutate one piece of serverContext to a module-level shared instance and run `npm test -- --tags @multi-instance` (4/5 failed for stores+limits+queue, 1/5 for shared connections). See [[backend-race-hooks-model-writes]].
