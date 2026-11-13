---
name: worktree-install-and-browsers
description: Fresh worktrees have no node_modules; npm ci in dev/backend, dev/web, dev/mobile and qa/ (lockfiles tracked since 2026-11-12); Playwright may need PW_CHROMIUM_PATH for the cached browser
metadata:
  type: project
---

A fresh agent worktree has no `node_modules` anywhere.

- Since the lockfile branch (2026-11-12) each install root has a tracked lockfile: run `npm ci` in `dev/backend`, `dev/web`, `dev/mobile` and `qa/` (the workspace root; `qa/*-tests` have no lockfile of their own, and `--workspaces=false` standalone installs are no longer the way). CI uses npm 11.20.0 (Node lts/* = v26.13.x); local npm was 11.19.0. To regenerate a lockfile with CI's npm: `npm install --prefix <scratchpad>/npm1120 npm@11.20.0`, then run that binary. Older branches (before that change) still need `npm install` in dev/* and `npm ci --workspaces=false` in each qa member.
- `qa/mobile-tests` `npm run unit` needs no `qa/` install at all, only `dev/mobile/node_modules` (pr.yml's `mobile-unit` job installs dev/mobile only).
- npm 11.20's install-script policy: scripts not covered by `allowScripts` still run, with a warning (only `strict-allow-scripts` blocks). `allowScripts`, like `overrides`, is read only from the install root, so it lives in `qa/package.json`.
- A background `npm ci ... | tail -3` reports exit code 0 even when npm failed (the pipe's status). Redirect to a log and `echo $?` instead, or check `ls node_modules`.
- Playwright: compare `qa/node_modules/playwright-core/browsers.json` (chromium-headless-shell revision) with `~/Library/Caches/ms-playwright`. On a mismatch, run with `PW_CHROMIUM_PATH=~/Library/Caches/ms-playwright/chromium_headless_shell-<rev>/chrome-headless-shell-mac-x64/chrome-headless-shell` (the config reads it) instead of downloading. On 2026-11-12 the qa lockfile's Playwright 1.65.0 wanted 1254, which was cached.

**Why:** these cost a few rounds of confusing failures (every web scenario failing at browser launch, "cucumber-js: command not found").

**How to apply:** install in this order at the start of a task, verify each, then follow [[web-suite-port-reuse]] for the Playwright run. See [[npm-overrides-peer-scope]] for changing dependencies.
