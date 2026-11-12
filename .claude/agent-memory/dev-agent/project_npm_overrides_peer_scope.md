---
name: npm-overrides-peer-scope
description: A scoped npm override ("parent": {"dep": ...}) also rewrites dep inside the parent's peer deps; key overrides by version ("glob@^10") instead; check npm ls after every override
metadata:
  type: project
---

Dependabot triage, 2026-11-12: in qa/mobile-tests, `"jest-cucumber": { "glob": "^14.0.2" }` (meant to fix jest-cucumber's glob@10 -> minimatch@9) also replaced jest's own glob@7 with glob 14, because jest is a jest-cucumber **peer** and npm treats peers as part of the scoped subtree. A version-keyed override, `"glob@^10": "^14.0.2"`, touched only the glob@10 instance.

Also: stream-json 3.x (fix for detox's stream-json 1.x advisories) is ESM-only with a `./*` -> `./src/*` export map; detox `require('stream-json/jsonl/Parser')`, so it can't be overridden.

QA review (QA-DEPS-1..3, same day): npm applies overrides only from the root it installs from, and CI installs from `qa/`, so every `qa/*-tests` override must also be in `qa/package.json` (`qa/backend-tests/unit/dependencyOverrides.test.js` enforces it, plus that the qa/backend-tests mirror of dev/backend's runtime deps never has a lower floor). Verify the CI path with `npm install --package-lock-only` at `qa/`, then `npm ls <pkg> --all --package-lock-only` and `npm audit`. In dev/backend (no lockfile), a bare override like `"engine.io": "~6.6.10"` would pin it forever; key it, `"engine.io@~6.6.0"`. Rules now live in `qa/docs/04-qa-process.md` §9.

**Why:** the scoped override looked right and npm reported no error; only `npm ls glob` showed the collateral change.

**How to apply:** prefer `npm update <pkg> --workspaces=false`; when an override is unavoidable, check the replacement's module format/exports against how the parent requires it, key it by version, and diff `npm ls <pkg>` before and after. See [[worktree-install-and-browsers]].
