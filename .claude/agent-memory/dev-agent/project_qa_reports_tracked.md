---
name: qa-reports-tracked-artifacts
description: qa/reports/* files are tracked in git despite .gitignore, and every test run rewrites them; restore before committing
metadata:
  type: project
---

`qa/reports/backend-report.html`, `qa/reports/web-html/index.html` and `qa/reports/web.json` are tracked even though `.gitignore` lists `qa/reports/`. Running `npm test` in `qa/backend-tests` or `qa/web-tests` rewrites them.

**Why:** they were committed early (QA structure, #37) and are only refreshed deliberately; feature PRs since then don't touch them.

**How to apply:** after running suites, `git checkout -- qa/reports` before committing, unless the task is explicitly to refresh the reports.
