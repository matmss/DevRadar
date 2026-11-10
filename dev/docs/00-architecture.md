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
  GeoJSON `location` field with a `2dsphere` index for radius queries, plus a
  unique case-insensitive index on `github_username` (one dev per GitHub login,
  see Authentication, "Registration identity and profile").
- **Routes** (`backend/src/routes.js`). Everything that shows or changes devs needs a session
  token (see Authentication); only `/auth/*` is public.
  - `GET /devs` — list all devs (`DevController.index`, session token required)
  - `POST /devs` — register the signed-in dev (session token required, see
    Authentication); on first registration creates the dev from the profile
    captured at sign-in, then broadcasts it over the socket to any connected
    client whose search radius/techs match (`DevController.store`)
  - `GET /devs/me`, `PUT /devs/me`, `DELETE /devs/me` — read, update and
    delete the signed-in user's own dev (`DevController.show`/`update`/`destroy`,
    session token required, see Authentication, "Own profile")
  - `GET /search` — geo + tech-filtered search using `$near` +
    `$maxDistance` (`SearchController.index`, session token required)
- **Realtime:** `backend/src/websocket.js` tracks connected sockets by
  their handshake query params (lat/long/techs) and pushes events to
  matching clients — this is what makes the map update live without a
  page refresh. Only signed-in clients can subscribe (see Authentication,
  "Socket.io handshake"). Events, each sent only to the sockets whose
  position (10 km, `utils/nearby.js`) and techs match the dev
  (`findConnections`):

  | Event | When | Matched against | Payload |
  |---|---|---|---|
  | `new-dev` | `POST /devs` created a dev | its position and techs | the dev |
  | `dev-updated` | `PUT /devs/me` succeeded | the **new** position and techs (Q4) | the updated dev |
  | `dev-deleted` | `DELETE /devs/me` succeeded | the last position and techs | `{ _id, github_username }` only |
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

GitHub sign-in, per `dev/docs/03-auth-spec.md`. **Status (slices 1-5):** the auth endpoints,
the `requireAuth` middleware, web sign-in with profile update/delete (US-6), mobile sign-in
with live marker updates (US-7) and the own-profile routes (US-4) exist, and the spec's access
matrix is enforced. Slice 6 (legacy verification, closure) remains.

| Surface | Auth | Where |
|---|---|---|
| `GET /auth/github`, `GET /auth/github/callback`, `POST /auth/token` | Public, rate limited | `routes.js` |
| `GET /auth/me` | Bearer token, rate limited | `routes.js` (`requireAuth`) |
| `GET /devs`, `POST /devs`, `GET /search` | Bearer token | `routes.js` (`requireAuth`) |
| `GET /devs/me`, `PUT /devs/me`, `DELETE /devs/me` | Bearer token | `routes.js` (`requireAuth`) |
| Socket.io handshake (`new-dev`, `dev-updated`, `dev-deleted`) | Token in the handshake `auth` payload | `websocket.js` (`io.use`) |

- **Flow** (`backend/src/controllers/AuthController.js`, routes in `routes.js`). Every
  client (web and mobile) uses PKCE (RFC 7636, `utils/pkce.js`) with the backend: it makes a
  random `code_verifier` (43-128 unreserved characters), keeps it, and sends only
  `code_challenge = BASE64URL(SHA256(code_verifier))`. This binds the one-time code to the
  client that started sign-in, so a forwarded callback URL (login CSRF) or an intercepted
  `com.matmss.mobile://` redirect is useless without the verifier.
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
  A token in the query string is ignored (`token_missing`). `GET /search` checks the token
  before its parameters, so an anonymous caller gets 401, not 400. CORS runs first, so a 401 to
  an allowed browser origin still carries `Access-Control-Allow-Origin` and the web app can read
  the `code`.
- **Socket.io handshake** (`websocket.js`, US-5). An `io.use` middleware runs before the
  `connection` event:
  1. Token: read **only** from `socket.handshake.auth.token` (socket.io-client's `auth` option,
     sent in the Socket.io CONNECT packet), verified with `verifySessionToken`. Not from the
     query string, which ends up in URLs and access logs, and not from an `Authorization`
     header: browsers cannot set headers on a WebSocket (`extraHeaders` only works for
     long-polling and in Node/React Native), so accepting it would make the behavior depend on
     the transport. One place, the same everywhere.
  2. Subscription: `latitude`, `longitude`, `techs` from the handshake query, validated as before
     (BUG-011).
  Any failure calls `next(err)` with `err.message` (human readable) and
  `err.data = { code, details }`; the client gets a `connect_error` with that `data`. Codes:
  `token_missing`, `token_expired`, `token_invalid` (same as the HTTP 401s), then
  `subscription_invalid`, and `internal_error` if verification itself throws (e.g. no usable
  `JWT_SECRET`; logged without the token). This replaces the old `subscription-error` event plus
  server-side disconnect: one mechanism for every refusal, and since the socket never reaches
  `connection`, a refused client is never added to `connections` (BUG-010) and never receives a
  push. socket.io-client does not auto-reconnect after a middleware refusal, so clients do not
  loop. `connectTimeout` is 10 s (default 45 s), so a client that ignores the refusal and never
  joins is disconnected within 10 s. `socket.data.user` holds the identity for later use.
  - **Checked on connect only (Q6):** an open socket is not closed when its token expires. If
    it reconnects later (network drop, backend restart), the handshake runs again and an
    expired token is refused as `token_expired`.
  - **CORS:** `allowRequest` (browser `Origin` allow-list, `config/cors.js`) runs at the
    Engine.IO level before the middleware, so a disallowed origin is refused even with a valid
    token; requests without an `Origin` (native mobile) are unaffected.
- **Registration identity and profile** (US-3, `DevController.store`, `utils/githubProfile.js`).
  `POST /devs` uses `requireAuth`. The dev is `req.user.github_username`; a `github_username` in
  the body is ignored (Q9) and not validated, and techs/latitude/longitude are validated as
  before (400 `{ error, details }`). An existing dev, matched case-insensitively (including a
  legacy profile created before sign-in in another letter case, US-8), is returned unchanged; a
  new one is created and pushed as `new-dev` as before.
  - **One dev per login, also under concurrency** (QA-AUTH2-1): `Dev` has a unique index on
    `github_username` with collation `{ locale: 'en', strength: 2 }` (`github_username_unique_ci`,
    the same collation every query uses, `GITHUB_USERNAME_COLLATION` in `utils/githubUsername.js`).
    `store` creates the dev with one atomic `findOneAndUpdate` upsert (`$setOnInsert`) under that
    collation. If two inserts still race, the index rejects the loser with a duplicate-key error
    (E11000), which is answered with the existing dev like any "already registered" request,
    never a 500. Only the request that actually inserted pushes `new-dev`. `index.js` builds the
    indexes at startup (`Dev.init()`); if legacy duplicates (same login in different letter
    case) prevent the unique index, it logs an error and keeps running without the guarantee
    until they are merged.
  - **Profile source:** the authenticated `GET /user` response read in the callback (product
    owner decision). It is sanitized and signed into the session token as the `profile` claim:
    C0/C1 controls, line/paragraph separators and every Unicode Bidi_Control character
    (U+061C, U+200E, U+200F, U+202A-U+202E, U+2066-U+2069) become spaces; values are trimmed;
    a value with nothing visible left (only whitespace, zero-width or other format/ignorable
    characters) becomes `null`; `name` is cut to 100 code points and 200 bytes, `bio` to 160
    code points and 400 bytes (bytes of the JSON-encoded UTF-8, so emoji and escaped quotes
    count fully); `avatar_url` is kept only if it is an absolute `https` URL without
    credentials, at most 300 bytes; every other field is dropped.
  - **Token size:** with those caps the largest possible session token is about 1.5 KB (about
    1,480 bytes at most, measured with a 39-character login and every field filled with the most expensive
    characters; a typical one is about 340), well under the 2048-byte value limit of
    `expo-secure-store` the mobile app stores it in. `unit/sessionToken.test.js` pins
    it under 1600 bytes. Verification rejects a `profile` claim that is not exactly
    this shape, so it cannot carry anything the backend did not produce. A `null` name falls
    back to the login when the dev is created.
  - **Why claims in the token rather than a server-side record:** the token is already signed
    and verified on every request, so the profile reaches registration with no extra storage,
    no new collection and no cleanup, and it works across backend instances (unlike the
    in-memory state/code stores). It adds at most about 1 KB to a token that is only sent to
    our own API. The profile is public GitHub data, so it being readable in the JWT exposes
    nothing new. The GitHub access token is still never stored or put in the token.
  - **Snapshot as of sign-in:** a name, avatar or bio changed on GitHub after sign-in only shows
    up after the next sign-in (up to 7 days later), in a new profile or on the next
    `PUT /devs/me`, which refreshes them from the token. `POST /devs` returns an existing dev
    unchanged.
  - **No GitHub call at registration:** the old unauthenticated `GET /users/:username` lookup
    and its 404/503/502 mapping are removed, so registration is not subject to GitHub's 60
    req/hr limit or outages. `qa/backend-tests` fails any scenario that calls
    `api.github.com/users/*`.
- **Own profile** (US-4, BUG-008, slice 5; `DevController.show`/`update`/`destroy`). The dev is
  always `req.user.github_username`, matched with the same case-insensitive collation as
  registration, so a legacy profile in another letter case is the user's (US-8, Q5). The routes
  take no username or id, so nobody can reach another user's profile; they are registered before
  any `/devs/:param` route could be (none exists: `PUT /devs/bob` is a JSON 404 `not_found`).
  Errors use `{ error, code, details }`, except the 400s, which are exactly `POST /devs`'s
  `{ error, details }`.
  - `GET /devs/me`: 200 with the dev, or 404 `dev_not_found`. Added so clients can tell
    "register" from "update" without scanning `GET /devs` (which will need pagination one day).
  - `PUT /devs/me` `{ techs, latitude, longitude }`: **all three required** (no partial update),
    validated by the same `utils/validateDevInput.js` as `POST /devs` (same 400). A full update
    keeps one validation path and matches what the web form sends; a partial update can be added
    later without breaking clients. One atomic `findOneAndUpdate` **without upsert**: a dev deleted
    by a concurrent `DELETE` stays deleted and the update answers 404. **Name, avatar and bio are
    refreshed** from the token's sign-in `profile` claim (already sanitized, a null name falls
    back to the login), so signing in again and saving picks up GitHub changes. Everything else in
    the body is ignored (Q9: `github_username`, `_id`, `name`, `avatar_url`, `bio`, `location`);
    the stored `github_username` keeps its letter case. 200 with the updated dev, or 404
    `dev_not_found` (nothing is created). Then `dev-updated` goes to the sockets matching the new
    position and techs (Q4), never `new-dev`.
  - `DELETE /devs/me`: hard delete (Q7, `findOneAndDelete`), **204** with no body. Without a
    profile, **404 `dev_not_found`**, also for a repeated delete: consistent with `PUT` and
    `GET /devs/me`, and the client can still tell "already gone" apart (the web app treats a 404
    on delete as done). Afterwards the dev is absent from `GET /devs` and `GET /search`, and
    `POST /devs` registers the user again. Then `dev-deleted` with only `{ _id, github_username }`
    (nothing else about a deleted profile is sent) goes to the sockets matching its last position
    and techs, so maps drop the marker without a new search.
  - **Stale markers (accepted):** `dev-updated` follows the new position and techs only (Q4), so a
    map that only matched the old ones keeps the old marker until its next search. Fixing it
    would mean a second event (e.g. `dev-deleted`) to the old-only sockets; not in the spec.
  - Legacy duplicates (same login in another letter case, possible only if the unique index
    could not be built, see `index.js`) are not merged: `PUT` and `DELETE` act on one of them.
  - **Writes are serialized per login** (QA-AUTH5 review; `utils/keyedQueue.js`). `POST /devs`,
    `PUT` and `DELETE /devs/me` run their database write *and* its socket announcement inside a
    per-login queue (key: the login in lower case), one at a time in arrival order. Without it a
    `PUT` whose database reply was slow could announce `dev-updated` after a later `DELETE` had
    announced `dev-deleted`, and mobile re-added the deleted marker (same for PUT/PUT and
    POST/DELETE). Different logins never wait for each other, and a key is dropped as soon as its
    last task settles. The queue is in process memory, which matches the single-instance
    assumption below; several instances would need a shared lock or per-dev versions on the events.
  - **Push amplification limits** (QA-AUTH5 review): each change is pushed to every matching
    socket, so `PUT`/`DELETE /devs/me` are rate limited **per GitHub login** (not per IP, so an
    account cannot spread changes over addresses and users behind one NAT do not share a budget):
    `PROFILE_RATE_LIMIT_MAX`, default 30 per 15 minutes, then 429 `rate_limited`. And `techs`
    (`POST /devs` and `PUT /devs/me`, `utils/validateDevInput.js`) is capped at **30 entries of at
    most 50 characters** each (counted after trimming and dropping empty entries; characters are
    code points), else 400 with "techs must list at most 30 technologies (got N)" / "each tech
    must be at most 50 characters". `GET /devs/me` and `POST /devs` are not rate limited (a
    `POST` for an existing dev changes and announces nothing).

  | Status | `code` | When |
  |---|---|---|
  | 400 | (none, `{ error, details }`) | `PUT /devs/me` techs/latitude/longitude missing or invalid, or techs over the caps |
  | 401 | `token_missing`, `token_expired`, `token_invalid` | `requireAuth` |
  | 404 | `dev_not_found` | `GET`/`PUT`/`DELETE /devs/me` without a profile |
  | 429 | `rate_limited` | `PUT`/`DELETE /devs/me` over `PROFILE_RATE_LIMIT_MAX` for this login |
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
  load): `AUTH_SESSION_RATE_LIMIT_MAX`, default 600. A third limiter is keyed on the signed-in
  login instead of the IP: profile changes (`PUT`/`DELETE /devs/me`, after `requireAuth`):
  `PROFILE_RATE_LIMIT_MAX`, default 30 (see "Own profile").
- **Config** (`config/auth.js`, read from env on each use): `GITHUB_CLIENT_ID`,
  `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL` (default
  `http://localhost:3333/auth/github/callback`), `JWT_SECRET`, `MOBILE_APP_SCHEME` (default
  `com.matmss.mobile`, the mobile app's scheme). With `NODE_ENV=production`, `index.js` refuses to start unless the client id,
  client secret and a `JWT_SECRET` of at least 32 characters are set. Outside production a
  missing `JWT_SECRET` falls back to a random per-process secret (sessions reset on restart),
  and `GET /auth/github` answers 503 until the GitHub credentials are set. Secrets and tokens
  are never logged or returned.
- **`MOBILE_APP_SCHEME`** is an allow-list of shape: `^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$`
  (e.g. `devradar`, `com.devradar.app`), and `http`, `https`, `intent`, `exp`, `exps`,
  `javascript`, `data`, `file`, `ftp`, `ws`, `wss`, `about`, `blob`, `content`, `vbscript`,
  `chrome` are refused (they resolve to web pages, scripts or other apps, e.g. Android's
  `intent://` opens arbitrary https URLs). A refused or invalid value disables mobile
  redirects, and startup logs a warning that does not print the value. It must equal the
  mobile app's scheme (see Mobile, "App scheme").
- **Single-instance limitation:** the `state` store, the one-time code store
  (`utils/oneTimeStore.js`), the rate-limit counters and the per-login write queue
  (`utils/keyedQueue.js`) live in process memory. Running more
  than one backend instance needs sticky sessions or a shared store (e.g. Redis) first.

## Web (`web/`)

- **Framework:** Create React App.
- **API access:** `web/src/services/api.js`, reads `REACT_APP_API_URL`
  (CRA's required env var prefix) with a `localhost:3333` fallback for dev.
  An axios request interceptor adds `Authorization: Bearer <token>` when a
  session exists and remembers which token each request carried. Every 401,
  whatever its body (QA-AUTH2-4), ends the session: token cleared, signed-out
  view, with "Sessão expirada, entre novamente" for `token_expired` and no
  message for any other or missing `code` (e.g. a proxy's 401). The stored
  token is cleared only if it is still the one the failing request carried
  (`session.clearToken(expectedToken)`, compare and remove in one task): a 401
  for a token another tab has already replaced re-validates the new token
  instead of clearing it. localStorage has no cross-tab lock, so a write from
  another tab that this tab has not seen yet can in theory still be lost in
  that instant; the other tab then gets a 401 on its next request and shows
  the signed-out view (no security impact). Every request times out after
  10 s (`REQUEST_TIMEOUT_MS`) and then fails like an unreachable server, so a
  hung `GET /auth/me` shows the "unavailable" view (below), not "Carregando..."
  forever. `GET /devs` needs the token since slice 4.
- Talks to the same `/devs` and `/search` endpoints as mobile, plus the
  `/auth/*` endpoints and `GET`/`PUT`/`DELETE /devs/me`; no web-specific backend routes exist. Nothing secret is
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
  backend.
  **A callback that does not complete a sign-in never touches a stored session**
  (QA-AUTH2-5): if a token is stored, the app ignores the failed callback and restores that
  session as on any load; only a successful exchange replaces the token. This is the safer of
  the two options: clearing the token instead would let anyone sign a user out by sending a
  crafted `/auth/callback` link, and showing the signed-out view while keeping the token (the
  old behavior) made people believe they were signed out on a shared computer.
- **Deployment: SPA fallback required.** The production build is static files, and GitHub
  sign-in returns to `<web origin>/auth/callback`. The web server must answer every unknown
  path (at least `/auth/callback`) with `index.html`, e.g. nginx `try_files $uri /index.html`,
  Netlify `/* /index.html 200`, or `serve -s build`. Without it the callback is a 404 and
  sign-in cannot finish. The CRA dev server already does this. Also noted in
  `web/.env.example`.
- **Views:** signed out, only the sign-in button (plus a message after "Login cancelado", a
  failure, or an expired session; the button is also the retry). Signed in, the GitHub username
  and avatar (from `POST /auth/token`, then `GET /auth/me` on every load), "Sair", the
  registration form without a username field, and the dev list. "Salvar" is disabled while a
  registration is in flight (QA-AUTH2-1).
- **Own profile** (US-6 "Already registered", slice 5; `App.js`, `components/DevForm`). After
  sign-in the app asks `GET /devs/me` (in parallel with `GET /devs`; the form waits with
  "Carregando seu perfil..."). 404: the registration form ("Cadastro", "Salvar", location from
  the browser). A profile: "Meu perfil", the form prefilled with the saved techs ("ReactJS,
  Redux") and saved coordinates (the browser's position is not asked for), "Atualizar"
  (`PUT /devs/me`) and "Excluir meu perfil". Deleting needs an in-page confirmation ("Confirmar
  exclusão" / "Cancelar"), never `window.confirm`, which blocks the page and browser automation.
  After a save the list entry is replaced (matched by `_id` or by login in any letter case, so a
  profile deleted and registered again elsewhere is not listed twice; or appended) and the form
  is remounted with the saved values ("Perfil atualizado"; registering also switches to update
  mode); after a delete the entry leaves the list and the form returns to registration ("Perfil
  excluído"). Every button is disabled while a save or delete is in flight. Coordinates are
  written into the form as plain decimals (`services/coordinates.js`): `String(1e-7)` is "1e-7",
  which the backend rejects, so an unchanged "Atualizar" used to fail (QA-AUTH5-2).
  **Only a 404 with `code: "dev_not_found"` means "no profile"** (QA-AUTH5-1): any other 404
  (e.g. `not_found` from a backend without these routes, or a proxy that does not route
  `/devs/me`) changed nothing, so it is shown as an error and the form stays in update mode.
  Update answered `dev_not_found` (deleted on another device): registration form with "Seu
  perfil não existe mais, cadastre-se novamente" and the values the user typed, so "Salvar"
  registers them. Delete answered `dev_not_found`: treated as done. If `GET /devs/me` fails
  otherwise (server unreachable), or another tab registered meanwhile, the registration form is
  shown and `POST /devs` answers with the existing profile unchanged. The app notices because
  the answer does not hold what was submitted (techs as the backend parses them, coordinates as
  numbers): it then says "Você já tinha um perfil cadastrado (<saved techs>). Os dados que você
  digitou estão no formulário: clique em "Atualizar" para salvá-los.", lists the stored profile
  and keeps the typed values in the update form. As with registration, a change is only sent for the user this tab shows
  (QA-AUTH2-3), and a 401 ends the session. If the stored session cannot be checked (server
  unreachable or timed out, or `GET /auth/me` answers 429), the token is kept and the app shows why ("Muitas
  tentativas em pouco tempo, tente novamente mais tarde" for 429) with "Tentar novamente" and
  "Sair", never a misleading "expired" or signed-out view.
- **"Sair" only ends the session in this browser.** It removes the token from `localStorage`
  (which also signs out the other tabs). There is no server-side logout or revocation: tokens
  are stateless JWTs, so a copy of the token (e.g. taken by XSS before sign-out) stays valid
  until it expires, up to 7 days after sign-in. Revoking sooner would need a server-side
  denylist or a token version per user, which is out of scope (no refresh tokens, Q3).
- **Several tabs** (QA-AUTH2-3): the token in `localStorage` is shared, but each tab only acts
  for the token it validated. A `storage` event on `devradar.session_token` makes the other
  tabs follow: token removed, signed-out view; token changed (another account signed in),
  re-validate with `GET /auth/me` and show that user. Registering re-checks that the stored
  token is still the one the tab shows, and re-validates instead of sending someone else's.
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
  read `EXPO_PUBLIC_API_URL` via `src/config.js` (Expo's build-time-inlined env var prefix,
  supported SDK 49+) with a `localhost:3333` fallback. Requests time out after 15 s.
  - This was previously hardcoded to a developer's LAN IP (BUG-001), which
    blocked CI entirely. Fixed — see `mobile/.env.example`.
- **Location:** uses `expo-location` for the device's current position,
  which becomes the center point for both the map view and the
  `latitude`/`longitude` query params sent to `/search` and the socket
  connection. Asked for only once signed in (the map screen is not mounted before).
- **Screens** (US-7, `src/routes.js`, `src/SessionContext.js`, `services/sessionState.js`). A
  `SessionProvider` holds the session; the navigator only contains the screens allowed in the
  current state (React Navigation's auth-flow pattern), so the map cannot be reached signed out:
  - loading: "Carregando..." while the stored session is checked;
  - signed out: `pages/SignIn.js`, "Entrar com GitHub", plus a message after "Login cancelado",
    a failed sign-in, or an ended session;
  - signed in: the map (`pages/Main.js`) with the GitHub username and "Sair" in the header, and
    `pages/Profile.js`;
  - unavailable: `pages/SessionUnavailable.js`, when the stored session cannot be checked
    (unreachable, timeout, 429): the token is kept, with "Tentar novamente" and "Sair".
- **Sign-in flow** (`services/auth.js`, `services/pkce.js`), the same backend PKCE flow as the
  web:
  1. "Entrar com GitHub" makes a 32-byte verifier from `expo-crypto`'s `getRandomBytes` (the
     platform's cryptographically secure generator), base64url (43 characters), and its S256
     challenge (`digestStringAsync`). The verifier stays in memory for this one sign-in.
  2. It opens `<API_URL>/auth/github?redirect=com.matmss.mobile://auth/callback&code_challenge=...&code_challenge_method=S256`
     with `expo-web-browser`'s `openAuthSessionAsync` (ASWebAuthenticationSession on iOS,
     Custom Tabs on Android), which returns when the browser reaches the redirect URI.
  3. The callback is parsed by hand (React Native's `URL` is unreliable for custom schemes) and
     only accepted if it is exactly the redirect URI plus a query. Closing the browser or
     `error=sign_in_cancelled` shows "Login cancelado"; `sign_in_failed` a message by `reason`
     (a lookup key, never rendered).
  4. `POST /auth/token` `{ code, code_verifier }` returns the token and the user.
  Expo Go cannot finish sign-in: its `exp://` redirect is refused by the backend on purpose
  (QA-AUTH-3). Use a development build (`npm run android` / `ios`).
- **App scheme: `com.matmss.mobile`**, the app's own applicationId / bundle identifier. RFC
  8252 7.1 recommends reverse-domain schemes for native OAuth redirects, and using the store
  identifier ties the scheme to a name the stores keep unique to this app, which makes an
  accidental or malicious clash (another app registering the same scheme to catch the redirect,
  which Android would resolve with a chooser) less likely than with a short word such as
  `devradar`. PKCE already makes an intercepted code useless; this is defense in depth.
  `com.devradar.app` would be reverse-domain too, but of a domain the project does not control
  and tied to nothing. The scheme must be the same in `app.json` (`scheme`), `src/config.js`
  (`APP_SCHEME`), the Android intent filter in `android/app/src/main/AndroidManifest.xml`
  (generated by `expo prebuild`) and the backend's `MOBILE_APP_SCHEME` (its default);
  `dev/tests/mobile/config.test.js` checks all four. If the package or bundle id ever changes,
  change the scheme with it.
- **Token storage** (`services/session.js`): `expo-secure-store` (iOS Keychain, Android
  Keystore-encrypted storage), key `devradar.session_token`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`
  (never migrated to another device), excluded from Android Auto Backup by the
  `expo-secure-store` config plugin. Never AsyncStorage. The session survives relaunches until
  the token expires (7 days, Q3). The token is also cached in memory so requests can attach it
  synchronously.
- **Using the session:** `GET /search` sends `Authorization: Bearer <token>`; the socket sends
  it in the handshake `auth` payload (`socket.auth = { token }`), never in the query. Any 401
  (whatever its body) or a socket `connect_error` with a token code ends the session and shows
  the sign-in screen with "Sessão expirada, entre novamente" (`token_expired`) or "Sua sessão não
  é mais válida, entre novamente" (anything else), never an empty map. As on the web, the token
  is cleared only if a session is active and it is still the token the failing request or
  handshake used: a late 401 for an older session does not end a newer one, and a failure for
  something sent without a token ends nothing (no message after a voluntary "Sair",
  QA-AUTH4-1). The map remembers the token a search was sent with and opens the socket only if
  it is still mounted and that token is still in use; the socket service never connects without
  a token. Other socket refusals (`subscription_invalid`) are only logged; other search failures
  show "Não foi possível buscar devs, tente novamente". If the location cannot be read (services
  off, permission denied or the request failing), the map screen says so with "Tentar
  novamente". A second "Entrar com GitHub" tap during a sign-in is ignored.
- **"Sair"** closes the socket, forgets its token and deletes the token from secure storage.
  Like the web, there is no server-side revocation.
- **Live markers** (US-7 "Live profile update", slice 5; `pages/Main.js`, `services/devList.js`,
  `services/socket.js`). The map subscribes once per event for its lifetime (`new-dev`,
  `dev-updated`, `dev-deleted`; one listener each, removed on unmount). `new-dev` and
  `dev-updated` replace the dev's entry in place, so its marker (keyed by `_id`) moves and its
  callout updates without a new search, or add it if it is not on the map (the backend only sends
  devs that match this map's subscription). `dev-deleted` removes it. A dev is the same entry by
  `_id` or by `github_username` in any letter case (a dev deleted and registered again has a new
  `_id`). A push without a usable `location.coordinates` or `techs` is ignored. Mobile has no
  registration or profile editing screen.

## Data flow: registering a dev and seeing it live elsewhere

1. A signed-in client (web; mobile has no registration screen) submits `POST /devs` with its
   session token and `techs`, `latitude`, `longitude`.
2. Backend takes the GitHub login from the token and checks if that dev
   already exists (case-insensitive); if not, builds the dev from the profile
   captured at sign-in (no GitHub call), turns the submitted lat/long into a
   GeoJSON point, and persists the `Dev`.
3. Backend computes which currently-connected sockets have a search radius
   and tech filter that the new dev matches, and emits `new-dev` to just
   those sockets.
4. Any signed-in client with an open socket connection whose filters match sees the
   new dev appear on their map without polling or refreshing.

Updating and deleting (slice 5) follow the same path: the web app sends `PUT /devs/me` or
`DELETE /devs/me`, the backend changes the token user's dev, then emits `dev-updated` (to the
sockets matching the new position and techs) or `dev-deleted` (to those matching the last ones),
and the mobile map moves or removes the marker.

## Known architectural constraints worth designing around

- **Socket identity is checked once.** The socket handshake verifies the token, but an open
  socket keeps receiving pushes after its token expires (Q6), and nothing server-side ends it
  (no revocation; "Sair" only closes the app's own socket). Closing sockets at expiry would
  need a timer per socket keyed on the token's `exp`.
- **Profile is a sign-in snapshot.** Registration uses the GitHub profile as
  of sign-in; an existing dev only picks up GitHub changes when its owner
  signs in again and saves (`PUT /devs/me`). A save from a session signed in
  before a GitHub change writes the older snapshot.
- **Live pushes follow the new state only.** `dev-updated` reaches the maps that
  match a dev's new position and techs (Q4); a map that only matched the old
  ones keeps a stale marker until it searches again. A map that misses a push
  (socket down, app in background) also only catches up on its next search.
- **Single MongoDB collection, no pagination.** `GET /devs` returns
  everything. Fine at seed-data scale; will need pagination or a stricter
  default radius before this is a real dataset.
