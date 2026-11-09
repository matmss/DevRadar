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
cp .env.example .env   # MONGO_URI; for sign-in also GITHUB_CLIENT_ID/SECRET and JWT_SECRET (see the file)
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
`dev/backend/src/app.js` (`createApp` / `createServer`) assembles everything in one fixed order —
trust proxy, CORS, JSON body parsing, routes, JSON 404, global error handler — and wraps it in a
raw `http.Server` (not `app.listen`) so Socket.io (`setupWebsocket(server)`) shares the port.
`index.js` and **both test harnesses** (`qa/backend-tests/.../testApp.js`,
`qa/web-tests/.../backend-server.js`) call it, so middleware order can't drift between prod and
tests. Every error, including unknown routes, is JSON `{ error, code, details }`
(`middleware/errorHandler.js`, BUG-012); it never returns stacks and never logs request bodies.
Routes (`dev/backend/src/routes.js`):

- **Auth** (`AuthController`, spec in `dev/docs/03-auth-spec.md`, details in
  `dev/docs/00-architecture.md`): `GET /auth/github` (PKCE S256 required, redirect allow-listed)
  → `GET /auth/github/callback` → client gets a 60 s one-time code → `POST /auth/token`
  (`code` + `code_verifier`) → 7-day HS256 JWT. `GET /auth/me` is behind `requireAuth`
  (`middleware/auth.js`; 401 codes `token_missing`/`token_expired`/`token_invalid`). State,
  codes and rate-limit counters are in memory (single instance). Env: see `dev/backend/.env.example`.
  **As of auth slices 2+3, `POST /devs` requires a token; `GET /devs`, `/search` and the socket are
  still public until slice 4.** The JWT carries a sanitized, size-capped `profile` claim
  (`utils/githubProfile.js`; keep tokens well under 2048 bytes, the `expo-secure-store` limit).

- `POST /devs` (`DevController.store`, behind `requireAuth`) — registers **the signed-in user**:
  the username and `name`/`avatar_url`/`bio` come from the token (`req.user`, captured from
  GitHub's `/user` at sign-in); a body `github_username` is ignored, and there is **no GitHub API
  call** at registration any more. Input is validated by `utils/validateDevInput.js` (400 with
  `{ error, details[] }`). The dev is created with one atomic `findOneAndUpdate` upsert, backed by
  a **unique case-insensitive index on `github_username`** (`models/Dev.js`, collation
  `{locale:'en', strength:2}`); a lost race (E11000) returns the existing dev, and only the
  request that created the dev pushes `new-dev` (`websocket.findConnections()` + `sendMessage()`)
  to nearby, tech-matching sockets. An already registered user gets their dev back unchanged.
  If legacy case-duplicates block the index build, `index.js` logs it and keeps running.
- `GET /search` (`SearchController.index`) — Mongo `$near` geo query on the `Dev.location`
  `2dsphere` index (`dev/backend/src/models/Dev.js`), `$maxDistance: NEARBY_RADIUS_METERS`, filtered by
  `techs: { $in: techsArray }`. Query params are validated (400 on missing/invalid).
- `dev/backend/src/websocket.js` holds an in-memory `connections` array (id, coordinates, techs)
  populated on socket `connection` handshake query params (validated; invalid sockets are
  disconnected, entries removed on `disconnect`, see BUG-010/011), and filters them with `isNearby()`.
  **The "nearby" radius lives in one place, `dev/backend/src/utils/nearby.js`**
  (`NEARBY_RADIUS_METERS`, `isNearby`), used by both `/search` and the websocket. `isNearby`
  mirrors MongoDB's `$maxDistance` exactly: inclusive (`<=`), and `calculateDistance` uses
  MongoDB's 2dsphere Earth radius (6378.1 km, not 6371). Keep it that way, or the live push
  and the search disagree at the edge (BUG-002, fixed; guarded by `qa/backend-tests/features/radius.feature`).
- `techs` arrives everywhere as a comma-separated string and is normalized via
  `parseStringAsArray` (trims each entry, drops empty ones) — the same function is reused in the controller and
  the websocket handshake parsing; keep them consistent if you change the format.

### Client responsibilities
- `dev/web/` (`dev/web/src/App.js`): GitHub sign-in (PKCE, `services/auth.js`; token in
  localStorage `devradar.session_token`, followed across tabs via the `storage` event; callback
  route `/auth/callback`), then the registration form (no username field) and a flat list from
  `/devs` — no map. Every 401 signs out. A deployed build needs an SPA fallback so
  `/auth/callback` serves `index.html` (see `dev/web/.env.example`). "Sair" is local only: tokens
  can't be revoked server-side.
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
  — needed because `2dsphere` geo queries can't be faithfully mocked). `nock` stubs
  GitHub's OAuth token exchange and `GET /user` (`support/github-mock.js`); nothing stubs
  `/users/*`, so any registration-time GitHub lookup fails the scenario.
- `qa/web-tests/` — Playwright + `playwright-bdd`. `playwright.config.js` boots a **real**
  backend + real ephemeral Mongo via `features/support/global-setup.js` (see
  `INTEGRATION_BACKEND_PORT`) and the real CRA dev server — deliberately no `page.route`
  mocking; only GitHub and browser geolocation (`context.setGeolocation`) are faked: nock for
  GitHub's server-side OAuth API, `context.route` for the authorize page and avatar images, and
  a hook (`support/github-network.js`) fails any scenario whose browser reaches real GitHub.
  Runs with `workers: 1` (scenarios share one backend and its `/__test__` reset).
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
- Known **open** issues worth checking before you "fix" related behavior yourself:
  BUG-006 (GitHub sign-in in progress, delivered in slices per `dev/docs/03-auth-spec.md`. CORS is already
  restricted: browser origins must be in `CORS_ORIGINS`, see `dev/backend/src/config/cors.js`,
  which both Express and Socket.io use. Requests with no `Origin`, like the native mobile app,
  are unaffected. If you add a web client origin, add it there), BUG-008 (`update`/`destroy` are stubbed/commented out in `SearchController`,
  not implemented), BUG-009 (Detox timeout, above). Full detail and status in
  `qa/docs/05-bug-tracker.md`.
