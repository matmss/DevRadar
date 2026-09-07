# DevRadar — Automation Framework Selection & Unified Runner Architecture

## 1. Selection criteria
For each layer: (a) native fit with the actual stack, (b) first-class or well-supported Gherkin/BDD integration (project mandate), (c) ability to run headless in CI, (d) community maturity/maintenance status, (e) ability to feed a common report format for the unified runner.

## 2. Backend — Express / MongoDB / Socket.io

**Choice: Cucumber.js + Jest (unit layer) + Supertest + `mongodb-memory-server` + `nock`**

| Concern | Tool | Why |
|---|---|---|
| BDD/Gherkin runner | `@cucumber/cucumber` | Official JS Cucumber implementation; runs `.feature` files directly against Node — no adapter layer needed since the backend *is* Node. |
| HTTP assertions | `supertest` | De facto standard for Express; drives the real `app` in-process, no network flakiness. |
| Isolated DB | `mongodb-memory-server` | Spins up a real (ephemeral) MongoDB per test run, including `2dsphere` index support — critical since the app's core logic is geospatial and can't be faithfully faked with a generic mock. |
| GitHub API isolation | `nock` | Intercepts `axios` calls to `api.github.com` so functional tests are deterministic and don't burn the 60/hr unauthenticated rate limit; a separate `@integration`-tagged suite optionally hits the real API. |
| WebSocket assertions | `socket.io-client` in step defs | Same process, real Socket.io server/client pair — validates FR-4 end to end without mocking Socket.io itself. |
| Unit tests | `jest` | For pure functions (`calculateDistance`, `parseStringAsArray`) — fast, no BDD overhead needed at this granularity. |
| Reporting | `cucumber` JSON formatter → `multiple-cucumber-html-reporter` | Feeds the unified HTML report (see §5). |

Rejected: **Jest-Cucumber** (wraps Jest with Gherkin-like syntax but isn't real Gherkin — weaker fit for a project whose mandate is BDD-first); **Mocha+Chai** (no native Gherkin).

## 3. Web — React (Create React App)

**Choice: Playwright + `playwright-bdd` (Cucumber-style `.feature` files on top of Playwright) + React Testing Library (component unit layer)**

| Concern | Tool | Why |
|---|---|---|
| E2E/BDD runner | `playwright-bdd` | Generates Playwright tests from real `.feature` files; keeps Gherkin as source of truth while getting Playwright's superior auto-waiting, tracing, and multi-browser support. |
| Browser automation | Playwright | Mocks browser Geolocation API cleanly (`context.setGeolocation` / `context.grantPermissions`) — required for FR-5.1; faster and less flaky than Selenium/Cypress for this. |
| Component/unit | React Testing Library + Jest (already a dependency via `react-scripts`) | Fast isolated checks of `DevForm`/`DevItem` rendering logic without a full browser. |
| Reporting | Playwright's built-in HTML reporter + Cucumber JSON (via `playwright-bdd`'s formatter) → merged into unified report | |

Rejected: **Cypress + `cypress-cucumber-preprocessor`** — viable alternative, but Playwright was preferred for native multi-tab/WebSocket network interception (useful for asserting the real-time scenarios) and first-class geolocation mocking; Cypress's Gherkin plugin is also less actively maintained than `playwright-bdd`.

## 4. Mobile — React Native / Expo (SDK 36)

**Choice: Detox + `jest-cucumber`, with Maestro flagged as a fallback**

| Concern | Tool | Why |
|---|---|---|
| E2E runner | Detox | Purpose-built gray-box E2E for React Native; can mock device location/permissions, drive real map interactions, and run on iOS Simulator/Android Emulator in CI. |
| Gherkin layer | `jest-cucumber` | Detox runs on Jest under the hood; `jest-cucumber` maps real `.feature` files to Jest test blocks, keeping Gherkin as the source of truth while reusing Detox's Jest-based tooling without fighting it. |
| Reporting | `jest-html-reporter` + a Cucumber-JSON adapter → merged into unified report | |

**Important caveat (documented, not hidden):** this repo's mobile app pins **Expo SDK 36** (2019) and `react-native-maps@0.26.1`/`react-navigation@4`, all long unmaintained. Detox's current releases target modern RN/Expo (SDK 50+) toolchains and may not build against this project as-is without an Expo SDK upgrade or Detox's `expo-detox-hook` legacy path. Two options, both included in the scaffold:
1. **Recommended:** upgrade the mobile app's Expo SDK as a prerequisite (tracked as BUG-007) — then Detox works cleanly.
2. **Interim fallback:** `Maestro` (YAML-flow based, black-box, works against a running Expo Go/dev client regardless of SDK age, no native build step required) — included as `mobile-tests/maestro/*.yaml` flows covering the same scenarios, usable today without touching the app's dependencies.

The scaffold ships both so the team isn't blocked while the Expo upgrade is scheduled.

## 5. Unified test runner architecture

Goals: one command runs everything; one merged human-readable report; CI-friendly; each layer can still run independently during development.

```
DevRadar/                      (repo root)
├── dev/
│   └── backend/ web/ mobile/     (existing app code)
├── .github/workflows/            (GitHub requires this exact path — lives at repo root, not under qa/)
│   └── unified-tests.yml
└── qa/                           (everything QA-related, as one unit)
    ├── docs/                         (this documentation set)
    ├── backend-tests/                (Cucumber.js + Supertest + mongodb-memory-server)
    ├── web-tests/                    (playwright-bdd)
    ├── mobile-tests/                 (Detox + jest-cucumber, + Maestro fallback flows)
    ├── reports/                      (merged output, gitignored)
    ├── package.json                  (root orchestrator, npm workspaces)
    └── run-all-tests.sh              (unified runner entrypoint used locally and in CI)
```

- **Orchestration:** `qa/package.json` uses npm workspaces to reference the three test packages; `npm run test:all` (run from inside `qa/`) runs each suite's `test:ci` script (each emits Cucumber-JSON to `reports/<layer>.json`), then runs `merge-report.js` to combine all three into one `reports/index.html` via `multiple-cucumber-html-reporter`.
- **Selective runs:** `npm run test:backend`, `test:web`, `test:mobile` for layer-specific development loops; tag filters (`--tags "@smoke"`) supported per the tagging convention in `04-qa-process.md`.
- **CI:** a GitHub Actions workflow (`unified-tests.yml`, included in the scaffold) runs backend+web on every PR (fast, no device farm needed), and mobile on a separate nightly/manual-dispatch job (needs a simulator runner).
- **Exit code:** the orchestrator exits non-zero if any layer fails, so it's a single CI gate.
