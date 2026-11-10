# DevRadar — Requirements Specification

**Project:** omnistackJS (DevRadar) — matmss/omnistackJS
**Purpose:** A full-stack application that lets developers register their location and tech stack (pulled from their GitHub profile) so nearby developers can discover each other on a map, in real time.
**Document owner:** QA (Full SDET project)
**Last updated:** 2026-08-18

This document is derived directly from the current codebase (backend Express/MongoDB API, React web client, React Native/Expo mobile client, Socket.io real-time layer) rather than from a separate product spec, since none exists in the repo. Requirement IDs are referenced by the Test Scenarios, Test Cases, and Bug Tracker documents.

## 1. System overview

Three deployable layers share one MongoDB-backed API:

| Layer | Stack | Role |
|---|---|---|
| Backend | Node.js, Express 5, Mongoose 9 (MongoDB), Socket.io 4 | REST API + geospatial search + real-time push of new developers |
| Web | React 18 (Create React App) | Browser UI to register a developer and view the full list |
| Mobile | React Native / Expo SDK 36 | Map-based UI to search nearby developers by tech, view profiles, receive live updates |

Cross-cutting integration: the backend calls the public **GitHub Users API** (`GET https://api.github.com/users/:username`) to enrich a registration with `name`, `avatar_url`, and `bio`.

## 2. Functional requirements

### FR-1 — Developer registration
- **FR-1.1** The system shall accept a new developer registration containing `github_username`, `techs` (free-text, comma-separated), `latitude`, and `longitude`. *Since auth slice 2 (`dev/docs/03-auth-spec.md`, US-3): registration requires a session token and `github_username` is the token's GitHub login; a body `github_username` is ignored.*
- **FR-1.2** On registration, the system shall look up the given GitHub username via the GitHub public API and populate `name` (falling back to the username if no name is set), `avatar_url`, and `bio`. *Since auth slice 2: these come from the GitHub profile captured at sign-in (a snapshot carried in the session token), and registration makes no GitHub API call.*
- **FR-1.3** The system shall not create a duplicate developer record for a `github_username` that already exists; it shall return the existing record instead. *Since auth slice 6 (Q10): one record per GitHub account (`github_id`); a legacy record (no `github_id`) with the signed-in login, in any letter case, is claimed and returned with its data; a record of another GitHub account that still shows the signed-in login answers 409 `github_username_conflict` and is never changed (see FR-7.3).*
- **FR-1.4** The system shall persist `techs` as an array, parsed from the comma-separated input string, trimming whitespace around each tech. *Since the slice 5 review (QA-AUTH5): at most 30 techs of at most 50 characters each, on registration and update (400 otherwise).*
- **FR-1.5** The system shall persist `location` as a GeoJSON `Point` (`[longitude, latitude]`) indexed with a `2dsphere` index.
- **FR-1.6** On successful registration, the system shall notify (via WebSocket) any currently-connected client whose search radius (10 km) and tech filter match the new developer.
- **FR-1.7** *Since auth slice 5 (US-4, BUG-008):* a signed-in developer shall be able to read their own profile with `GET /devs/me` (404 `dev_not_found` without one).
- **FR-1.8** *Since auth slice 5 (US-4):* a signed-in developer shall be able to update their own profile with `PUT /devs/me`: `techs`, `latitude` and `longitude` are all required and validated like `POST /devs` (same 400); `name`/`avatar_url`/`bio` are refreshed from the GitHub profile captured at sign-in; identity fields in the body (`github_username`, `github_id`, `_id`, `name`, `avatar_url`, `bio`) are ignored (Q9); the profile is the signed-in GitHub account's (see FR-7.3: by `github_id`, or a legacy record by login in any letter case, claimed by this write, US-8), and since auth slice 6 its `github_username` follows the account's current login. No profile: 404 `dev_not_found`, nothing is created. *Since the slice 5 review: `PUT`/`DELETE /devs/me` are rate limited per GitHub account (per login until slice 6; `PROFILE_RATE_LIMIT_MAX`, default 30 per 15 minutes, 429 `rate_limited`), and writes for one account are applied and announced one at a time, so live events follow the database order.*
- **FR-1.9** *Since auth slice 5 (US-4, Q7):* a signed-in developer shall be able to delete their own profile with `DELETE /devs/me` (hard delete, 204); afterwards it is absent from `GET /devs` and `GET /search` and the user can register again. No profile (including a repeated delete): 404 `dev_not_found`. These routes take no username or id, so no one can change or delete another developer's profile.

### FR-2 — Developer listing
- **FR-2.1** The system shall expose an endpoint returning all registered developers, unfiltered. *Since auth slice 4 (US-5, Q1): only to signed-in callers; without a valid session token `GET /devs` answers 401 `token_missing`/`token_expired`/`token_invalid`.*

### FR-3 — Geospatial / tech search
- **FR-3.1** The system shall expose a search endpoint accepting `latitude`, `longitude`, and `techs` (comma-separated) as query parameters. *Since auth slice 4: `GET /search` requires a session token (401 as FR-2.1), checked before the parameters.*
- **FR-3.2** The system shall return only developers whose `techs` array intersects the requested `techs` list.
- **FR-3.3** The system shall return only developers within a 10,000-meter (10 km) radius of the given coordinates, using MongoDB's `$near`/`$geometry` geospatial query.

### FR-4 — Real-time updates (WebSocket)
- **FR-4.1** On WebSocket connect, the client shall supply `latitude`, `longitude`, and `techs` via the handshake query. *Since auth slice 4 (US-5): plus its session token in the handshake `auth` payload (`{ token }`, never the query string). A missing, invalid or expired token, or invalid params, refuses the handshake with `connect_error` `data.code` (`token_missing`/`token_expired`/`token_invalid`/`subscription_invalid`) and the socket is never subscribed. The token is checked on connect only (Q6).*
- **FR-4.2** The server shall track each open connection's coordinates and tech interests in memory.
- **FR-4.3** When a new developer is created, the server shall compute the Haversine distance (km) between the new developer and each open connection and emit a `new-dev` event to connections within 10 km whose tech list intersects the new developer's techs.
- **FR-4.4** The server shall support disconnect/reconnect without leaking stale in-memory connection entries indefinitely (see NFR-4).
- **FR-4.5** *Since auth slice 5 (Q4):* after a successful `PUT /devs/me` the server shall emit `dev-updated` with the updated developer to connections that match its **new** position and techs (same 10 km + techs rule as `new-dev`). Connections that only matched the old position or techs receive nothing (their marker stays until they search again). An update never emits `new-dev`.
- **FR-4.6** *Since auth slice 5:* after a successful `DELETE /devs/me` the server shall emit `dev-deleted` with only `{ _id, github_username }` (since slice 6 `{ _id, github_id, github_username }`) to connections that match the deleted developer's last position and techs.
- **FR-4.7** *Since auth slice 6:* when a developer's login is refreshed (its owner renamed their GitHub account, then signed in or registered again), the server shall emit `dev-updated` to connections matching its position and techs.

### FR-5 — Web client
- **FR-5.1** The web app shall request the browser's geolocation on load and pre-fill latitude/longitude in the registration form (user-editable).
- **FR-5.2** The web app shall submit a registration via `POST /devs` and append the returned developer to the visible list without a full reload. *Since auth slice 3 (US-6): only when signed in with GitHub; the form has no username field.*
- **FR-5.3** The web app shall load and display the full developer list (`GET /devs`) on mount, showing avatar, name, techs, bio, and a link to the developer's GitHub profile.
- **FR-5.4** *Since auth slice 5 (US-6 "Already registered"):* after sign-in the web app shall ask `GET /devs/me`. With a profile, the form is prefilled with the saved techs and location (not the browser's), the button reads "Atualizar" (`PUT /devs/me`), and "Excluir meu perfil" deletes it after an in-page confirmation ("Confirmar exclusão" / "Cancelar", never a native dialog). After an update the list shows the new values ("Perfil atualizado"); after a delete the form returns to registration ("Salvar") and the list drops the developer ("Perfil excluído"). After registering, the form switches to update mode. All buttons are disabled while a request is in flight. An update answered 404 (deleted elsewhere) returns to registration with "Seu perfil não existe mais, cadastre-se novamente"; a delete answered 404 counts as done. *Since the slice 5 review (QA-AUTH5-1/2): only a 404 with `code: "dev_not_found"` counts as "no profile" (any other 404 is an error and the form stays in update mode); coordinates are prefilled as plain decimals, never exponent notation; after an update answered `dev_not_found` the typed values stay in the registration form; when "Salvar" returns an already existing profile the app says so and keeps the typed values in the update form; list entries are matched by `_id` or login (any case).*

### FR-6 — Mobile client
- **FR-6.0** *Since auth slice 4 (US-7):* without a session the mobile app shall show an "Entrar com GitHub" screen instead of the map; sign-in uses the backend's PKCE flow in the system auth session with redirect `com.matmss.mobile://auth/callback`; the token is kept in `expo-secure-store` (not AsyncStorage) until it expires; `GET /search` and the socket send it; any auth failure returns to the sign-in screen with a message ("Sessão expirada, entre novamente" when expired); "Sair" clears the token and closes the socket.
- **FR-6.1** The mobile app shall request device location permission and center the map on the current position once granted. *Since auth slice 4: once signed in (the map is not shown before).*
- **FR-6.2** The mobile app shall render each nearby developer as a map marker with avatar; tapping the marker shall show a callout with name, bio, and techs.
- **FR-6.3** The mobile app shall let the user filter by `techs` (free text) and trigger a search (`GET /search`) via a search button.
- **FR-6.4** Triggering a search shall (re)connect the WebSocket with the current region and techs so new matching developers appear live without re-searching.
- **FR-6.5** Tapping a marker's callout shall navigate to a Profile screen that renders the developer's GitHub profile in an in-app WebView.
- **FR-6.6** *Since auth slice 5 (US-7 "Live profile update"):* on `dev-updated` the mobile app shall replace that developer's marker in place (matched by `_id`, or `github_username` in any letter case; since slice 6 by `_id`, then `github_id` when both have one, then the login for legacy entries) without a new search, or add it if it is not on the map; on `dev-deleted` it shall remove the marker. Malformed pushes are ignored. One listener per event for the map screen's lifetime.

### FR-7 — GitHub integration
- **FR-7.1** The system shall treat the GitHub username as the unique external identity for a developer. *Superseded by auth slice 6 (Q10): the identity is GitHub's numeric account id (`id` from `GET /user`, the session token's subject); the login is display data, refreshed from GitHub at every sign-in.*
- **FR-7.3** *Since auth slice 6 (Q10, US-8):* a profile belongs to a GitHub account id. A legacy profile (created before sign-in, no id) whose login matches the signed-in login in any letter case is claimed atomically on its owner's first write (exactly one of two concurrent claimants wins; no 500) and keeps its `_id` and data; `GET /devs/me` reads it without claiming. A profile of another id that shows the signed-in login is never readable or writable by this user (404 on `/devs/me`, 409 `github_username_conflict` on `POST /devs`); its login is refreshed (freeing it) when its owner signs in under their new login, and an older session never sets a refreshed login back. Deploying rewrites no document. Session tokens without an id (issued before slice 6) are `token_invalid` everywhere, and a GitHub `GET /user` without a valid id fails sign-in (`reason=github_user_invalid`).
- **FR-7.2** If the GitHub API call fails or the username does not exist, the system's behavior shall be defined and tested explicitly (currently unhandled — see Open Issues, OI-1).

## 3. Non-functional requirements

- **NFR-1 (Data integrity):** `location.type` must always be `"Point"`; `coordinates` must always be `[longitude, latitude]` order (GeoJSON standard) — reversal is a high-severity class of bug given three independent clients construct this payload.
- **NFR-2 (Consistency of "nearby"):** Search and the real-time push must agree on the 10 km radius. Originally duplicated (`$maxDistance: 10000` vs `calculateDistance(...) < 10`); since BUG-002 both use `utils/nearby.js`, and `features/radius.feature` asserts they agree at the boundary.
- **NFR-3 (Real-time latency):** A `new-dev` event should reach a matching connected client within a short, testable bound (suggested target: < 2s in an integration test using an in-process server) after the triggering `POST /devs`.
- **NFR-4 (Resource cleanup):** In-memory WebSocket connection state should not grow unbounded across disconnect/reconnect cycles.
- **NFR-5 (Security):** *BUG-006 fixed (auth slices 1-6). Since auth slice 4 every route that shows or changes developers (`GET /devs`, `POST /devs`, `GET /search`, and since slice 5 `GET`/`PUT`/`DELETE /devs/me`) and the Socket.io subscription require a GitHub sign-in session token; only `/auth/*` is public (`dev/docs/03-auth-spec.md`, access matrix). The text below describes the original code.* No authentication currently exists on `POST /devs`, `GET /devs`, or `GET /search`. CORS was fully open (`origin: '*'`); since 2026-11-08 it is restricted to the `CORS_ORIGINS` allow-list (Express and Socket.io). The missing authentication is an explicit, documented risk acceptance for a learning project — flagged in the Bug Tracker as known issues rather than defects, unless the project's threat model changes.
- **NFR-6 (Compatibility):** Mobile targets an unmaintained Expo SDK (36, released 2019) and `react-native-maps` 0.26.1 — environment/tooling compatibility is itself a testable NFR (does the app still build and run on currently available Xcode/Android SDK toolchains?).
- **NFR-7 (Config portability):** Mobile's API/socket base URL is hardcoded to a LAN IP (`192.168.15.11`) rather than an environment variable, unlike web (`REACT_APP_API_URL`). This blocks automated mobile testing against a configurable backend and is tracked as a defect (see Bug Tracker BUG-001).

## 4. Out of scope / not implemented (confirmed by code reading)
- No update or delete endpoints for developers (`SearchController.update`/`destroy` are stubbed and commented out). *(Since auth slice 5: implemented as `PUT`/`DELETE /devs/me` in `DevController`, see FR-1.7 to FR-1.9; the stubs are removed, BUG-008 fixed.)*
- No authentication, authorization, or rate limiting. *(Since the auth slices, delivered in full with slice 6: GitHub sign-in with session tokens, every read/write and the socket protected, `/auth/*` and profile changes rate limited, profiles owned by GitHub account id; no roles or authorization beyond "it is your own profile".)*
- No input validation layer (e.g., no check that `latitude`/`longitude` are numeric, in range, or that `github_username` is non-empty) — see Open Issues.
- No automated test suite currently exists in the repo (this project builds one).

## 5. Open issues to confirm with product owner
- **OI-1:** Behavior when `github_username` does not exist on GitHub (backend currently does not catch the Axios error — likely results in an unhandled promise rejection / 500).
- **OI-2:** Whether `techs` should support case-insensitive matching (currently exact string match server-side).
- **OI-3:** Intended behavior when GitHub API rate-limits the server (no API token is used — 60 requests/hour unauthenticated limit).
