# DevRadar — Architecture

This document describes the system as it exists in code today. For QA-side
docs (requirements, test scenarios/cases, process, framework selection) see
`qa/docs/`. This is the dev-facing counterpart: what the system *is*, not
how it's tested.

## System overview

Three layers, one shared backend:

```
┌─────────────┐      HTTP (REST)       ┌──────────────────┐
│   web/      │ ─────────────────────▶ │                  │
│  React      │ ◀───────────────────── │    backend/      │      ┌────────────┐
└─────────────┘      WebSocket         │  Express +       │ ───▶ │  MongoDB   │
                                        │  Mongoose +      │      │ (2dsphere  │
┌─────────────┐      HTTP (REST)       │  Socket.io       │      │  geo index)│
│  mobile/    │ ─────────────────────▶ │                  │      └────────────┘
│  Expo/RN    │ ◀───────────────────── │                  │
└─────────────┘      WebSocket         └────────┬─────────┘
                                                  │
                                                  ▼
                                        GitHub Users API
                                        (github_username → name, avatar,
                                         bio, on first dev registration)
```

## Backend (`backend/`)

- **Framework:** Express 5, no ORM abstraction beyond Mongoose itself.
- **Data model:** single `Dev` collection (`backend/src/models/Dev.js`) —
  `name`, `github_username`, `bio`, `avatar_url`, `techs: [String]`, and a
  GeoJSON `location` field with a `2dsphere` index for radius queries.
- **Routes** (`backend/src/routes.js`):
  - `GET /devs` — list all devs (`DevController.index`)
  - `POST /devs` — register a dev; looks up GitHub profile data on first
    registration, then broadcasts the new dev over the socket to any
    connected client whose search radius/techs match (`DevController.store`)
  - `GET /search` — geo + tech-filtered search using `$near` +
    `$maxDistance` (`SearchController.index`)
- **Realtime:** `backend/src/websocket.js` tracks connected sockets by
  their query params (lat/long/techs) and pushes `new-dev` events to
  matching clients — this is what makes the map update live without a
  page refresh.
- **External dependency:** the GitHub Users API is called synchronously
  inside `POST /devs`. It's unauthenticated (no token), so it's subject to
  GitHub's 60 req/hr unauthenticated rate limit — worth keeping in mind for
  both production load and why `qa/backend-tests` mocks it with `nock`
  rather than hitting the real API.

## Authentication

GitHub sign-in, per `dev/docs/03-auth-spec.md`. **Slice 1 status:** the auth endpoints and
the `requireAuth` middleware exist, but only `GET /auth/me` uses it; `/devs`, `/search` and
the socket are still public until slices 2 and 4.

- **Flow** (`backend/src/controllers/AuthController.js`, routes in `routes.js`):
  1. `GET /auth/github?redirect=<client url>`: checks `redirect` against the allow-list
     (`utils/redirectAllowList.js`: any path on a `CORS_ORIGINS` origin, or the
     `MOBILE_APP_SCHEME` custom scheme), stores a random single-use `state` (10 min), and
     redirects 302 to GitHub's authorize URL with no `scope` (public profile only).
  2. `GET /auth/github/callback?code&state`: consumes the `state` (missing/unknown/expired/
     reused gives 400), exchanges `code` at GitHub, reads `GET https://api.github.com/user`,
     drops the GitHub access token, and redirects 302 to `<redirect>?code=<one-time code>`.
     `error=access_denied` redirects to `<redirect>?error=sign_in_cancelled` instead.
  3. `POST /auth/token` `{ code }`: trades the one-time code (single use, 60 s) for
     `{ token, token_type: "Bearer", expires_in, user: { github_username, name, avatar_url } }`.
     The session token never appears in a URL.
  4. `GET /auth/me` (Bearer token): `{ github_username }`.
- **Session token** (`utils/sessionToken.js`): HS256 JWT signed with `JWT_SECRET`,
  `sub` = GitHub login, `iss` = `devradar`, `exp` = 7 days, no refresh token.
  `verifySessionToken(token)` never throws and is exported for the Socket.io handshake
  (also re-exported as `verifyToken` from `middleware/auth.js`).
- **`requireAuth`** (`middleware/auth.js`): reads `Authorization: Bearer <token>`, sets
  `req.user = { github_username }`, or answers 401 with a `WWW-Authenticate` header and
  `{ error, code, details }`. Clients switch on `code`:
  `token_missing`, `token_expired` (show "Session expired, sign in again"), `token_invalid`.
  The signature is checked before expiry, so a forged expired token is `token_invalid`.
- **Other error codes** on `/auth/*`: `redirect_invalid`, `state_missing`, `state_invalid`,
  `github_code_missing`, `code_missing`, `code_invalid` (400); `github_error`,
  `github_unavailable` (502); `github_rate_limited`, `not_configured` (503);
  `rate_limited` (429).
- **Rate limit** (`middleware/rateLimit.js`, `express-rate-limit`): `AUTH_RATE_LIMIT_MAX`
  requests (default 60) per IP per 15 minutes across all `/auth/*` routes.
- **Config** (`config/auth.js`, read from env on each use): `GITHUB_CLIENT_ID`,
  `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL` (default
  `http://localhost:3333/auth/github/callback`), `JWT_SECRET`, `MOBILE_APP_SCHEME` (default
  `devradar`). With `NODE_ENV=production`, `index.js` refuses to start unless the client id,
  client secret and a `JWT_SECRET` of at least 32 characters are set. Outside production a
  missing `JWT_SECRET` falls back to a random per-process secret (sessions reset on restart),
  and `GET /auth/github` answers 503 until the GitHub credentials are set. Secrets and tokens
  are never logged or returned.
- **Single-instance limitation:** the `state` store, the one-time code store
  (`utils/oneTimeStore.js`) and the rate-limit counters live in process memory. Running more
  than one backend instance needs sticky sessions or a shared store (e.g. Redis) first. Behind
  a reverse proxy, configure Express `trust proxy` or every client shares one rate-limit key.

## Web (`web/`)

- **Framework:** Create React App.
- **API access:** `web/src/services/api.js`, reads `REACT_APP_API_URL`
  (CRA's required env var prefix) with a `localhost:3333` fallback for dev.
- Talks to the same `/devs` and `/search` endpoints as mobile; no
  web-specific backend routes exist.

## Mobile (`mobile/`)

- **Framework:** Expo SDK 57 / React Native.
- **API access:** `mobile/src/services/api.js` and `services/socket.js`,
  read `EXPO_PUBLIC_API_URL` (Expo's build-time-inlined env var prefix,
  supported SDK 49+) with a `localhost:3333` fallback.
  - This was previously hardcoded to a developer's LAN IP (BUG-001), which
    blocked CI entirely. Fixed — see `mobile/.env.example`.
- **Location:** uses `expo-location` for the device's current position,
  which becomes the center point for both the map view and the
  `latitude`/`longitude` query params sent to `/search` and the socket
  connection.

## Data flow: registering a dev and seeing it live elsewhere

1. Client (web or mobile) submits `POST /devs` with `github_username`,
   `techs`, `latitude`, `longitude`.
2. Backend checks if that `github_username` already exists; if not, fetches
   profile data from GitHub, geocodes the submitted lat/long into a GeoJSON
   point, and persists the `Dev`.
3. Backend computes which currently-connected sockets have a search radius
   and tech filter that the new dev matches, and emits `new-dev` to just
   those sockets.
4. Any client with an open socket connection whose filters match sees the
   new dev appear on their map without polling or refreshing.

## Known architectural constraints worth designing around

- **Auth not enforced yet.** GitHub sign-in exists (see Authentication),
  but until slice 2 any client can still register a dev as anyone (no
  verification that the submitter owns the `github_username` claimed).
- **Unauthenticated GitHub API calls.** Rate-limited at 60/hr per backend
  IP. A `GITHUB_TOKEN` env var + authenticated requests would raise this to
  5,000/hr if registration volume ever becomes a bottleneck.
- **Single MongoDB collection, no pagination.** `GET /devs` returns
  everything. Fine at seed-data scale; will need pagination or a stricter
  default radius before this is a real dataset.
