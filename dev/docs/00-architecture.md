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
                                        (sign-in only: account id,
                                         login, name, avatar, bio)
```

## Backend (`backend/`)

- **Framework:** Express 5, no ORM abstraction beyond Mongoose itself.
- **Data model:** single `Dev` collection (`backend/src/models/Dev.js`) —
  `name`, `github_id` (GitHub's numeric account id: who the profile belongs to),
  `github_username` (the login, display data), `bio`, `avatar_url`,
  `techs: [String]`, and a GeoJSON `location` field with a `2dsphere` index for
  radius queries. Two unique indexes: `github_id` (partial: only positive numeric
  ids, so legacy devs without one are left out) and `github_username`,
  case-insensitive, across all devs. `github_username_stale: true` marks a dev
  displaced from a login GitHub gave to someone else (its login is then a
  `_stale_<_id>` placeholder). Plus an internal `github_username_seen_at` that the
  API never returns. See Authentication, "Profile ownership".
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
  | `dev-updated` | a dev's login was refreshed (its owner renamed on GitHub, then signed in or saved), or the dev was displaced from a login GitHub gave to someone else (placeholder login, `github_username_stale: true`) | its position and techs | the dev |
  | `dev-deleted` | `DELETE /devs/me` succeeded | the last position and techs | `{ _id, github_id, github_username }` only |

  Events are sent from `services/devEvents.js`.
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

GitHub sign-in, per `dev/docs/03-auth-spec.md` (delivered; BUG-006 closed). Everything that
shows or changes devs needs a session token; only `/auth/*` is public. A user is a **GitHub
account, identified by its numeric id** (GitHub `GET /user` `id`, auth spec Q10), never by its
login: logins can be renamed and later registered by someone else. The login is display data,
refreshed from GitHub at every sign-in, and is how a legacy profile (created before sign-in
existed) is found (Q5, US-8).

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
     - success: exchanges `code` at GitHub, reads `GET https://api.github.com/user` (account
       `id`, login and public profile), drops the GitHub access token, then
       `<redirect>?code=<one-time code>` (single use, 60 s, carries the challenge, the id, the
       login and the sanitized profile);
     - `error=access_denied`: `<redirect>?error=sign_in_cancelled`;
     - any other failure: `<redirect>?error=sign_in_failed&reason=<reason>`, where `reason` is
       `github_error` (another GitHub `error`), `github_code_missing`, `github_unavailable`
       (GitHub rejected the code, 5xx or unreachable), `github_rate_limited`, or
       `github_user_invalid` (`GET /user` answered without a valid `id`, a positive safe integer
       given as a JSON number, or without a valid login).
  3. `POST /auth/token` `{ code, code_verifier }`: consumes the one-time code first, then
     checks `BASE64URL(SHA256(code_verifier))` against the stored challenge with a
     timing-safe compare. A missing or wrong verifier is a 400 and the code is spent (sign in
     again). On success: `{ token, token_type: "Bearer", expires_in, user: { github_id,
     github_username, name, avatar_url } }`. The session token never appears in a URL. Any other
     dev still showing this login is displaced, and the account's dev takes it (see "Profile
     ownership").
  4. `GET /auth/me` (Bearer token): `{ github_id, github_username, name, avatar_url }`, answered
     from the token alone (no database or GitHub call). Clients call it on load to show who is
     signed in.
- **Session token** (`utils/sessionToken.js`, `utils/githubId.js`): HS256 JWT signed with
  `JWT_SECRET`, `iss` = `devradar`, `exp` = 7 days, no refresh token. Claims, all required:
  - `sub` = the GitHub account id as a decimal string (`"810438"`). Only the canonical form is
    accepted: digits, no sign, no leading zero, no exponent, at most `Number.MAX_SAFE_INTEGER`.
  - `login` = the GitHub login at sign-in.
  - `profile` = `{ name, avatar_url, bio }` (see "Registration profile" below).
  - `login_read_at` = when GitHub's `GET /user` was read at the callback (ms since the epoch, no
    later than `iat`), which orders logins (see "Profile ownership"). If the server clock stepped
    back between the callback and `POST /auth/token`, it is clamped to the last millisecond of
    the `iat` second instead of failing the sign-in (QA-AUTH6-5); that only makes the read look
    a little older, so it can never override a newer one.
  - `iat`.

  **Why `sub` = the id:** the subject is what the token identifies, and RFC 7519 asks that it be
  unique and never reassigned, which is true of GitHub's id and exactly what is false of a login.
  Every check that decides whose profile a request may touch reads the subject. The alternative,
  keeping `sub` = login and adding a `gid` claim, would leave the reassignable value in the slot
  every JWT library and reader treats as the identity, and an old token (no `gid`) could still
  look complete.

  **Tokens issued before ids were captured** (their `sub` is a login, and they have no `login`
  claim) are `token_invalid`, like any other token without a well-formed claim set (e.g. the
  earliest tokens, without `profile`). Their clients get the signed-out view and sign in again once. Tokens
  live at most 7 days, so this costs each user one sign-in and no migration.
  `verifySessionToken(token)` never throws and is exported for the Socket.io handshake
  (also re-exported as `verifyToken` from `middleware/auth.js`).
- **`requireAuth`** (`middleware/auth.js`): reads `Authorization: Bearer <token>`, sets
  `req.user = { github_id, github_username, profile, login_read_at }`, or answers 401 with a `WWW-Authenticate` header and `{ error, code, details }`. Clients
  switch on `code`:
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
  joins is disconnected within 10 s. `socket.data.user` holds the identity for later use (the
  same shape as `req.user`). A token issued before ids were captured is refused as
  `token_invalid`, like on HTTP.
  - **Checked on connect only (Q6):** an open socket is not closed when its token expires. If
    it reconnects later (network drop, backend restart), the handshake runs again and an
    expired token is refused as `token_expired`.
  - **CORS:** `allowRequest` (browser `Origin` allow-list, `config/cors.js`) runs at the
    Engine.IO level before the middleware, so a disallowed origin is refused even with a valid
    token; requests without an `Origin` (native mobile) are unaffected.
- **Profile ownership** (Q5, Q10, US-8; `services/devOwnership.js`). One helper,
  `resolveOwnDev`, decides which dev is the signed-in user's, for `POST /devs` and every
  `/devs/me` route. For `req.user = { github_id, github_username }`:
  1. **Own:** a dev with `github_id` equal to the user's. It is theirs.
  2. **Legacy:** otherwise, a dev **without** a `github_id` (field missing, or `null` in
     hand-edited data: both are treated the same) whose login matches the user's
     case-insensitively (created before sign-in existed). Its owner **claims** it on their first
     write (`POST`, `PUT` or `DELETE`): one conditional update sets `github_id` only if the dev
     still has none and still shows that login (`{ _id, github_id: null, github_username }`), so
     of two accounts claiming at once exactly one wins; the loser looks again and finds rule 3 (no
     500). The claim keeps the record: same `_id`, techs, location, name, bio and avatar (a `PUT`
     then changes what it always changes); it takes the login as GitHub spells it now and records
     when that was read (`github_username_seen_at`, so no older session can set it back,
     QA-AUTH6-2). **`GET /devs/me` does not claim:** it returns the legacy dev as it is and
     writes nothing. A read stays a read (the web app calls it on every load), and the claim
     happens on the first write anyway.
  3. **Conflict:** otherwise, a dev with **another** `github_id` but the same login. It is
     **never** theirs: `GET`/`PUT`/`DELETE /devs/me` answer 404 `dev_not_found` (exactly as if
     there were no dev, revealing nothing). On `POST /devs`, if this session's GitHub read is
     strictly newer than that dev's login state, that dev is displaced (below) and the user
     registers; otherwise **409 `github_username_conflict`**: logins stay unique, and the other
     dev's login was confirmed by a read at least as recent as this session's, so this session's
     login is the stale one (signing in again settles it).
  4. **None:** otherwise. `GET`/`PUT`/`DELETE` answer 404; `POST` creates a dev with the user's
     `github_id`.

  - **Logins are unique and follow GitHub, ordered by when GitHub was read** (QA-AUTH6-1/2/3,
    product decision: usernames stay unique across all profiles). Each dev records
    `github_username_seen_at`: the time of the GitHub read its current login state comes from (a
    sign-in's `GET /user`, carried in the token as `login_read_at`; never sent to clients). A
    login is only ever changed by a **newer** read, so an old token (up to 7 days) can never set
    a login back, and two sign-ins of one account are ordered by when they read GitHub, not by
    when they redeemed their one-time code.
  - **Taking a login displaces staler holders.** Whenever an account takes its login, with the
    GitHub read its session carries, any other dev that shows that login with an **older** state
    is **displaced** first. That happens at sign-in (`POST /auth/token`, `refreshLoginAtSignIn`,
    GitHub's fresh answer; best effort, a failure is logged and never fails the sign-in) and on
    the account's own writes that set the login: `POST /devs` (creating, claiming, or returning
    its dev) and `PUT /devs/me` (QA-AUTH6-4). A displaced dev's `github_username` becomes
    `_stale_<its _id>` (unique, and never a valid GitHub login, since `_` cannot appear in one)
    with `github_username_stale: true`, and a `name` that was only the old login (the fallback
    when GitHub had no name) is cleared, since that login now belongs to someone else (clients
    show "Dev sem nome"); **nothing else changes and it is never deleted**, and `dev-updated` is
    pushed for it so maps drop the stale login. Then the account's dev takes the login
    (`dev-updated` if it changed; a name that was only the old login, or a cleared one, follows:
    the sign-in profile's name, else the new login). A displaced dev gets its owner's current
    login back at the owner's next sign-in (or a write with a newer session). A legacy dev is
    displaced only by an account that already owns a dev; otherwise it is that account's to claim
    (rule 2). A dev whose state is **at least as recent** is never touched: the older session
    keeps its own stored login on `PUT` and gets 409 on `POST`. Displacement needs no GitHub call
    about anyone else.
  - **What this guarantees:** the **newest GitHub read always wins**, whatever the order of
    sign-ins and writes. A login is shown by at most one dev, and once a session with the newest
    read for a login signs in, registers or saves, its account's dev shows that login (unless an
    even newer read gave it to someone else). The login's current holder is never refused it in
    favor of an older read: their sign-in, or their `POST /devs`, displaces it. Nobody waits for
    anyone else to sign in. Swaps (A and B exchange logins) and cycles (A to B's, B to C's, C to
    A's) converge in any order, without loops. Until an owner signs in or saves, their dev may
    show a stale login (if nobody newer has claimed it yet) or the placeholder after a
    displacement; clients then show the dev's name with no GitHub link.
  - **Displaced legacy devs** stay listed and are never deleted, but can no longer be claimed by
    login (their login is the placeholder). No automatic rule can safely give them to an account:
    the login they showed belonged to someone else at the time of the displacement. Merging one
    into its real owner's profile is a manual operation.
  - **Writes refresh the own dev's login** (including a change of letter case) only when the
    session's read is newer than the stored state, and keep the stored login if another dev still
    holds it with a newer state.
  - **Locks:** every change to a dev runs in the per-account queue of its owner (below). Anything
    that may take a login (sign-in, `POST /devs`, `PUT /devs/me`) runs through `inLoginOrder`: it
    looks up the dev showing the login, holds the account's key and, if that dev belongs to
    another account, that account's key too, taken in sorted order (`keyedQueue.runAll`). Every
    multi-key task takes keys in the same order and a single-key task never waits for a second
    key, so no two tasks wait for each other: swaps and concurrent writes cannot deadlock. Under
    the keys it checks the holder is unchanged; if not (or a write lost a race, e.g. a
    duplicate-key error on insert), it starts over, at most three times. `DELETE` changes no login
    and takes only the account's key. Legacy devs have no account key: their claim and their
    displacement are conditional updates that exclude each other.
  - **Indexes, one dev per account and per login** (QA-AUTH2-1, Q10): `github_id_unique`, unique
    and **partial** (`partialFilterExpression: { github_id: { $gt: 0 } }`: only positive numeric
    ids), so legacy devs (missing or `null` id) are not in it at all and it always builds without
    touching a document; an equality query on an id uses it; and
    `github_username_unique_ci`, unique with collation `{ locale: 'en', strength: 2 }` (the same
    collation every login query uses, `GITHUB_USERNAME_COLLATION` in `utils/githubUsername.js`).
    `POST /devs` creates the dev with one atomic `findOneAndUpdate` upsert on `github_id`
    (`$setOnInsert`). If an insert still loses a race (same account on another instance, or
    another account with the same login), the index answers a duplicate-key error (E11000) and
    the request resolves ownership again: the existing dev, or the 409. Never a 500, and only the
    request that inserted pushes `new-dev`. `index.js` builds the indexes at startup
    (`Dev.init()`); if legacy duplicates (same login in different letter case) prevent the login
    index, it logs an error and keeps running without that guarantee until they are merged
    (mongoose still builds the other indexes).
  - **No data migration** (US-8): deploying adds the `github_id` index (legacy documents are not
    in it) and rewrites nothing; legacy devs stay listed in `GET /devs` and `GET /search` and get
    a `github_id` only when their owner first writes. Guarded by `legacy-profiles.feature`
    ("Deploying onto a database with legacy profiles rewrites no document").
- **Registration** (US-3, `DevController.store`, `utils/githubProfile.js`). `POST /devs` uses
  `requireAuth`. A `github_username` (or any identity field) in the body is ignored (Q9) and not
  validated; techs/latitude/longitude are validated as before (400 `{ error, details }`). An
  existing or claimed dev is returned unchanged apart from its login refresh; a new one is
  created from the sign-in profile and pushed as `new-dev`.
  - **Profile source:** the authenticated `GET /user` response read in the callback (product
    owner decision). It is sanitized and signed into the session token as the `profile` claim:
    C0/C1 controls, line/paragraph separators and every Unicode Bidi_Control character
    (U+061C, U+200E, U+200F, U+202A-U+202E, U+2066-U+2069) become spaces; values are trimmed;
    a value with nothing visible left (only whitespace, zero-width or other format/ignorable
    characters) becomes `null`; `name` is cut to 100 code points and 200 bytes, `bio` to 160
    code points and 400 bytes (bytes of the JSON-encoded UTF-8, so emoji and escaped quotes
    count fully); `avatar_url` is kept only if it is an absolute `https` URL without
    credentials, at most 300 bytes; every other field is dropped.
  - **Token size:** with those caps the largest possible session token is about 1.5 KB (1,537
    bytes at most, measured with the largest GitHub id, a 39-character login, `login_read_at`
    and every field filled with the most expensive characters; a typical one is about 400), well
    under the
    2048-byte value limit of
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
    unchanged (apart from its login).
  - **No GitHub call at registration:** the old unauthenticated `GET /users/:username` lookup
    and its 404/503/502 mapping are removed, so registration is not subject to GitHub's 60
    req/hr limit or outages. `qa/backend-tests` fails any scenario that calls
    `api.github.com/users/*`.
- **Own profile** (US-4, BUG-008; `DevController.show`/`update`/`destroy`). The dev is the
  signed-in account's, by the ownership rules above (own by `github_id`; a legacy dev by login in
  any letter case, claimed by the first write: `PUT`, `DELETE`, and `POST /devs` too; never a dev
  of another account). The routes take no
  username or id, so nobody can reach another user's profile; they are registered before any
  `/devs/:param` route could be (none exists: `PUT /devs/bob` is a JSON 404 `not_found`).
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
    back to the login), so signing in again and saving picks up GitHub changes; so is the login
    (see "Login refresh"). Everything else in the body is ignored (Q9: `github_username`,
    `github_id`, `_id`, `name`, `avatar_url`, `bio`, `location`). 200 with the updated dev, or 404
    `dev_not_found` (nothing is created). Then `dev-updated` goes to the sockets matching the new
    position and techs (Q4), never `new-dev`.
  - `DELETE /devs/me`: hard delete (Q7, `findOneAndDelete`), **204** with no body. Without a
    profile, **404 `dev_not_found`**, also for a repeated delete: consistent with `PUT` and
    `GET /devs/me`, and the client can still tell "already gone" apart (the web app treats a 404
    on delete as done). Afterwards the dev is absent from `GET /devs` and `GET /search`, and
    `POST /devs` registers the user again. Then `dev-deleted` with only
    `{ _id, github_id, github_username }` (nothing else about a deleted profile is sent; a deleted
    legacy dev was claimed first, so it has a `github_id`) goes to the sockets matching its last position
    and techs, so maps drop the marker without a new search.
  - **Stale markers (accepted):** `dev-updated` follows the new position and techs only (Q4), so a
    map that only matched the old ones keeps the old marker until its next search. Fixing it
    would mean a second event (e.g. `dev-deleted`) to the old-only sockets; not in the spec.
  - Legacy duplicates (same login in another letter case, possible only if the unique index
    could not be built, see `index.js`) are not merged: the first claim takes one of them.
  - **Writes are serialized per GitHub account** (QA-AUTH5 review; `utils/keyedQueue.js`).
    `POST /devs`, `PUT` and `DELETE /devs/me`, and the login refresh at sign-in, run their
    database writes *and* their socket announcement inside a per-account queue (key: the
    `github_id`), one at a time in arrival order. Without it a `PUT` whose database reply was slow
    could announce `dev-updated` after a later `DELETE` had announced `dev-deleted`, and mobile
    re-added the deleted marker (same for PUT/PUT and POST/DELETE). The key is the account, not
    the login: it is what owns a dev, it does not change on a rename, and two sessions of one
    account with different logins (before and after a rename) share it. Ordering still holds for
    every dev, because only its owner ever writes it (rule 1), or the one account that wins its
    claim (rule 2; a losing claimant writes nothing), or a sign-in that displaces it while holding
    its owner's key too (sorted, see "Locks" above). Different accounts never wait for each
    other, and a key is dropped as soon as its last task settles. The queue is in process memory,
    which matches the single-instance assumption below; several instances would need a shared lock
    or per-dev versions on the events.
  - **Push amplification limits** (QA-AUTH5 review): each change is pushed to every matching
    socket, so `PUT`/`DELETE /devs/me` are rate limited **per GitHub account** (`github_id`; not
    per IP, so an account cannot spread changes over addresses and users behind one NAT do not
    share a budget; not per login, so a rename does not reset it):
    `PROFILE_RATE_LIMIT_MAX`, default 30 per 15 minutes, then 429 `rate_limited`. And `techs`
    (`POST /devs` and `PUT /devs/me`, `utils/validateDevInput.js`) is capped at **30 entries of at
    most 50 characters** each (counted after trimming and dropping empty entries; characters are
    code points), else 400 with "techs must list at most 30 technologies (got N)" / "each tech
    must be at most 50 characters". `GET /devs/me` and `POST /devs` are not rate limited (a
    `POST` for an existing dev changes and announces nothing, apart from a login refresh).

  | Status | `code` | When |
  |---|---|---|
  | 400 | (none, `{ error, details }`) | `POST /devs` / `PUT /devs/me` techs/latitude/longitude missing or invalid, or techs over the caps |
  | 401 | `token_missing`, `token_expired`, `token_invalid` | `requireAuth` (also a token issued before GitHub ids were captured) |
  | 404 | `dev_not_found` | `GET`/`PUT`/`DELETE /devs/me` without a profile of this account (including when only another account's dev has this login) |
  | 409 | `github_username_conflict` | `POST /devs` when another account's dev shows this login with a login state from a GitHub read at least as recent as this session's `login_read_at` (rule 3; an older one is displaced and the registration succeeds; sign in again) |
  | 429 | `rate_limited` | `PUT`/`DELETE /devs/me` over `PROFILE_RATE_LIMIT_MAX` for this account |
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
  GitHub account (`github_id`) instead of the IP: profile changes (`PUT`/`DELETE /devs/me`, after `requireAuth`):
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
  (`utils/oneTimeStore.js`), the rate-limit counters and the per-account write queue
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
  forever. A stored token from before GitHub ids were captured gets a 401
  `token_invalid` on the first `GET /auth/me`, so the app shows the signed-out
  view (no message) and the user signs in again once.
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
- **Own profile** (US-6 "Already registered"; `App.js`, `components/DevForm`). After
  sign-in the app asks `GET /devs/me` (in parallel with `GET /devs`; the form waits with
  "Carregando seu perfil..."). 404: the registration form ("Cadastro", "Salvar", location from
  the browser). A profile: "Meu perfil", the form prefilled with the saved techs ("ReactJS,
  Redux") and saved coordinates (the browser's position is not asked for), "Atualizar"
  (`PUT /devs/me`) and "Excluir meu perfil". Deleting needs an in-page confirmation ("Confirmar
  exclusão" / "Cancelar"), never `window.confirm`, which blocks the page and browser automation.
  After a save the list entry is replaced (`services/devList.js`: matched by `_id`, else by
  `github_id` when both entries have one, else by login in any letter case for a legacy entry;
  so a profile deleted and registered again elsewhere is not listed twice, and two accounts that
  show the same login are never merged; or appended) and the form
  is remounted with the saved values ("Perfil atualizado"; registering also switches to update
  mode); after a delete the entry leaves the list and the form returns to registration ("Perfil
  excluído"). Every button is disabled while a save or delete is in flight. A displaced dev
  (`github_username_stale`, or any login that is not a GitHub login, `services/githubLogin.js`)
  is listed with its name ("Dev sem nome" if the backend cleared a name that was only the old
  login) and "Perfil do GitHub indisponível" instead of a GitHub link
  (`components/DevItem`): the placeholder is no GitHub page, and an old login would open someone
  else's. Coordinates are
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
- **Live markers** (US-7 "Live profile update"; `pages/Main.js`, `services/devList.js`,
  `services/socket.js`). The map subscribes once per event for its lifetime (`new-dev`,
  `dev-updated`, `dev-deleted`; one listener each, removed on unmount). `new-dev` and
  `dev-updated` replace the dev's entry in place, so its marker (keyed by `_id`) moves and its
  callout updates without a new search, or add it if it is not on the map (the backend only sends
  devs that match this map's subscription). `dev-deleted` removes it. A dev is the same entry by
  `_id`; else, when both have one, by `github_id` (a dev deleted and registered again has a new
  `_id` but the same account; a renamed dev keeps its account); else, for a legacy entry without
  an id, by `github_username` in any letter case. Two accounts that show the same login (one
  renamed away) are never merged. A push without a usable `location.coordinates` or `techs` is
  ignored. A displaced dev (`dev-updated` with `github_username_stale` and a placeholder login)
  keeps its marker; its callout shows its name ("Dev sem nome" if cleared), says "Perfil do
  GitHub indisponível" and does not open the
  Profile screen, and `pages/Profile.js` itself only opens a WebView for a valid GitHub login
  (`services/githubLogin.js`). A stored token from before GitHub ids were captured gets `token_invalid` on launch, so
  the app shows the sign-in screen ("Sua sessão não é mais válida, entre novamente"). Mobile has no
  registration or profile editing screen.

## Data flow: registering a dev and seeing it live elsewhere

1. A signed-in client (web; mobile has no registration screen) submits `POST /devs` with its
   session token and `techs`, `latitude`, `longitude`.
2. Backend takes the GitHub account (id and login) from the token and looks
   for its dev (by `github_id`, or a legacy dev by login, which it claims); if
   there is none, builds the dev from the profile captured at sign-in (no
   GitHub call), turns the submitted lat/long into a GeoJSON point, and
   persists the `Dev` with the account's `github_id`.
3. Backend computes which currently-connected sockets have a search radius
   and tech filter that the new dev matches, and emits `new-dev` to just
   those sockets.
4. Any signed-in client with an open socket connection whose filters match sees the
   new dev appear on their map without polling or refreshing.

Updating and deleting follow the same path: the web app sends `PUT /devs/me` or
`DELETE /devs/me`, the backend changes the token account's dev, then emits `dev-updated` (to the
sockets matching the new position and techs) or `dev-deleted` (to those matching the last ones),
and the mobile map moves or removes the marker.

## Known architectural constraints worth designing around

- **Logins are as fresh as their owners' last sign-in.** DevRadar never asks GitHub about other
  users. A dev whose owner renamed their GitHub account keeps showing the old login until the
  owner signs in, or until the login's new holder signs in or registers, which displaces it (then
  it shows its name with no GitHub link until its owner signs in). Nobody depends on someone else
  signing in to register: their own sign-in or registration frees their login.
- **Login ordering trusts the server clock.** Reads are compared by the backend's `Date.now()`
  at the callback. A clock that steps back between two sign-ins of different accounts could make
  the later read look older; a step back within one sign-in is clamped (QA-AUTH6-5).

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
