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
                                        GitHub OAuth + GET /user
                                        (sign-in only: login, name,
                                         avatar, bio)
```

## Backend (`backend/`)

- **Framework:** Express 5, no ORM abstraction beyond Mongoose itself.
- **Data model:** single `Dev` collection (`backend/src/models/Dev.js`) —
  `name`, `github_username`, `bio`, `avatar_url`, `techs: [String]`, and a
  GeoJSON `location` field with a `2dsphere` index for radius queries.
- **Routes** (`backend/src/routes.js`):
  - `GET /devs` — list all devs (`DevController.index`)
  - `POST /devs` — register the signed-in dev (session token required, see
    Authentication); on first registration creates the dev from the profile
    captured at sign-in, then broadcasts it over the socket to any connected
    client whose search radius/techs match (`DevController.store`)
  - `GET /search` — geo + tech-filtered search using `$near` +
    `$maxDistance` (`SearchController.index`)
- **Realtime:** `backend/src/websocket.js` tracks connected sockets by
  their query params (lat/long/techs) and pushes `new-dev` events to
  matching clients — this is what makes the map update live without a
  page refresh.
- **External dependency:** GitHub is only called during sign-in (OAuth token
  exchange, then `GET https://api.github.com/user` with the user's access
  token). Registration makes no GitHub call, so the unauthenticated 60 req/hr
  limit no longer applies to it. `qa/backend-tests` and the web harness mock
  GitHub with `nock` rather than hitting the real API.

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

GitHub sign-in, per `dev/docs/03-auth-spec.md`. **Status (slices 1-3):** the auth endpoints,
the `requireAuth` middleware, protected `POST /devs` (US-3) and web sign-in (US-6, without
update/delete) exist. `GET /devs`, `GET /search` and the socket stay public until slice 4;
mobile sign-in also comes with slice 4.

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
     - success: exchanges `code` at GitHub, reads `GET https://api.github.com/user` (login and
       public profile), drops the GitHub access token, then `<redirect>?code=<one-time code>`
       (single use, 60 s, carries the challenge and the sanitized profile);
     - `error=access_denied`: `<redirect>?error=sign_in_cancelled`;
     - any other failure: `<redirect>?error=sign_in_failed&reason=<reason>`, where `reason` is
       `github_error` (another GitHub `error`), `github_code_missing`, `github_unavailable`
       (GitHub rejected the code, 5xx or unreachable) or `github_rate_limited`.
  3. `POST /auth/token` `{ code, code_verifier }`: consumes the one-time code first, then
     checks `BASE64URL(SHA256(code_verifier))` against the stored challenge with a
     timing-safe compare. A missing or wrong verifier is a 400 and the code is spent (sign in
     again). On success: `{ token, token_type: "Bearer", expires_in, user: { github_username,
     name, avatar_url } }`. The session token never appears in a URL.
  4. `GET /auth/me` (Bearer token): `{ github_username, name, avatar_url }`, answered from the
     token alone (no database or GitHub call). Clients call it on load to show who is signed in.
- **Session token** (`utils/sessionToken.js`): HS256 JWT signed with `JWT_SECRET`,
  `sub` = GitHub login, `iss` = `devradar`, `exp` = 7 days, no refresh token, and a required
  `profile` claim `{ name, avatar_url, bio }` (see "Registration identity and profile" below).
  A token without a well-formed `profile` claim, including any token issued by slice 1, is
  `token_invalid`, so those clients sign in again.
  `verifySessionToken(token)` never throws and is exported for the Socket.io handshake
  (also re-exported as `verifyToken` from `middleware/auth.js`).
- **`requireAuth`** (`middleware/auth.js`): reads `Authorization: Bearer <token>`, sets
  `req.user = { github_username, profile }`, or answers 401 with a `WWW-Authenticate` header and
  `{ error, code, details }`. Clients switch on `code`:
  `token_missing`, `token_expired` (show "Session expired, sign in again"), `token_invalid`.
  The signature is checked before expiry, so a forged expired token is `token_invalid`.
- **Registration identity and profile** (US-3, `DevController.store`, `utils/githubProfile.js`).
  `POST /devs` uses `requireAuth`. The dev is `req.user.github_username`; a `github_username` in
  the body is ignored (Q9) and not validated, and techs/latitude/longitude are validated as
  before (400 `{ error, details }`). An existing dev, matched case-insensitively (including a
  legacy profile created before sign-in in another letter case, US-8), is returned unchanged; a
  new one is created and pushed as `new-dev` as before.
  - **Profile source:** the authenticated `GET /user` response read in the callback (product
    owner decision). It is sanitized and signed into the session token as the `profile` claim:
    control, line/paragraph-separator and bidi-override characters become spaces, values are
    trimmed (empty becomes `null`), `name` is cut to 255 and `bio` to 300 code points,
    `avatar_url` is kept only if it is an absolute `https` URL without credentials (max 512),
    and every other field is dropped. Verification rejects a `profile` claim that is not exactly
    this shape, so it cannot carry anything the backend did not produce. A `null` name falls
    back to the login when the dev is created.
  - **Why claims in the token rather than a server-side record:** the token is already signed
    and verified on every request, so the profile reaches registration with no extra storage,
    no new collection and no cleanup, and it works across backend instances (unlike the
    in-memory state/code stores). It adds about 200-500 bytes to a token that is only sent to
    our own API. The profile is public GitHub data, so it being readable in the JWT exposes
    nothing new. The GitHub access token is still never stored or put in the token.
  - **Snapshot as of sign-in:** a name, avatar or bio changed on GitHub after sign-in only shows
    up in a profile created after the next sign-in (up to 7 days later). An existing dev is not
    refreshed (updates come with slice 5, `PUT /devs/me`).
  - **No GitHub call at registration:** the old unauthenticated `GET /users/:username` lookup
    and its 404/503/502 mapping are removed, so registration is not subject to GitHub's 60
    req/hr limit or outages. `qa/backend-tests` fails any scenario that calls
    `api.github.com/users/*`.
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
  An axios request interceptor adds `Authorization: Bearer <token>` when a
  session exists; a response interceptor treats any 401 with code
  `token_expired`, `token_invalid` or `token_missing` as the end of the
  session (token cleared, signed-out view; "Sessão expirada, entre novamente"
  for `token_expired`).
- Talks to the same `/devs` and `/search` endpoints as mobile, plus the
  `/auth/*` endpoints; no web-specific backend routes exist. Nothing secret is
  in the bundle: only `REACT_APP_API_URL`.
- **Sign-in flow** (US-6, `web/src/services/auth.js`, `services/pkce.js`):
  1. "Entrar com GitHub" makes a 32-byte random PKCE verifier
     (`crypto.getRandomValues`, base64url, 43 characters) and its S256 challenge
     (`crypto.subtle.digest`), stores the verifier in `sessionStorage`
     (`devradar.pkce_verifier`), and navigates to
     `<API_URL>/auth/github?redirect=<web origin>/auth/callback&code_challenge=...&code_challenge_method=S256`.
     Web Crypto needs a secure context: https in production (`http://localhost` works in
     development).
  2. The backend sends the browser back to the fixed callback path `/auth/callback` with
     `?code=` or `?error=sign_in_cancelled|sign_in_failed&reason=`. The app reads those values,
     then immediately replaces the URL with `/` (`history.replaceState`) and removes the
     verifier, before the exchange, so neither can be reused or left in history.
  3. It exchanges `{ code, code_verifier }` at `POST /auth/token` and keeps the token.
  Nothing from the callback URL is used as a navigation target (the app always returns to `/`),
  and `reason` is only a lookup key for a fixed message, never rendered. A callback without a
  stored verifier (e.g. a link forwarded from another browser) fails without calling the
  backend. Hosting the production build needs the usual SPA fallback so `/auth/callback`
  serves `index.html` (the CRA dev server already does this).
- **Views:** signed out, only the sign-in button (plus a message after "Login cancelado", a
  failure, or an expired session; the button is also the retry). Signed in, the GitHub username
  and avatar (from `POST /auth/token`, then `GET /auth/me` on every load), "Sair", the
  registration form without a username field, and the dev list. "Sair" clears the token and
  shows the signed-out view; there is no server-side logout (tokens are stateless and expire
  after 7 days).
- **Token storage** (`web/src/services/session.js`): `localStorage`
  (`devradar.session_token`), so the session survives reloads and tabs. Trade-off: any script on
  the origin can read it, so an XSS bug would leak a token that stays valid until it expires (no
  revocation). An httpOnly cookie would hide it from scripts, but the API is Bearer-based (no
  cookies, so no CSRF surface) and shared with mobile. Mitigations: React escaping, no
  `dangerouslySetInnerHTML`, no third-party scripts, the token holds no GitHub credentials, and
  serving the build with a strict Content-Security-Policy is recommended.

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

1. A signed-in client (web today) submits `POST /devs` with its session
   token and `techs`, `latitude`, `longitude`.
2. Backend takes the GitHub login from the token and checks if that dev
   already exists (case-insensitive); if not, builds the dev from the profile
   captured at sign-in (no GitHub call), turns the submitted lat/long into a
   GeoJSON point, and persists the `Dev`.
3. Backend computes which currently-connected sockets have a search radius
   and tech filter that the new dev matches, and emits `new-dev` to just
   those sockets.
4. Any client with an open socket connection whose filters match sees the
   new dev appear on their map without polling or refreshing.

## Known architectural constraints worth designing around

- **Reads not protected yet.** Registration requires sign-in, but
  `GET /devs`, `GET /search` and the socket stay public until slice 4.
- **Profile is a sign-in snapshot.** Registration uses the GitHub profile as
  of sign-in, and existing devs are never refreshed from GitHub (profile
  updates come with slice 5).
- **Single MongoDB collection, no pagination.** `GET /devs` returns
  everything. Fine at seed-data scale; will need pagination or a stricter
  default radius before this is a real dataset.
