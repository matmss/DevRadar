# DevRadar

DevRadar lets developers register their location and tech stack — pulled from their
GitHub profile — so nearby developers can discover each other on a map, in real time.
Three client layers share one backend API, grouped under `dev/`, plus a `qa/` folder
that owns all testing — the two top-level folders mirror each other: `dev/` is the app,
`qa/` is everything that verifies it.

## Architecture

| Layer | Path | Stack | Role |
|---|---|---|---|
| Backend | [`dev/backend/`](dev/backend/) | Node.js, Express 5, Mongoose 9 (MongoDB), Socket.io 4 | REST API, geospatial search, real-time push of new devs |
| Web | [`dev/web/`](dev/web/) | React 18 (Create React App) | Browser UI to register a developer and view the full list |
| Mobile | [`dev/mobile/`](dev/mobile/) | React Native / Expo SDK 57, `react-native-maps` | Map UI to search nearby devs by tech, view profiles, receive live updates |
| QA | [`qa/`](qa/) | Cucumber.js, Playwright + BDD, Detox/Maestro | Docs, automated tests, and a unified test runner for all three layers above |

Cross-cutting integration: the backend calls the public **GitHub Users API**
(`GET https://api.github.com/users/:username`) to enrich a registration with `name`,
`avatar_url`, and `bio`.

## How the pieces connect

[`dev/backend/src/index.js`](dev/backend/src/index.js) boots Express on top of a raw
`http.Server` (so Socket.io can share the port), connects to MongoDB via `MONGO_URI`, and
mounts two routes ([`routes.js`](dev/backend/src/routes.js)):

- **`POST /devs`** ([`DevController.js`](dev/backend/src/controllers/DevController.js)) — registers
  a developer. If the `github_username` isn't already stored, it calls the GitHub API to fill
  in `name`/`avatar_url`/`bio`, persists a GeoJSON `Point` location, then pushes a `new-dev`
  event over Socket.io to any nearby, tech-matching connected clients.
- **`GET /search`** ([`SearchController.js`](dev/backend/src/controllers/SearchController.js)) —
  geospatial query (`$near` on a `2dsphere` index) filtered by tech.
- [`websocket.js`](dev/backend/src/websocket.js) tracks each connected socket's coordinates and
  techs in memory, and does the "who's nearby" matching that drives the real-time push.

**Web** ([`App.js`](dev/web/src/App.js)) is a registration form plus a flat list — CRUD against
`/devs`, no map.

**Mobile** ([`Main.js`](dev/mobile/src/pages/Main.js)) is the map experience — reads device
location via `expo-location`, calls `/search`, opens a Socket.io connection scoped to the
visible region, and renders dev pins with a profile callout. Its backend URL is
environment-configurable via `EXPO_PUBLIC_API_URL` (see [`mobile/.env.example`](dev/mobile/.env.example)),
falling back to `localhost:3333`; web uses the equivalent `REACT_APP_API_URL` convention.

## QA workspace

[`qa/`](qa/) is a self-contained SDET scaffold that sits alongside `dev/`: docs, one
automated test suite per layer, and a unified runner — kept separate from application code.

**Docs** ([`qa/docs/`](qa/docs/)), meant to be read in order:

1. [`01-requirements.md`](qa/docs/01-requirements.md) — requirements reverse-engineered from
   the actual code (there's no separate product spec)
2. [`02-test-scenarios.md`](qa/docs/02-test-scenarios.md) — Gherkin scenarios, the human-readable
   source of truth
3. [`03-test-cases.md`](qa/docs/03-test-cases.md) — granular test cases, traceable to
   requirement IDs
4. [`04-qa-process.md`](qa/docs/04-qa-process.md) — test levels (unit/functional/integration/
   regression/exploratory), the BDD workflow, and tagging conventions (`@smoke`, `@regression`,
   `@P1`, `@edge`)
5. [`05-bug-tracker.md`](qa/docs/05-bug-tracker.md) — lightweight bug template/log until this
   migrates to GitHub Issues or a dedicated tracker
6. [`06-framework-selection.md`](qa/docs/06-framework-selection.md) — the rationale behind every
   tool choice below
7. [`07-test-runner-report.md`](qa/docs/07-test-runner-report.md) — link to a published, merged
   HTML test report

**Automation**, one suite per layer, each matched to that layer's stack:

- **Backend** ([`qa/backend-tests/`](qa/backend-tests/)) — Cucumber.js `.feature` files and
  step definitions, driving the real Express app in-process via `supertest`, against a real
  ephemeral MongoDB (`mongodb-memory-server`, needed since the app's `2dsphere` geospatial
  logic can't be faithfully mocked). `nock` stubs the GitHub API. Plain Jest covers pure-function
  unit tests (`calculateDistance`, `parseStringAsArray`).
- **Web** ([`qa/web-tests/`](qa/web-tests/)) — Playwright + `playwright-bdd`, running against the
  real Express + MongoDB backend; only GitHub's API and browser geolocation are mocked.
- **Mobile** ([`qa/mobile-tests/`](qa/mobile-tests/)) — Detox + `jest-cucumber` as the primary
  approach, with Maestro YAML flows as a fallback that doesn't require Detox's simulator setup.

**Unified runner**: `qa/run-all-tests.sh` (== `npm run test:all` from inside `qa/`) runs all
three suites and calls `qa/merge-report.js` to combine their JSON output into one
`qa/reports/index.html`.

## Getting started

```bash
# Backend
cd dev/backend && cp .env.example .env   # fill in MONGO_URI
npm install && npm run dev

# Web
cd dev/web && cp .env.example .env
npm install && npm start

# Mobile
cd dev/mobile && cp .env.example .env    # set EXPO_PUBLIC_API_URL if not on localhost
npm install && npm start

# QA — run everything against a running backend
cd qa && npm install
npm run test:backend   # or test:web, or test:all
```

See [`qa/docs/04-qa-process.md`](qa/docs/04-qa-process.md) for when each test level runs
(every commit, every PR, nightly, before release).
