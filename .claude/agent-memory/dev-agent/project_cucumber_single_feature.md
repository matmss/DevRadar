---
name: cucumber-single-feature-run
description: How to run one backend .feature file via npm scripts; CLI paths merge with cucumber.js paths and --config resolves against cwd
metadata:
  type: project
---

Running one feature in qa/backend-tests: `npm test -- features/x.feature` still runs everything (cucumber 13 merges CLI paths with the `paths` in cucumber.js, with a deprecation warning). What worked (legacy-merge item, 2026-11-18): a scratchpad config with `require` (support + step_definitions globs), `paths: ['features/x.feature']`, `forceExit: true`, then `npm test -- --config <RELATIVE path to it>`. An absolute `--config` path is joined onto cwd (MODULE_NOT_FOUND); from qa/backend-tests in an agent worktree that is nine `../` to `/`.

**Why:** the lead asked to run suites with npm scripts, never `npx cucumber-js`, and the full suite takes minutes per iteration.

**How to apply:** iterate on one feature this way, then run `npm run test:backend` and the `--workspace=backend-tests` regression/smoke subsets before handing off. See [[ci-subset-order]].
