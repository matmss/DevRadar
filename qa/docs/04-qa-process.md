# DevRadar — QA Process

Defines how functional, regression, integration, and exploratory testing are run against the three DevRadar layers, and how they gate changes.

## 1. Test levels and ownership

| Level | Definition | Primary tooling (see 06-framework-selection.md) | Runs on |
|---|---|---|---|
| Unit | Single function/component in isolation (e.g. `calculateDistance`, `parseStringAsArray`, `DevItem` render) | Jest / React Testing Library | Every commit (pre-push hook + CI) |
| Functional (BDD) | A single feature behaves per its Gherkin scenario, layer in isolation with dependencies mocked/stubbed (GitHub API mocked, DB in-memory) | Cucumber.js (backend), Playwright+BDD (web), Detox+jest-cucumber (mobile) | Every PR |
| Integration | Real backend + real MongoDB (test instance) + real Socket.io, across layer boundaries (e.g. web → API → websocket → mobile) | Cucumber.js integration profile, cross-layer scenarios in `02-test-scenarios.md` | Every PR (backend integration), nightly (full cross-layer) |
| Regression | Re-run of the full P1/P2 tagged suite plus any test cases created from prior bugs (`@regression` tag) | Unified runner, all layers | Before every release / nightly |
| Exploratory | Time-boxed, unscripted, charter-driven (see `02-test-scenarios.md` charters) | Manual, session notes in Bug Tracker | Weekly + before each release |

## 2. BDD workflow

1. **Discovery:** New feature or bug fix starts with a Gherkin scenario added to `02-test-scenarios.md`, written collaboratively (dev + QA) in Given/When/Then, before implementation when feasible ("BDD as design tool").
2. **Automation:** The scenario is copied verbatim into the relevant `.feature` file in `backend-tests/`, `web-tests/`, or `mobile-tests/`, and step definitions are implemented or reused.
3. **Traceability:** Each scenario/test case references a Requirement ID (`01-requirements.md`). The traceability table in `03-test-cases.md` is updated.
4. **Tagging convention** used across all three suites' `.feature` files:
   - `@smoke` — minimal critical-path set, runs on every push (< 5 min total).
   - `@regression` — full suite, runs nightly and pre-release.
   - `@integration` — requires real DB/socket/cross-layer, excluded from fast unit-style runs.
   - `@edge` — negative/boundary cases.
   - `@wip` — excluded from CI until stabilized.

## 3. Functional testing
- Scope: one layer at a time, dependencies faked (GitHub API via `nock`/mock server, Mongo via `mongodb-memory-server`, browser geolocation mocked via Playwright, device location/permissions mocked via Detox).
- **Authentication (since auth slice 4):** every route that shows or changes developers and the Socket.io handshake need a session token, so scenarios sign in first. Backend: `Given I am signed in as "<login>"` (test-only token, `backend-tests/features/support/session.js`) or `I signed in through GitHub as` (full mocked OAuth); socket steps connect "signed-in clients" with the token in the handshake `auth` payload. Web: `I am signed in with GitHub as` (real backend flow, GitHub faked); steps that inspect the backend over HTTP use a test-only inspector token (`web-tests/features/support/auth-fixtures.js`). Mobile: Jest mocks the native modules; Maestro flows that need the map sign in with a real GitHub test account (`mobile-tests/README.md`). Each protected surface also has explicit `@smoke`/`@regression` scenarios for the missing/expired/invalid token cases.
- **Own-profile routes and live pushes (since auth slice 5):** `GET`/`PUT`/`DELETE /devs/me` are covered by `backend-tests/features/profile.feature` (`I request my profile`, `I update my profile with ...`, `I delete my profile`; seed the user's profile with `a developer already exists with github_username ...`). The backend's socket test clients record every pushed event (`socket.onAny`), so a scenario can assert `new-dev`, `dev-updated` and `dev-deleted` independently, including that an event did *not* arrive (`should receive exactly 0 "<event>" events within N seconds`). Web: `web-tests/features/profile.feature` seeds the signed-in user's profile through the harness-only `POST /__test__/seed-dev` (any letter case) and watches for native dialogs, which the app must never open.
- **Mobile unit tests** (`dev/tests/mobile/`, `npm test` in `dev/mobile`) cover the sign-in services, session handling and the live marker updates (`dev-updated`/`dev-deleted`); they are the fast feedback layer while Detox is blocked (BUG-009).
- Entry criteria: feature code merged to branch; `.feature` file exists.
- Exit criteria: all `@smoke` + relevant `@edge` scenarios pass; no P1 defect open against the feature.

## 4. Regression testing
- Full `@regression`-tagged suite across backend, web, mobile runs via the unified runner (`npm run test:all`) nightly on `master` and on-demand before a release tag.
- Any confirmed production bug gets a corresponding scenario added with `@regression` before the fix is considered done (prevents re-occurrence).
- A regression run is a release gate: a release cannot ship with a failing P1 `@regression` scenario.

## 5. Integration testing
- Backend integration profile: real (test) MongoDB + real Express app + real Socket.io server, exercised via Supertest + a Socket.io client in the same process (see `backend-tests/features/realtime.feature`).
- Cross-layer integration: nightly job that boots backend + a headless web client (Playwright) and asserts the WebSocket propagation scenario ("A web registration is seen live by a connected mobile-equivalent client") end to end. True mobile-simulator-in-the-loop cross-layer runs are run manually/pre-release given CI cost, using Detox against the same backend instance.

## 6. Exploratory testing
- Session-based test management (SBTM): each charter from `02-test-scenarios.md` is time-boxed (30–45 min), notes captured in the Bug Tracker doc under "Exploratory session log," and any defect found gets a bug entry plus, if it represents a real gap, a new automated scenario.
- Cadence: at least one charter per sprint/week, and a full charter pass before any release.
- Charters are refreshed whenever a new feature lands (e.g., the update/delete endpoints of auth slice 5 got the "profile update/delete" charter in `02-test-scenarios.md`).

## 7. Entry / exit criteria summary

| Gate | Entry criteria | Exit criteria |
|---|---|---|
| PR merge | Unit + functional BDD suite green for touched layer(s) | No new P1/P2 defects; coverage on touched files not reduced |
| Nightly build | Latest `master` | Regression + integration suites green; failures triaged same day |
| Release | Nightly green for 2 consecutive runs | Exploratory pass complete; open P1 bug count = 0; P2 bugs have owners/dates |

## 8. Environments

| Env | Backend DB | GitHub API | Used for |
|---|---|---|---|
| `test` (CI) | `mongodb-memory-server` (backend BDD) or ephemeral Mongo container (integration) | Mocked (`nock`) | Functional + integration BDD |
| `staging` | Real MongoDB Atlas test cluster | Real (rate-limit aware) | Exploratory, pre-release regression, manual mobile testing |
| `production` | Real | Real | Smoke-only, post-deploy |

## 9. Defect workflow
See `05-bug-tracker.md` for the template, severity/priority matrix, and lifecycle states.
