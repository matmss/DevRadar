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

## App assembly and errors

- `backend/src/app.js` builds the Express app (`createApp`) and the HTTP server Socket.io
  shares (`createServer`): `trust proxy` (from `TRUST_PROXY`), CORS, JSON body, routes, then
  the global error handler. `index.js` and both test harnesses
  (`qa/backend-tests/features/support/testApp.js`, `qa/web-tests/features/support/backend-server.js`)
  use it, so the wiring cannot drift. The web harness mounts its `/__test__` seed routes
  through the `beforeRoutes` option.
- **Error handler** (`middleware/errorHandler.js`, BUG-012): every route answers errors as
  `{ error, code, details }`, never Express's HTML page with a stack trace.
  `body_invalid` (400, malformed JSON), `body_too_large` (413, over 100 kb),
  `request_invalid` (any other 4xx), `internal_error` (500, no message or stack).
  Body-parser errors log only `err.type`, never the raw body or the parse message (which
  quotes the input); other 500s log the stack server-side.
- **`TRUST_PROXY`** (`config/proxy.js`): off by default, so `req.ip` is the socket address and
  a client cannot choose its rate-limit key by sending `X-Forwarded-For`. Behind a reverse
  proxy, set the hop count (`1`), a comma-separated list of trusted addresses/subnets
  (`loopback,10.0.0.0/8`), or `true` (every hop; only if the proxy overwrites the header).

## Authentication

GitHub sign-in, per `dev/docs/03-auth-spec.md`. **Slice 1 status:** the auth endpoints and
the `requireAuth` middleware exist, but only `GET /auth/me` uses it; `/devs`, `/search` and
the socket are still public until slices 2 and 4.

- **Flow** (`backend/src/controllers/AuthController.js`, routes in `routes.js`). Every
  client (web and mobile) uses PKCE (RFC 7636, `utils/pkce.js`) with the backend: it makes a
  random `code_verifier` (43-128 unreserved characters), keeps it, and sends only
  `code_challenge = BASE64URL(SHA256(code_verifier))`. This binds the one-time code to the
  client that started sign-in, so a forwarded callback URL (login CSRF) or an intercepted
  `devradar://` redirect is useless without the verifier.
  1. `GET /auth/github?redirect=<client url>&code_challenge=<challenge>&code_challenge_method=S256`:
     checks `redirect` against the allow-list (`utils/redirectAllowList.js`: any path on a
     `CORS_ORIGINS` origin, or the `MOBILE_APP_SCHEME` custom scheme), requires a base64url
     `code_challenge` of 43-128 characters and the method `S256` (no `plain`), stores a random
     single-use `state` (10 min) with the redirect and challenge, and redirects 302 to
     GitHub's authorize URL with no `scope` (public profile only).
  2. `GET /auth/github/callback?code&state`: a missing, unknown, expired or reused `state`
     answers 400 JSON (the client's redirect is not known yet). Otherwise the state is
     consumed and the browser always goes back to the client with a 302:
     - success: exchanges `code` at GitHub, reads `GET https://api.github.com/user`, drops the
       GitHub access token, then `<redirect>?code=<one-time code>` (single use, 60 s, carries
       the challenge);
     - `error=access_denied`: `<redirect>?error=sign_in_cancelled`;
     - any other failure: `<redirect>?error=sign_in_failed&reason=<reason>`, where `reason` is
       `github_error` (another GitHub `error`), `github_code_missing`, `github_unavailable`
       (GitHub rejected the code, 5xx or unreachable) or `github_rate_limited`.
  3. `POST /auth/token` `{ code, code_verifier }`: consumes the one-time code first, then
     checks `BASE64URL(SHA256(code_verifier))` against the stored challenge with a
     timing-safe compare. A missing or wrong verifier is a 400 and the code is spent (sign in
     again). On success: `{ token, token_type: "Bearer", expires_in, user: { github_username,
     name, avatar_url } }`. The session token never appears in a URL.
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
- **JSON error codes** on `/auth/*` (body `{ error, code, details }`):

  | Status | `code` | When |
  |---|---|---|
  | 400 | `redirect_invalid` | `redirect` missing or not allow-listed |
  | 400 | `code_challenge_invalid` | `code_challenge` missing or not 43-128 base64url chars |
  | 400 | `code_challenge_method_invalid` | `code_challenge_method` is not `S256` |
  | 400 | `state_missing`, `state_invalid` | callback state missing / unknown, expired or reused |
  | 400 | `code_missing`, `code_invalid` | `POST /auth/token` code missing / unknown, expired or reused |
  | 400 | `code_verifier_missing`, `code_verifier_invalid` | verifier missing / malformed or not matching (code is spent) |
  | 401 | `token_missing`, `token_expired`, `token_invalid` | `requireAuth` |
  | 429 | `rate_limited` | rate limit hit |
  | 503 | `not_configured` | GitHub credentials not set |

  Plus the app-wide `body_invalid`, `body_too_large`, `request_invalid`, `internal_error`.
- **Rate limits** (`middleware/rateLimit.js`, `express-rate-limit`), per client IP
  (`req.ip`, see `TRUST_PROXY`) per 15 minutes, two independent limiters:
  sign-in (`GET /auth/github`, the callback, `POST /auth/token`): `AUTH_RATE_LIMIT_MAX`,
  default 60 (a sign-in uses 3); session checks (`GET /auth/me`, called on every client
  load): `AUTH_SESSION_RATE_LIMIT_MAX`, default 600.
- **Config** (`config/auth.js`, read from env on each use): `GITHUB_CLIENT_ID`,
  `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL` (default
  `http://localhost:3333/auth/github/callback`), `JWT_SECRET`, `MOBILE_APP_SCHEME` (default
  `devradar`). With `NODE_ENV=production`, `index.js` refuses to start unless the client id,
  client secret and a `JWT_SECRET` of at least 32 characters are set. Outside production a
  missing `JWT_SECRET` falls back to a random per-process secret (sessions reset on restart),
  and `GET /auth/github` answers 503 until the GitHub credentials are set. Secrets and tokens
  are never logged or returned.
- **`MOBILE_APP_SCHEME`** is an allow-list of shape: `^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$`
  (e.g. `devradar`, `com.devradar.app`), and `http`, `https`, `intent`, `exp`, `exps`,
  `javascript`, `data`, `file`, `ftp`, `ws`, `wss`, `about`, `blob`, `content`, `vbscript`,
  `chrome` are refused (they resolve to web pages, scripts or other apps, e.g. Android's
  `intent://` opens arbitrary https URLs). A refused or invalid value disables mobile
  redirects, and startup logs a warning that does not print the value.
- **Single-instance limitation:** the `state` store, the one-time code store
  (`utils/oneTimeStore.js`) and the rate-limit counters live in process memory. Running more
  than one backend instance needs sticky sessions or a shared store (e.g. Redis) first.

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
