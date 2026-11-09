---
name: web-suite-port-reuse
description: qa/web-tests reuses any dev server already listening on :3000 unless CI is set, so a parallel worktree's server would be tested instead of this branch
metadata:
  type: feedback
---

`qa/web-tests/playwright.config.js` has `reuseExistingServer: !process.env.CI` for the CRA dev server on port 3000, and the harness backend uses fixed port 3334. Several agent worktrees exist side by side.

**Why:** if another worktree (or the user) has `npm start` running on :3000, a local run silently tests that code, not this branch, and a "pass" means nothing.

**How to apply:** before the web suite, check `lsof -nP -iTCP:3000 -sTCP:LISTEN` and `-iTCP:3334`, and run it as `CI=1 npm test -- --reporter=line` in `qa/web-tests` so a busy port fails loudly instead of being reused. A full run takes about 1-1.5 min. Afterwards `git checkout -- qa/reports qa/web-tests/test-results` (see [[qa-reports-tracked-artifacts]]) and delete any untracked `test-results/<failure>` folders.
