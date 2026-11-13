---
name: npm-overrides-peer-scope
description: A scoped npm override ("parent": {"dep": ...}) also rewrites dep inside the parent's peer deps; key overrides by version ("glob@^10") instead; check npm ls after every override
metadata:
  type: project
---

Dependabot triage, 2026-11-12: in qa/mobile-tests, `"jest-cucumber": { "glob": "^14.0.2" }` (meant to fix jest-cucumber's glob@10 -> minimatch@9) also replaced jest's own glob@7 with glob 14, because jest is a jest-cucumber **peer** and npm treats peers as part of the scoped subtree. A version-keyed override, `"glob@^10": "^14.0.2"`, touched only the glob@10 instance.

Also: stream-json 3.x (fix for detox's stream-json 1.x advisories) is ESM-only with a `./*` -> `./src/*` export map; detox `require('stream-json/jsonl/Parser')`, so it can't be overridden.

QA review (QA-DEPS-1..3, same day): npm applies overrides (and npm 11's `allowScripts`) only from the root it installs from. Since the lockfile branch (2026-11-12) the qa members have no lockfiles or overrides at all: qa ones live only in `qa/package.json`, and `qa/backend-tests/unit/dependencyOverrides.test.js` (QA-DEPS-1) fails on a member that declares either. The old qa/backend-tests mirror of dev/backend's runtime deps is gone (dev/backend's own lockfile is scanned). Verify with `npm ls <pkg> --all` and `npm audit` in the install root. A bare override like `"engine.io": "~6.6.10"` would pin it forever; key it, `"engine.io@~6.6.0"`. Rules live in `qa/docs/04-qa-process.md` §9.

**Why:** the scoped override looked right and npm reported no error; only `npm ls glob` showed the collateral change.

**How to apply:** prefer `npm update <pkg>` in the install root (in-range fixes are now lockfile-only changes); when an override is unavoidable, check the replacement's module format/exports against how the parent requires it, key it by version, and diff `npm ls <pkg>` before and after. See [[worktree-install-and-browsers]].
