---
name: ci-subset-order
description: PR CI runs the full web suite but the nightly runs only --grep @regression, so scenario neighbours differ; verify web changes with the regression subset too
metadata:
  type: project
---

The PR workflow runs the full web suite (`npm run test:web`); the nightly Regression workflow runs only `npm run test:regression` (`--grep @regression`). With `workers: 1` and one shared harness backend, the filter changes which scenario runs before which. BUG-014 (2026-11-11): a scenario that relied on a previous @smoke scenario's reset passed every PR run and failed every nightly since auth slice 5. Fixed with a Before hook that empties the backend per scenario.

**Why:** a green PR run said nothing about the nightly; the failure looked "intermittent" only because the nightly had run once at that commit.

**How to apply:** when touching web scenarios or the harness, run both the full suite and `npm run test:regression` (and `@smoke`) before handing off. A "flaky" nightly-only failure: first diff the execution order in the artifact's `web.json` (sort results by `startTime`) and look at the preceding scenario. See [[web-suite-port-reuse]].
