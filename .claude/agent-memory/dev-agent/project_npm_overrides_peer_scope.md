---
name: npm-overrides-peer-scope
description: A scoped npm override ("parent": {"dep": ...}) also rewrites dep inside the parent's peer deps; key overrides by version ("glob@^10") instead; check npm ls after every override
metadata:
  type: project
---

Dependabot triage, 2026-11-12: in qa/mobile-tests, `"jest-cucumber": { "glob": "^14.0.2" }` (meant to fix jest-cucumber's glob@10 -> minimatch@9) also replaced jest's own glob@7 with glob 14, because jest is a jest-cucumber **peer** and npm treats peers as part of the scoped subtree. A version-keyed override, `"glob@^10": "^14.0.2"`, touched only the glob@10 instance.

Also: stream-json 3.x (fix for detox's stream-json 1.x advisories) is ESM-only with a `./*` -> `./src/*` export map; detox `require('stream-json/jsonl/Parser')`, so it can't be overridden. Overrides in `qa/*-tests/package.json` only apply to that dir's standalone install, not to CI's install from `qa/`.

**Why:** the scoped override looked right and npm reported no error; only `npm ls glob` showed the collateral change.

**How to apply:** prefer `npm update <pkg> --workspaces=false`; when an override is unavoidable, check the replacement's module format/exports against how the parent requires it, key it by version, and diff `npm ls <pkg>` before and after. See [[worktree-install-and-browsers]].
