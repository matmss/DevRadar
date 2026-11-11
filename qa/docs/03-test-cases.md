# DevRadar — Detailed Test Cases

Granular, executable-by-hand test cases. Each maps to a Requirement ID and a BDD scenario in `02-test-scenarios.md`. IDs are stable — reference them from bug reports and traceability matrices.

Legend: **P** = Priority (P1 highest), **Type** = Functional / Regression / Integration / Exploratory

---

## TC-001 — Register the signed-in developer
- **Requirement:** FR-1.1, FR-1.2, US-3 (`dev/docs/03-auth-spec.md`)
- **Type:** Functional | **P1**
- **Preconditions:** Backend running, MongoDB empty of this username, signed in with GitHub as `gaearon` (session token from `POST /auth/token`).
- **Steps:**
  1. `POST /devs` with `Authorization: Bearer <token>` and `{ techs: "ReactJS, Redux", latitude: -23.5505, longitude: -46.6333 }`
  2. Inspect response body.
- **Expected result:** Status 200. `github_username` is the token's login. `name`, `avatar_url`, `bio` are the GitHub profile captured at sign-in (a null name falls back to the login); no call to GitHub's `GET /users/:username`. `techs` = `["ReactJS", "Redux"]` (trimmed). `location.type` = `"Point"`, `location.coordinates` = `[-46.6333, -23.5505]`.
- **Automated:** `registration.feature` ("Register as the signed-in user with the profile captured at sign-in", "Sign in through GitHub, then register: ...").

## TC-002 — Duplicate registration returns existing record, does not duplicate
- **Requirement:** FR-1.3
- **Type:** Functional | **P1**
- **Steps:**
  1. Signed in as `gaearon`, register.
  2. Register again with different `techs`.
  3. `GET /devs` and count entries with `github_username: "gaearon"`.
- **Expected result:** Step 2 returns 200 with the **original** record (techs unchanged). Step 3 shows exactly 1 matching entry. Since auth slice 6 the record is matched by the GitHub account id; a legacy record created before sign-in as `gaearon` (no id) is matched case-insensitively and claimed by the owner signing in as `Gaearon` (US-8, same `_id` and techs, login now `Gaearon`). See TC-034.

## TC-003 — Techs string parsing trims whitespace
- **Requirement:** FR-1.4
- **Type:** Functional | **P2**
- **Steps:** Register with `techs: " ReactJS ,  Node.js,Redux "`.
- **Expected result:** Persisted `techs` = `["ReactJS", "Node.js", "Redux"]`, no leading/trailing whitespace.

## TC-004 — New registration notifies matching nearby connected client
- **Requirement:** FR-1.6, FR-4.3
- **Type:** Integration | **P1**
- **Preconditions:** A signed-in WebSocket client connected with `latitude/longitude` within 10km and `techs` overlapping the soon-to-be-registered dev.
- **Steps:**
  1. Open WebSocket connection with handshake query `{ latitude, longitude, techs: "ReactJS" }` and handshake `auth: { token }` (since auth slice 4).
  2. `POST /devs` a new developer with techs including `"ReactJS"` within 10km of the socket's coordinates.
  3. Listen for a `new-dev` event on the socket.
- **Expected result:** `new-dev` event received within 2s, payload matches the created developer.

## TC-005 — Notification NOT sent when outside 10km
- **Requirement:** FR-4.3
- **Type:** Integration | **P1**
- **Steps:** Same as TC-004 but socket coordinates > 10km from the new dev (e.g., São Paulo vs. Rio de Janeiro, ~360km apart).
- **Expected result:** No `new-dev` event received within a 3s timeout window.

## TC-006 — Notification NOT sent when techs don't overlap
- **Requirement:** FR-4.3
- **Type:** Integration | **P1**
- **Steps:** Socket watching `"Python"`; new dev registered with `techs: "ReactJS"` at the same coordinates.
- **Expected result:** No `new-dev` event received.

## TC-007 — List all developers, unfiltered
- **Requirement:** FR-2.1
- **Type:** Functional | **P2**
- **Steps:** Seed 3 developers in different cities. `GET /devs` with a session token (required since auth slice 4, TC-027).
- **Expected result:** Status 200, array of 3, regardless of any location.

## TC-008 — Search returns only nearby + matching-tech developers
- **Requirement:** FR-3.1–FR-3.3
- **Type:** Functional | **P1**
- **Steps:** Seed developers per the scenario background in `02-test-scenarios.md`. `GET /search?latitude=-23.5505&longitude=-46.6333&techs=ReactJS` with a session token (required since auth slice 4).
- **Expected result:** Only `near-match` returned; `near-no-tech` and `far-match` excluded.

## TC-009 — Search with no matching tech returns empty array
- **Requirement:** FR-3.2
- **Type:** Functional | **P3**
- **Steps:** `GET /search?...&techs=COBOL`.
- **Expected result:** Status 200, `{ devs: [] }`.

## TC-010 — 10km boundary behavior (regression guard)
- **Requirement:** FR-3.3, NFR-2
- **Type:** Regression | **P2**
- **Steps:** Seed a developer computed to be exactly 10.000km away (via Haversine) from the search origin. Run the search.
- **Expected result:** Document actual MongoDB `$maxDistance` inclusive/exclusive behavior; assert it matches. Flag as a defect if it silently diverges from the websocket layer's `< 10` (strict-less-than) comparison — see NFR-2 and BUG-002.
- **Actual result (2026-11-08):** `$maxDistance` is inclusive and measures on a 6378.1 km sphere. Automated in `qa/backend-tests/features/radius.feature`: a dev 9.995 km away is both pushed and found; one 10.005 km away is neither.

## TC-011 — Registration requires a session token; the body username is ignored
- **Requirement:** FR-1.1, US-2, US-3 (Q9)
- **Type:** Functional | **P1**
- **Steps:**
  1. `POST /devs` without an `Authorization` header.
  2. `POST /devs` with an expired token, then with a tampered/foreign-signed/malformed token.
  3. Signed in as `alice`, `POST /devs` with `github_username: "bob"` in the body.
- **Expected result:** 1: 401 `token_missing`, nothing persisted. 2: 401 `token_expired` / `token_invalid`, nothing persisted. 3: 200, the dev created is `alice`; no `bob` record is created or changed.
- **History:** Before auth slice 2 this case was "missing `github_username` is rejected" (BUG-003, fixed with a 400). The username no longer comes from the body, so it is not validated there.
- **Automated:** `registration.feature` (authentication-required and Q9 scenarios).

## TC-012 — Registration does not call GitHub
- **Requirement:** FR-7.2, OI-1, US-3 ("Registration identity comes from the OAuth identity")
- **Type:** Functional | **P1**
- **Steps:** Signed in as `gaearon`, `POST /devs` with valid input while GitHub's `GET /users/:username` is unreachable (strict `nock`).
- **Expected result:** 200, the profile comes from the sign-in snapshot, and no request to `api.github.com/users/*` is made. The backend scenarios' After hook fails any scenario that makes one.
- **History:** Before auth slice 2, registration looked the username up at GitHub, and a missing user or a GitHub failure mapped to 404/503/502 (BUG-004, fixed). That lookup is removed. GitHub failures now only happen during sign-in, where they redirect to the client with `error=sign_in_failed&reason=...` (`auth.feature`).

## TC-013 — Non-numeric latitude/longitude
- **Requirement:** Input validation gap
- **Type:** Functional (currently expected to FAIL) | **P2**
- **Steps:** Signed in, `POST /devs` with `latitude: "not-a-number"`.
- **Expected result (desired):** 400.
- **Actual result:** Likely accepted and stored as `NaN` inside the GeoJSON point, corrupting the 2dsphere index entry. Confirm and file.

## TC-014 (Web) — Geolocation pre-fills coordinates
- **Requirement:** FR-5.1
- **Type:** Functional | **P2**
- **Steps:** Grant browser geolocation permission (mock via Playwright `context.setGeolocation`). Load the app.
- **Expected result:** Latitude/longitude inputs are pre-filled and match the mocked coordinates.

## TC-015 (Web) — Submitting the form updates the list without reload
- **Requirement:** FR-5.2, FR-5.3, US-6
- **Type:** Functional | **P1**
- **Steps:** Sign in with GitHub. Fill techs (the form has no username field) and submit.
- **Expected result:** New `<li class="dev-item">` appears for the signed-in user with correct avatar/name/techs/bio/profile link; no full navigation occurs. Since auth slice 5 the form then switches to update mode ("Atualizar") with the saved techs (it used to reset to empty), see TC-033.

## TC-016 (Web) — Developer list loads on mount
- **Requirement:** FR-5.3
- **Type:** Functional | **P2**
- **Steps:** Seed backend with 2 developers. Load the web app and sign in.
- **Expected result:** Both developers rendered in the list. Signed out, no list is shown.

## TC-023 (Web) — Signed-out view, sign in and sign out
- **Requirement:** US-6
- **Type:** Functional | **P1**
- **Steps:**
  1. Open the app without a session.
  2. Click "Entrar com GitHub" and approve on GitHub.
  3. Reload the page.
  4. Click "Sair", then reload.
- **Expected result:** 1: only the sign-in button; no form or dev list. 2: back on `/` without `code` in the URL; GitHub username and avatar, "Sair", the form (no username field) and the dev list are shown; the PKCE verifier is gone from sessionStorage. 3: still signed in. 4: signed-out view; the token is removed from localStorage and stays signed out after reload.
- **Automated:** `qa/web-tests/features/auth.feature`.

## TC-024 (Web) — Sign-in cancelled, failed, expired or forged
- **Requirement:** US-6
- **Type:** Functional / Edge | **P1**
- **Steps / expected result:**
  - Cancel on GitHub's consent page: signed-out view with "Login cancelado"; clicking "Entrar com GitHub" again works.
  - GitHub fails during sign-in (`sign_in_failed`, `reason=github_unavailable`): "Não foi possível falar com o GitHub, tente novamente".
  - Expired token in localStorage on load, or a request answering 401 `token_expired` during use: signed-out view with "Sessão expirada, entre novamente", token removed. An invalid token: signed-out view, no message.
  - A callback link with a code this browser did not start (no PKCE verifier), or with extra parameters such as `redirect=//evil.example/`: not signed in, generic failure message, and the browser stays on the app's `/`.
- **Automated:** `qa/web-tests/features/auth.feature`, `registration.feature` (expiry during use).

## TC-025 — Concurrent registrations by the same user store one developer
- **Requirement:** FR-1.3, US-3 (QA-AUTH2-1)
- **Type:** Regression / Edge | **P1**
- **Steps:** Signed in as `gaearon`, send 5 `POST /devs` at once (also: same login in two letter cases; and double-click "Salvar" on the web) with a socket watching the area.
- **Expected result:** Every request answers 200 with the same dev; exactly one `gaearon` record exists (unique case-insensitive index + atomic upsert; a lost race answers the existing dev, not a 500); the socket receives exactly one `new-dev`.
- **Automated:** `qa/backend-tests/features/auth-slice2-review.feature`, `registration.feature`, `realtime.feature`; `qa/web-tests/features/auth-review.feature`.

## TC-026 (Web) — Sessions across tabs and odd session answers
- **Requirement:** US-6 (QA-AUTH2-3/4/5)
- **Type:** Edge | **P2**
- **Steps / expected result:**
  - Sign out in a second tab: the first tab shows the signed-out view. Sign in as another account in a second tab: the first tab never registers anyone but the user it shows.
  - Any 401 from `GET /auth/me` or `POST /devs`, whatever its `code`: signed-out view (expired message only for `token_expired`).
  - `GET /auth/me` answers 429: token kept, "Muitas tentativas em pouco tempo, tente novamente mais tarde", "Tentar novamente" and "Sair".
  - A `/auth/callback` link opened while signed in: the stored session stays and is shown; the view always matches what is stored.
- **Automated:** `qa/web-tests/features/auth-review.feature`, `auth.feature`.

## TC-027 — Reads require a session token
- **Requirement:** FR-2.1, FR-3.1, NFR-5, US-5 (Q1)
- **Type:** Security / Regression | **P1**
- **Steps:** `GET /devs` and `GET /search?latitude=-23.5505&longitude=-46.6333&techs=ReactJS` with no token, an expired token, each invalid kind (tampered, foreign-signed, alg-none, malformed, profile-less, forged profile), a token in the query string, and a valid token. Also `GET /search` without token or params, and `GET /devs` from origin `http://localhost:3000` without a token.
- **Expected result:** 401 `{ error, code, details }` with `token_missing` / `token_expired` / `token_invalid` and a `WWW-Authenticate` challenge, no developer in the body; the query-string token counts as missing; `/search` without anything is 401, not 400; the 401 to the web origin still has `Access-Control-Allow-Origin`; a valid token gets 200. `/auth/*` stays public.
- **Automated:** `qa/backend-tests/features/read-auth.feature`, `auth.feature` ("Reads are protected, sign-in is not").

## TC-028 — The socket handshake requires a session token (US-5, Q6)
- **Requirement:** FR-4.1, NFR-4, US-5
- **Type:** Security / Integration | **P1**
- **Steps:** Connect socket.io-client with `auth: { token }` + valid query; then without a token, with an expired one, with each invalid kind, with a valid token only in the query string or only in an `Authorization` header, and without token or params. Then 20 refused handshakes followed by a valid client and a registration. Finally connect validly, move the clock 8 days, register a dev, and reconnect with the same token.
- **Expected result:** The valid client is subscribed and gets `new-dev`. Every other handshake gets `connect_error` with `data.code` `token_missing` / `token_expired` / `token_invalid` (the token is checked before the params), is not connected, is not in the server's subscriptions, gets no pushes, and the refusal carries no token. The server keeps serving. After 8 days the open socket still receives `new-dev` and stays connected, while the reconnect is refused `token_expired`.
- **Automated:** `qa/backend-tests/features/realtime-auth.feature`, `unit/socketHandshake.test.js`; `realtime.feature` (BUG-011, now `subscription_invalid`).

## TC-029 (Web) — Protected list, 401 races and hung session checks
- **Requirement:** FR-5.3, US-6 (QA follow-ups from slice 3)
- **Type:** Edge | **P2**
- **Steps / expected result:**
  - Signed in: `GET /devs` carries `Authorization: Bearer <stored token>` (not in the URL).
  - `GET /devs` answers 401 `token_expired`: signed-out view, "Sessão expirada, entre novamente", token cleared.
  - Another tab stores a new session while this tab's `GET /devs` is in flight, then that request answers 401: the new session is kept and shown (cleared only if the stored token is still the one the request carried).
  - `GET /auth/me` never answers: after the 10 s timeout, "Não foi possível falar com o servidor, tente novamente mais tarde" with "Tentar novamente" and "Sair", token kept; retry signs in.
- **Automated:** `qa/web-tests/features/auth-slice4.feature`; `dev/web/src/services/{session,api}.test.js`.

## TC-030 (Mobile) — Sign in with GitHub, session, sign out (US-7)
- **Requirement:** FR-6.0, US-7
- **Type:** Functional / Security | **P1**
- **Steps / expected result:**
  - Fresh install: "Entrar com GitHub" screen, no map, no search, no location prompt.
  - Tap it, close the auth session: "Login cancelado".
  - Sign in with GitHub: lands on the map with the username and "Sair"; `/search` and the socket carry the token (header / handshake `auth`).
  - Relaunch: map again without signing in; the token is in `expo-secure-store`, not AsyncStorage.
  - Expired or invalid token at launch, on `/search` or at the socket handshake: back to the sign-in screen with "Sessão expirada, entre novamente" (expired) or "Sua sessão não é mais válida, entre novamente", not an empty map.
  - "Sair": sign-in screen, token removed, socket closed; a relaunch stays signed out.
- **Automated:** `dev/tests/mobile/**` (Jest: PKCE, secure storage, error mapping, api/socket wiring, sign-in flow, scheme consistency, `SessionProvider`); Maestro `qa/mobile-tests/maestro/00`, `04` (no backend/GitHub needed), `01`, `02`, `03`, `05` (sign in with a real GitHub test account). Expiry on device is manual (see `qa/mobile-tests/README.md`).

## TC-031 — Update my own profile: PUT /devs/me (US-4, BUG-008)
- **Requirement:** FR-1.7, FR-1.8, FR-4.5, US-4, Q4, Q9
- **Type:** Functional / Security | **P1**
- **Preconditions:** Signed in as `gaearon` (session token), `gaearon` registered with techs `Node.js` in São Paulo.
- **Steps / expected result:**
  - `GET /devs/me`: 200 with the profile. Signed in as a user without one: 404 `{ error, code: "dev_not_found", details }`. No token: 401 `token_missing`.
  - `PUT /devs/me` `{ techs: " Elixir ,, Go ", latitude: -22.9068, longitude: -43.1729 }`: 200 with techs `["Elixir", "Go"]` and `location.coordinates` `[-43.1729, -22.9068]`; `name`/`avatar_url`/`bio` are the sign-in profile; `GET /search` finds it in Rio, not in São Paulo.
  - Missing/invalid `techs`, `latitude` or `longitude` (including a body with only `techs`): 400 `{ error, details }`, same messages as `POST /devs`, nothing changed.
  - A body with `github_username`/`_id` of another dev, `name`, `avatar_url`, `bio`, `location`: ignored; only the signed-in user's profile changes.
  - Signed in as `gaearon`, legacy profile stored as `GAEARON` (no `github_id`): updated and claimed for the account (`github_id` set, same `_id`); since auth slice 6 its `github_username` becomes `gaearon`, the login as GitHub spells it (see TC-034).
  - No profile: 404 `dev_not_found`, nothing created. No/expired token: 401, nothing changed. `PUT /devs/bob`: 404 `not_found`.
  - Socket clients: a client matching the new position and techs gets `dev-updated` with the updated dev and no `new-dev`; clients that only matched the old position or techs get nothing; a 400/404 pushes nothing.
- **Automated:** `qa/backend-tests/features/profile.feature`.

## TC-032 — Delete my own profile: DELETE /devs/me (US-4, Q7)
- **Requirement:** FR-1.9, FR-4.6, US-4
- **Type:** Functional / Security | **P1**
- **Steps / expected result:**
  - `DELETE /devs/me`: 204 with an empty body; the profile is gone from `GET /devs`, `GET /search` and `GET /devs/me` (404); `POST /devs` then registers a new profile with the new techs.
  - Legacy profile in another letter case: deleted. No profile, or a second `DELETE`: 404 `dev_not_found`. No/invalid/expired token: 401, nothing deleted.
  - A socket client matching the deleted dev's last position and techs gets `dev-deleted` with only `{ _id, github_id, github_username }`; others get nothing.
  - 6 `PUT`s racing one `DELETE`: the delete answers 204, each update 200 or 404 `dev_not_found`, never 500, and the profile stays deleted. An update applied just after the delete: 404, not resurrected.
  - Since the slice 5 review: a slow `PUT` followed by a `DELETE` announces `dev-updated` before `dev-deleted`, and two `PUT`s are announced in the order applied; `PUT`/`DELETE` over `PROFILE_RATE_LIMIT_MAX` for one GitHub account (per login before slice 6) answer 429 `rate_limited` (other accounts unaffected); 31 techs, or a tech over 50 characters, answer 400 on `POST /devs` and `PUT /devs/me`.
- **Automated:** `qa/backend-tests/features/profile.feature`, `qa/backend-tests/features/auth-slice5-review.feature` (radius edge); `unit/keyedQueue.test.js`, `unit/validateDevInputLimits.test.js`.

## TC-033 (Web) — Update and delete my profile (US-6 "Already registered")
- **Requirement:** FR-5.4, US-6
- **Type:** Functional | **P1**
- **Steps / expected result:**
  - Signed in with a profile (also a legacy one in another letter case): the form shows the saved techs ("ReactJS, Redux") and the saved coordinates even when the browser reports another position; "Atualizar" and "Excluir meu perfil", no "Salvar".
  - Change techs/location and click "Atualizar": "Perfil atualizado", the list entry shows the new techs, the backend has them, a reload still shows them. A 400 shows the error and keeps the input. A double-click sends one `PUT` (buttons disabled while in flight).
  - "Excluir meu perfil": an in-page confirmation ("Confirmar exclusão" / "Cancelar"), never a native dialog. "Cancelar" keeps the profile. "Confirmar exclusão": "Perfil excluído", registration form ("Salvar", empty techs), the entry leaves the list, the backend no longer has it; registering again works.
  - Profile deleted on another device, then "Atualizar": "Seu perfil não existe mais, cadastre-se novamente" and the registration form.
  - Since the slice 5 review: a 404 that is not `dev_not_found` on update or delete shows the error and keeps the update form (QA-AUTH5-1); a stored coordinate like 1e-7 is prefilled as "0.0000001" and an unchanged "Atualizar" succeeds (QA-AUTH5-2); after `dev_not_found` on update the typed values stay in the registration form; "Salvar" answered with an existing profile shows "Você já tinha um perfil cadastrado (...)" and keeps the typed values in the update form; a profile re-created elsewhere is listed once.
- **Automated:** `qa/web-tests/features/profile.feature`, `qa/web-tests/features/auth-slice5-review.feature`, `qa/web-tests/features/auth-slice6.feature`; `dev/web/src/components/DevForm/DevForm.test.js`, `dev/web/src/services/coordinates.test.js`, `dev/web/src/services/devList.test.js` (list entries matched by `_id`, then `github_id`, then login for legacy entries).

## TC-034 — Profiles belong to a GitHub account id; legacy profiles (US-8, Q5, Q10)
- **Requirement:** FR-7.1, FR-7.3, FR-1.3, FR-1.8, FR-1.9, US-8, Q10
- **Type:** Functional / Security | **P1**
- **Preconditions:** Legacy profiles are documents without `github_id` (as stored before sign-in existed). Accounts are told apart by their GitHub id (fixtures: `gaearon` 810438, explicit ids 501/502 for the rename case).
- **Steps / expected result:**
  - Legacy `alice`/`ALICE`, signed in as `alice`/`Alice`: the first `PUT`, `POST` or `DELETE` claims it (`github_id` set, same `_id`; `POST` keeps techs, location, name, bio). `GET /devs/me` returns it but writes nothing. It is listed in `GET /devs` and found by `GET /search` for any signed-in user.
  - Deploy: legacy documents inserted without the new indexes; building the indexes at startup leaves every document byte-for-byte unchanged; `github_id_unique` is unique with `partialFilterExpression: { github_id: { $exists: true } }`; `github_username_unique_ci` still exists.
  - Two accounts (501 `alice`, 502 `ALICE`) writing to legacy `alice` at the same time: exactly one claims it; the other gets 404 `dev_not_found` (`PUT`/`DELETE`) or 409 `github_username_conflict` (`POST`); never 500.
  - Renamed login: dev `alice` owned by 501; 502 signs in as `alice` through GitHub: 501's dev is **displaced** (login `_stale_<_id>`, `github_username_stale: true`, every other field byte-for-byte unchanged, not deleted, still listed, `dev-updated` pushed); `GET`/`PUT`/`DELETE /devs/me` 404 for 502; `POST /devs` registers 502 as `alice`. The newest GitHub read wins on writes too (QA-AUTH6-4): a `POST /devs` (also without a displacing sign-in) or a `PUT /devs/me` whose session read is newer than the holder's state displaces it; if 501's two-day-old `alice` session registers or claims `alice` after 502 signed in, 502's registration still succeeds and displaces it. A session whose read is older than the holder's confirmed login never takes it: `POST /devs` 409 `github_username_conflict` (body names only the login, holder unchanged byte for byte), `PUT` keeps its own stored login.
  - 501 signs in as `alice2`: the dev's login becomes `alice2` at sign-in (`dev-updated` pushed), same `_id`, stale flag cleared; 502 can then register `alice`. A `PUT` by 501 as `alice2` also refreshes it. A token of 501 read 1-2 days before (login `alice`) can still update the dev but never sets the login back (also after a displacement, and for a claimed legacy dev, QA-AUTH6-2). A sign-in that read GitHub before another sign-in of the same account but redeemed its code later never sets the older login (QA-AUTH6-3). A sign-in whose read is older than the holder's confirmed login displaces nothing.
  - Logins stay unique (QA-AUTH6-1): two accounts that swapped logins, and three accounts that rotated them, converge once each signs in, in any order, also when two sign-ins run at the same time (both accounts locked in sorted order, no deadlock). A legacy dev showing a login whose holder already owns a dev is displaced at that holder's sign-in (not deleted, no longer claimable by login); a legacy dev its signer can still claim is not touched. Legacy devs stored with `github_id: null` are claimed like ones without the field (no 500), and several coexist under the unique index.
  - Session tokens: `sub` is the GitHub id as a string, `login` and `login_read_at` (GitHub read time, ms, not after `iat`) are claims; `POST /auth/token` and `GET /auth/me` return `github_id`. Tokens without an id (subject = login, as before slice 6), without a `login` claim, with a non-canonical id, without `login_read_at` or with one after `iat`: 401 `token_invalid` on every protected route and refused at the socket handshake. A server clock that steps back by 1.5 s between the callback and `POST /auth/token`: the sign-in still succeeds (read time clamped to the issue second, QA-AUTH6-5). A displaced dev whose name was its old login gets no name (clients show "Dev sem nome"), and its owner's next sign-in gives it the new login as name. GitHub `GET /user` without a valid `id` (missing, null, a string, 0, negative, fractional, above 2^53, boolean): `sign_in_failed` with `reason=github_user_invalid`, no sign-in code.
  - Clients: a stored pre-slice-6 token shows the web signed-out view (no message) and the mobile sign-in screen ("Sua sessão não é mais válida, entre novamente"); signing in again works. Lists and markers match by `_id`, then `github_id`, so two accounts showing the same login are never merged. A displaced dev shows its name and "Perfil do GitHub indisponível", with no GitHub link on the web, a callout that does not open the Profile screen on mobile, and a Profile screen that never opens a WebView for a placeholder.
- **Automated:** `qa/backend-tests/features/legacy-profiles.feature`, `auth-slice6-review.feature` and `auth-slice6-recheck.feature` (QA), `realtime-auth.feature` (old tokens at the handshake), `registration.feature`/`profile.feature` (legacy letter case); `unit/{sessionToken,githubId,requireAuth,socketHandshake,keyedQueue}.test.js`; `qa/web-tests/features/auth-slice6.feature`; `dev/web/src/services/devList.test.js`, `dev/web/src/components/DevItem/DevItem.test.js`; `dev/tests/mobile/{SessionContext,services/devList,pages/Main,pages/Profile}.test.js`.

## TC-017 (Mobile) — Map centers on current location
- **Requirement:** FR-6.1
- **Type:** Functional | **P2**
- **Steps:** Grant location permission (Detox mock). Launch app.
- **Expected result:** `MapView`'s `initialRegion` matches the mocked device coordinates.

## TC-018 (Mobile) — Search renders markers for matching nearby developers
- **Requirement:** FR-6.2, FR-6.3
- **Type:** Functional | **P1**
- **Steps:** Seed backend, enter tech filter, tap search button.
- **Expected result:** One marker per matching developer appears; tapping shows correct callout content.

## TC-019 (Mobile) — Live update without re-searching
- **Requirement:** FR-6.4, FR-4.3
- **Type:** Integration | **P1**
- **Steps:** After a search, register a new matching developer via a direct API call while the app is foregrounded.
- **Expected result:** A new marker appears without the user tapping search again.
- **Since auth slice 5 (FR-6.6, US-7 "Live profile update"):** a matching developer on the map then updates their techs/location (`PUT /devs/me`): their marker moves/updates in place (callout shows the new techs) without a new search; a matching developer not on the map is added; a developer who deletes their profile (`DELETE /devs/me`) disappears. Automated with Jest (`dev/tests/mobile/pages/Main.test.js`, `services/devList.test.js`, `services/socket.test.js`); on a device it is manual (needs a second account updating from the web).

## TC-020 (Mobile) — Profile WebView navigation
- **Requirement:** FR-6.5
- **Type:** Functional | **P2**
- **Steps:** Tap a marker's callout.
- **Expected result:** Navigates to Profile screen; WebView source URI is `https://github.com/<github_username>`.

## TC-021 (Mobile) — Location permission denied does not crash
- **Requirement:** FR-6.1 (edge case)
- **Type:** Exploratory → promoted to regression | **P2**
- **Steps:** Deny location permission at OS level, launch app.
- **Expected result:** App does not crash; renders `null`/loading state gracefully (currently returns `null` indefinitely with no retry affordance — UX gap to flag, not necessarily a hard bug).

## TC-022 — Config portability: mobile base URL is hardcoded
- **Requirement:** NFR-7
- **Type:** Regression (infra) | **P1**
- **Steps:** Attempt to point the mobile app at a CI-hosted backend without editing source.
- **Expected result (desired):** Configurable via env var like web's `REACT_APP_API_URL`.
- **Actual result:** Hardcoded `192.168.15.11` in both `dev/mobile/src/services/api.js` and `socket.js` — blocks CI automation until fixed. Tracked as BUG-001 (blocker for mobile CI).

---

## Traceability summary

| Requirement | Test Cases |
|---|---|
| FR-1 | TC-001, TC-002, TC-003, TC-004, TC-011, TC-012, TC-013, TC-031, TC-032 |
| US-3 (auth) | TC-001, TC-002, TC-011, TC-012, TC-025 |
| US-4 (auth) | TC-031, TC-032, TC-033 |
| US-6 (auth) | TC-015, TC-016, TC-023, TC-024, TC-025, TC-026, TC-029, TC-033 |
| US-5 (auth) | TC-027, TC-028 |
| US-7 (auth) | TC-019, TC-030, TC-034 |
| US-8, Q10 (auth) | TC-002, TC-031, TC-032, TC-034 |
| FR-2 | TC-007, TC-027 |
| FR-3 | TC-008, TC-009, TC-010, TC-027 |
| FR-4 | TC-004, TC-005, TC-006, TC-019, TC-028, TC-031, TC-032 |
| FR-5 | TC-014, TC-015, TC-016, TC-029, TC-033 |
| FR-6 | TC-017, TC-018, TC-019, TC-020, TC-021, TC-030 |
| FR-7 | TC-012, TC-034 |
| NFR-1/2 | TC-010 |
| NFR-7 | TC-022 |
