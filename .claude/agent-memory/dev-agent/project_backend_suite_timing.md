---
name: backend-suite-timing-and-paths
description: One-off test failures under load came from servers listening on "::" while clients dial 127.0.0.1 (BUG-013, fixed in harnesses); cucumber needs forceExit; a feature path argument does not narrow the run
metadata:
  type: project
---

In auth slice 6 (2026-11-10/11) the backend Cucumber suite failed one scenario per run, a different and unrelated one each time (a 404 with a text/html body, 400 instead of 413, a socket connect_error without `data`), whenever other sessions loaded the machine. QA found the root cause (BUG-013): test servers listened without a host ("::") while clients dialed 127.0.0.1 or `localhost`, and on macOS another process can bind 127.0.0.1 (or ::1) on the same port and take the traffic. Fixed in the harnesses only: `qa/backend-tests/features/support/loopback.js` (QA), and the web harness backend + CRA (`HOST`) on 127.0.0.1 with every URL on 127.0.0.1. After that, four full runs at load averages 6-9 were clean.

Also: a timed-out step can leave a handle open, and cucumber then prints its summary and never exits; `qa/backend-tests/cucumber.js` now sets `forceExit: true` (verified with a timed-out probe step: hang without it, exit in 7 s with it). And `npm test -- features/x.feature` in qa/backend-tests still runs every feature (`paths` in cucumber.js); use `--tags`.

**Why:** a load-induced foreign answer looks like a regression; it cost several reruns and a wrong "environmental" call before the cause was known.

**How to apply:** any new test server must bind 127.0.0.1 and any test URL must use 127.0.0.1, not `localhost`. If an unrelated one-off failure appears anyway, check that first (and QA's memory, qa-harness-quirks), rerun, and report it by name. Run installs before suites. See [[worktree-install-and-browsers]].
