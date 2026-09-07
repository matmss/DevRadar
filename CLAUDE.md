# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DevRadar: developers register their location + GitHub-derived tech stack, and discover
nearby devs on a map in real time. Four independent npm projects, no monorepo tooling
(no Lerna/Turborepo/Nx) — each has its own `package.json` and is installed/run separately:

- `dev/backend/` — Node.js, Express 5, Mongoose 9 (MongoDB), Socket.io 4
- `dev/web/` — React 18 (Create React App)
- `dev/mobile/` — React Native / Expo SDK 57
- `qa/` — the test suites for all three of the above (own workspace, see below)

## Commands

### Backend (`dev/backend/`)
```bash
cp .env.example .env   # set MONGO_URI (Atlas or local), optionally PORT
npm install
npm run dev             # nodemon src/index.js, port 3333 by default
```
No lint/build/test scripts are defined in `dev/backend/package.json` — its tests live entirely
under `qa/backend-tests/`.

### Web (`dev/web/`)
```bash
cp .env.example .env   # REACT_APP_API_URL, defaults to http://localhost:3333
npm install
npm start                # CRA dev server, port 3000
npm run build
npm test                  # CRA/Jest unit tests (none currently written beyond CRA's default)
```

### Mobile (`dev/mobile/`)
```bash
cp .env.example .env   # EXPO_PUBLIC_API_URL, defaults to http://localhost:3333
npm install
npm start                # expo start
npm run android / ios / web
```
`dev/mobile/android` was generated via `expo prebuild` (Expo SDK 57) and is checked in.

### QA (`qa/` — separate npm workspace, install here too)
```bash
cd qa
npm install               # sets up the backend-tests/web-tests/mobile-tests workspaces
npm run test:backend      # Cucumber.js against dev/backend/src, in-process (supertest + mongodb-memory-server)
npm run test:web          # Playwright + playwright-bdd, real backend+Mongo, only GitHub API mocked
npm run test:mobile       # prints guidance, then runs Maestro (Detox needs a simulator/emulator)
npm run test:all          # == bash run-all-tests.sh — runs all three, merges into reports/index.html
npm run test:smoke        # @smoke-tagged scenarios only (backend + web)
npm run test:regression   # @regression-tagged scenarios only (backend + web)
```
Single-suite tag filtering (run from inside the relevant `qa/*-tests/` dir):
```bash
cd qa/backend-tests && npx cucumber-js --tags '@smoke'
cd qa/backend-tests && npm run unit              # plain Jest: calculateDistance, parseStringAsArray
cd qa/web-tests && npx bddgen && npx playwright test --grep @smoke
cd qa/mobile-tests && npm run maestro            # maestro test maestro/ — no simulator needed
```
`run-all-tests.sh` accepts `TAGS="@smoke" ./run-all-tests.sh` and `RUN_MOBILE=true` (mobile
is opt-in since it needs a simulator/emulator or the Maestro CLI).

## Architecture

### Backend request/data flow
`dev/backend/src/index.js` boots Express on a raw `http.Server` (not `app.listen`) specifically
so Socket.io can share the same port — `setupWebsocket(server)` is called before `routes` is
mounted. Two routes only (`dev/backend/src/routes.js`):

- `POST /devs` (`DevController.store`) — if `github_username` isn't already in Mongo, calls
  the **real GitHub Users API** (`GET https://api.github.com/users/:username`, unauthenticated,
  60 req/hr) to populate `name`/`avatar_url`/`bio`, persists a GeoJSON `Point`, then calls
  `websocket.findConnections()` + `sendMessage()` to push a `new-dev` event to nearby,
  tech-matching connected sockets. **No input validation and no try/catch around the GitHub
  call** — see BUG-003/004/005 in `qa/docs/05-bug-tracker.md` before assuming bad input fails
  gracefully.
- `GET /search` (`SearchController.index`) — Mongo `$near` geo query on the `Dev.location`
  `2dsphere` index (`dev/backend/src/models/Dev.js`), `$maxDistance: 10000` meters, filtered by
  `techs: { $in: techsArray }`.
- `dev/backend/src/websocket.js` holds an in-memory `connections` array (id, coordinates, techs)
  populated on socket `connection` handshake query params, and does its own independent
  10km proximity check (`calculateDistance(...) < 10`) — **this radius logic is duplicated
  and inconsistent with `/search`'s `$maxDistance: 10000`** (BUG-002: one is likely inclusive
  meters, the other is strict-less-than km). If you touch the "nearby" radius, fix both.
- `techs` arrives everywhere as a comma-separated string and is normalized via
  `parseStringAsArray` (trims each entry) — the same function is reused in the controller and
  the websocket handshake parsing; keep them consistent if you change the format.

### Client responsibilities
- `dev/web/` is registration + a flat list only (`dev/web/src/App.js`) — no map, calls `/devs`.
- `dev/mobile/src/pages/Main.js` is the map experience: `expo-location` for device position →
  `GET /search` → renders `react-native-maps` markers → opens a Socket.io connection scoped
  to the current map region (`services/socket.js`) to receive live `new-dev` pushes.
  `dev/mobile/src/pages/Profile.js` is just a `WebView` pointed at the dev's GitHub profile URL —
  there's no native profile screen.
- Both web and mobile read their backend URL from an env var with a `localhost:3333`
  fallback: `REACT_APP_API_URL` (web, CRA convention) / `EXPO_PUBLIC_API_URL` (mobile, Expo's
  native convention, inlined at build time — restart the bundler after changing it).

### QA workspace structure
`qa/` mirrors the three app layers 1:1, each suite matched to that layer's actual stack
rather than a single cross-language framework:

- `qa/backend-tests/` — Cucumber.js `.feature` + step definitions, driving the real Express
  `app` in-process via `supertest` against a real ephemeral MongoDB (`mongodb-memory-server`
  — needed because `2dsphere` geo queries can't be faithfully mocked). `nock` stubs the
  GitHub API so functional runs are deterministic and don't burn the rate limit.
- `qa/web-tests/` — Playwright + `playwright-bdd`. `playwright.config.js` boots a **real**
  backend + real ephemeral Mongo via `features/support/global-setup.js` (see
  `INTEGRATION_BACKEND_PORT`) and the real CRA dev server — deliberately no `page.route`
  mocking; only GitHub's API and browser geolocation (`context.setGeolocation`) are faked.
  Run `bddgen` before `playwright test` (or use the `pretest`/`test:*` npm scripts, which do
  it automatically) — it compiles `.feature` files into Playwright test files.
- `qa/mobile-tests/` — Detox + `jest-cucumber` is the intended primary suite
  (`.detoxrc.js` targets `Pixel_6a_API_34` emulator / `iPhone 15` simulator), but per
  BUG-009 the Detox run currently times out on `device.launchApp` (suspected host resource
  contention, not a real app defect) — treat Detox failures as environment-suspect until
  re-verified on an uncontended machine. `maestro/*.yaml` are black-box fallback flows that
  work without a Detox toolchain and match by visible text/testID.
- Backend/web `.feature` files carry `@smoke` / `@regression` / `@edge` / `@P1`/`@P2` tags
  (see `qa/docs/04-qa-process.md` for the full convention) — use `--tags`/`--grep` to filter,
  as shown above.
- `qa/docs/01` through `07` are the requirements → scenarios → test cases → process → bug
  tracker → framework rationale → live report chain, in that reading order; `01-requirements.md`
  was reverse-engineered from the code (there's no separate product spec), so treat it as
  descriptive, not aspirational.
- Known **open** issues worth checking before you "fix" related behavior yourself: BUG-002
  (radius mismatch, above), BUG-003/004/005 (`POST /devs` has no validation and no error
  handling around the GitHub call), BUG-006 (no auth, CORS fully open — accepted risk for
  this project), BUG-008 (`update`/`destroy` are stubbed/commented out in `SearchController`,
  not implemented), BUG-009 (Detox timeout, above). Full detail and status in
  `qa/docs/05-bug-tracker.md`.
