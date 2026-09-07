# DevRadar — Bug / Issue Tracker

Lightweight tracker template for use until/unless this is migrated to GitHub Issues or a dedicated tracker (Jira/Linear). Each entry follows the template below. Severity/priority matrix and lifecycle states are defined once, at the bottom.

## Bug report template

```
### BUG-XXX — <short title>

- Status: Open | In Progress | Fixed | Verified | Closed | Won't Fix | Duplicate
- Severity: S1 (Critical) | S2 (Major) | S3 (Minor) | S4 (Cosmetic)
- Priority: P1 | P2 | P3 | P4
- Layer: Backend | Web | Mobile | Cross-layer
- Requirement(s): <FR-x.x / NFR-x>
- Test case(s): <TC-xxx>
- Reported by / date:
- Environment: <test|staging|production, commit SHA>

**Steps to reproduce**
1.
2.

**Expected result**


**Actual result**


**Evidence** (logs / screenshot / request-response payload)


**Root cause** (filled once triaged)


**Fix / PR link**


**Regression scenario added** (feature file + scenario name, once fixed)
```

## Severity × Priority matrix

| | S1 Critical | S2 Major | S3 Minor | S4 Cosmetic |
|---|---|---|---|---|
| **Blocks release / data loss / crash** | P1 | P1 | P2 | P3 |
| **Core feature broken, workaround exists** | P1 | P2 | P2 | P3 |
| **Edge case / rare path** | P2 | P2 | P3 | P4 |
| **Cosmetic only** | P3 | P3 | P4 | P4 |

## Lifecycle

`Open → In Progress → Fixed → Verified → Closed`, with `Won't Fix` / `Duplicate` as terminal alternate states. A bug is not `Closed` until its regression scenario is merged and green in CI at least once.

## Seed backlog — defects/gaps identified during this QA audit (2026-08-18)

These were found by static code review while producing the Requirements doc, not yet by running the automated suite. Statuses will move to Verified once the corresponding test case in `03-test-cases.md` is executed and confirmed.

| ID | Title | Severity | Priority | Layer | Test case | Status |
|---|---|---|---|---|---|---|
| BUG-001 | Mobile API/socket base URL hardcoded to a LAN IP, not env-configurable | S2 | P1 (blocks mobile CI automation) | Mobile | TC-022 | Fixed (2026-09-02 — `src/services/api.js`/`socket.js` now read `EXPO_PUBLIC_API_URL` (Expo's native env-var convention) with a `localhost:3333` fallback; see `dev/mobile/.env.example`. Pair with `adb reverse tcp:3333 tcp:3333`, or set `EXPO_PUBLIC_API_URL` to the host's LAN IP, for local device/emulator runs) |
| BUG-002 | 10km radius boundary logic differs between search (`$maxDistance: 10000`m, likely inclusive) and websocket matching (`< 10`km, strict exclusive) | S3 | P2 | Backend | TC-010 | Open |
| BUG-003 | `POST /devs` has no input validation — missing/empty `github_username` likely causes an unhandled error rather than a 400 | S2 | P1 | Backend | TC-011 | Open |
| BUG-004 | `POST /devs` does not catch GitHub API errors (404 for unknown user, rate-limit 403) — likely unhandled promise rejection / 500 | S2 | P1 | Backend | TC-012 | Open |
| BUG-005 | `POST /devs` does not validate latitude/longitude are numeric — non-numeric input likely stored as `NaN` in the geospatial index | S2 | P2 | Backend | TC-013 | Open |
| BUG-006 | No authentication/authorization on any endpoint; CORS fully open (`origin: '*'`) | S2 (accepted risk for a learning project) | P3 | Backend | — | Open (tracked as accepted risk, revisit if project scope changes) |
| BUG-007 | Mobile targets unmaintained Expo SDK 36 (2019) / `react-native-maps` 0.26.1 — build/run compatibility with current toolchains unverified | S3 | P2 | Mobile | — | Fixed (2026-08-22 — upgraded to Expo SDK 57, `react-navigation` v4→v7, ran `expo prebuild` to generate `dev/mobile/android`; native build compiles, app installs/launches/bundles correctly and was manually smoke-tested end to end on `Pixel_6a_API_34`. Not yet `Verified`: automated Detox run still failing — see BUG-009) |
| BUG-008 | No `update`/`delete` developer endpoints implemented (stubbed, commented out in `SearchController`) | N/A (scope gap, not a defect) | P4 | Backend | — | Open (product decision needed) |
| BUG-009 | Detox test run (`android.emu.debug`) times out on every scenario's `beforeEach` (`device.launchApp`) waiting for the instrumentation WebSocket, even though the same build launches fine manually — reproduced once after fixing BUG-007. Suspected host resource starvation (this dev machine ran the Gradle daemon, Metro, MongoDB, the backend, and the emulator simultaneously; the emulator's own boot log reported available RAM below the AVD's suggested minimum). Maestro's `clearState: true` flows show a related symptom: 2 of 3 flows failed asserting "DevRadar" visible against a screenshot that's still mid-bundle, i.e. a timeout race against Metro's cold-bundle time, not a UI defect (the 3rd flow, exercising real search input, passed). Needs a re-run on a less-contended machine, and possibly raised Maestro/Detox timeouts for `clearState` runs, before mobile E2E can be trusted in CI | S3 | P2 | Mobile (test infra) | — | Open |

## Exploratory session log

_(Append entries here as exploratory charters from `02-test-scenarios.md` are run.)_

```
### Session: <date> — Charter: <charter name>
Tester:
Duration:
Notes:
Bugs filed: BUG-xxx, BUG-xxx
```
