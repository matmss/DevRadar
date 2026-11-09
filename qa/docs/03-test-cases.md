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
- **Expected result:** Step 2 returns 200 with the **original** record (techs unchanged). Step 3 shows exactly 1 matching entry. The match is case-insensitive, so a legacy record created before sign-in as `gaearon` is returned to the owner signing in as `Gaearon` (US-8).

## TC-003 — Techs string parsing trims whitespace
- **Requirement:** FR-1.4
- **Type:** Functional | **P2**
- **Steps:** Register with `techs: " ReactJS ,  Node.js,Redux "`.
- **Expected result:** Persisted `techs` = `["ReactJS", "Node.js", "Redux"]`, no leading/trailing whitespace.

## TC-004 — New registration notifies matching nearby connected client
- **Requirement:** FR-1.6, FR-4.3
- **Type:** Integration | **P1**
- **Preconditions:** A WebSocket client connected with `latitude/longitude` within 10km and `techs` overlapping the soon-to-be-registered dev.
- **Steps:**
  1. Open WebSocket connection with handshake query `{ latitude, longitude, techs: "ReactJS" }`.
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
- **Steps:** Seed 3 developers in different cities. `GET /devs`.
- **Expected result:** Status 200, array of 3, regardless of any location.

## TC-008 — Search returns only nearby + matching-tech developers
- **Requirement:** FR-3.1–FR-3.3
- **Type:** Functional | **P1**
- **Steps:** Seed developers per the scenario background in `02-test-scenarios.md`. `GET /search?latitude=-23.5505&longitude=-46.6333&techs=ReactJS`.
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
- **Expected result:** New `<li class="dev-item">` appears for the signed-in user with correct avatar/name/techs/bio/profile link; no full navigation occurs; the techs field resets to empty.

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
| FR-1 | TC-001, TC-002, TC-003, TC-004, TC-011, TC-012, TC-013 |
| US-3 (auth) | TC-001, TC-002, TC-011, TC-012, TC-025 |
| US-6 (auth) | TC-015, TC-016, TC-023, TC-024, TC-025, TC-026 |
| FR-2 | TC-007 |
| FR-3 | TC-008, TC-009, TC-010 |
| FR-4 | TC-004, TC-005, TC-006, TC-019 |
| FR-5 | TC-014, TC-015, TC-016 |
| FR-6 | TC-017, TC-018, TC-019, TC-020, TC-021 |
| FR-7 | TC-012 |
| NFR-1/2 | TC-010 |
| NFR-7 | TC-022 |
