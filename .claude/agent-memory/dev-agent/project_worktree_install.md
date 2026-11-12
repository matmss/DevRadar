---
name: worktree-install-and-browsers
description: Fresh worktrees have no node_modules; dev/* has no lockfiles (npm install), qa/* workspaces need npm ci --workspaces=false, and Playwright may need PW_CHROMIUM_PATH for the cached browser
metadata:
  type: project
---

A fresh agent worktree has no `node_modules` anywhere. Seen in auth slice 5 (2026-11-10):

- `dev/backend`, `dev/web`, `dev/mobile` have no `package-lock.json` (`**/package-lock.json` is gitignored), so `npm ci` fails with EUSAGE. Use `npm install --no-audit --no-fund`.
- `qa/` (the workspace root) has no lockfile either; each of `qa/backend-tests`, `qa/web-tests`, `qa/mobile-tests` has its own. Inside them, plain `npm ci` also fails (npm resolves the workspace root); `npm ci --workspaces=false` works. Exception seen on 535f61d (2026-11-11): `qa/backend-tests`'s lockfile was out of sync with its package.json (supertest 7.2.2 vs ^7.3.2), so `npm ci` failed EUSAGE; `npm install --workspaces=false --no-package-lock` installed without touching the lockfile. `qa/mobile-tests` `npm run unit` only needs `dev/mobile/node_modules`.
- `qa/mobile-tests` `npm run unit` needs no `qa/` install at all, only `dev/mobile/node_modules` (QA-verified 2026-11-12; pr.yml's `mobile-unit` job installs dev/mobile only). Local npm 11.19 does not run install scripts (it prints `install-scripts ... not yet covered by allowScripts`), so mongodb-memory-server's postinstall download is skipped locally.
- A background `npm ci ... | tail -3` reports exit code 0 even when npm failed (the pipe's status). Check the output or `ls node_modules` before relying on it.
- `qa/web-tests` lockfile pins `@playwright/test` 1.62.1, which wants browser build 1234, while `~/Library/Caches/ms-playwright` held 1254. Instead of downloading, run with `PW_CHROMIUM_PATH=~/Library/Caches/ms-playwright/chromium_headless_shell-<rev>/chrome-headless-shell-mac-x64/chrome-headless-shell` (the config reads it). Check the cache's revision first; it may change.

**Why:** these cost a few rounds of confusing failures (every web scenario failing at browser launch, "cucumber-js: command not found").

**How to apply:** install in this order at the start of a task, verify each, then follow [[web-suite-port-reuse]] for the Playwright run.
