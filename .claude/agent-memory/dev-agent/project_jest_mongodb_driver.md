---
name: jest-mongodb-driver-handshake
description: qa/backend-tests Jest (unit/) cannot connect to MongoDB with the backend's mongoose 9 / driver 7 ("Missing required sub-document 'driver'"); put DB-backed checks in Cucumber
metadata:
  type: project
---

In multi-instance PR1 (2026-11-27) a Jest unit test in `qa/backend-tests/unit/` that started a MongoMemoryServer and called `mongoose.connect` (dev/backend's mongoose 9.12 / mongodb driver 7.8) failed every test with `MongooseServerSelectionError: Missing required sub-document 'driver' in the client metadata document`. Jest's VM sandbox breaks the driver's BSON-serialized handshake (its `LimitedSizeDocument` is a Map); `sandboxInjectedGlobals: ["Map"]` did not fix it. The same code runs fine in plain Node (Cucumber, scratch scripts).

**Why:** cost a round-trip; the unit/ suite is pure-function tests and has never touched a database.

**How to apply:** store-level checks that need a real mongod go into a Cucumber feature driving the module directly (precedent: `features/shared-stores.feature`), which reuses hooks.js's MongoMemoryServer and per-scenario cleanup. Quick experiments: a scratchpad Node script requiring the worktree's modules by absolute path. See [[multi-instance-phases]].
