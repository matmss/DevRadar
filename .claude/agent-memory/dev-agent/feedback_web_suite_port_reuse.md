---
name: web-suite-port-reuse
description: qa/web-tests reuses any dev server already listening on :3000 unless CI is set, so a parallel worktree's server would be tested instead of this branch; test:web prints its JSON stats to stdout
metadata:
  type: feedback
---

`qa/web-tests/playwright.config.js` has `reuseExistingServer: !process.env.CI` for the web dev server on port 3000 (Vite since 2026-11-23, `strictPort` on 127.0.0.1; it was CRA before), and the harness backend uses fixed port 3334. Several agent worktrees exist side by side.

**Why:** if another worktree (or the user) has `npm start` running on :3000, a local run silently tests that code, not this branch, and a "pass" means nothing. `VITE_API_URL` is also inlined when the server starts, so a reused server keeps whatever backend URL it was started with.

**How to apply:** before the web suite, check `lsof -nP -iTCP:3000 -sTCP:LISTEN` and `-iTCP:3334`, and run it as `CI=1 npm test -- --reporter=line` in `qa/web-tests` so a busy port fails loudly instead of being reused. A full run takes about 1.5-2 min (54 scenarios on 2026-11-23). Afterwards `git checkout -- qa/reports qa/web-tests/test-results` (see [[qa-reports-tracked-artifacts]]) and delete any untracked `test-results/<failure>` folders. From `qa/`, `CI=1 npm run test:web` (lead's preferred form) runs `test:ci` with `--reporter=html,json`; the CLI json reporter writes to stdout, NOT `qa/reports/web.json` (that tracked file keeps an old August run), so redirect to a log and read the `"stats"` block (`grep -A7 '^  "stats": {'`). It also writes an untracked `qa/web-tests/playwright-report/` (delete it). One scenario: `CI=1 npm run test:ci -- --grep AC-18 --reporter=line` in `qa/web-tests`. `qa/web-tests/.features-gen/**` IS tracked: commit the spec bddgen generates for a new `.feature`. See [[worktree-install-and-browsers]] for PW_CHROMIUM_PATH.
