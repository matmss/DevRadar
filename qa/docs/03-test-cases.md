# DevRadar — Detailed Test Cases

Granular, executable-by-hand test cases. Each maps to a Requirement ID and a BDD scenario in `02-test-scenarios.md`. IDs are stable — reference them from bug reports and traceability matrices.

Legend: **P** = Priority (P1 highest), **Type** = Functional / Regression / Integration / Exploratory

---

## TC-001 — Register developer with valid GitHub username
- **Requirement:** FR-1.1, FR-1.2
- **Type:** Functional | **P1**
- **Preconditions:** Backend running, MongoDB empty of this username, network access to GitHub API.
- **Steps:**
  1. `POST /devs` with `{ github_username: "gaearon", techs: "ReactJS, Redux", latitude: -23.5505, longitude: -46.6333 }`
  2. Inspect response body.
- **Expected result:** Status 200. Body contains `name`, `avatar_url`, `bio` populated from GitHub. `techs` = `["ReactJS", "Redux"]` (trimmed). `location.type` = `"Point"`, `location.coordinates` = `[-46.6333, -23.5505]`.

## TC-002 — Duplicate registration returns existing record, does not duplicate
- **Requirement:** FR-1.3
- **Type:** Functional | **P1**
- **Steps:**
  1. Register `github_username: "gaearon"`.
  2. Register `github_username: "gaearon"` again with different `techs`.
  3. `GET /devs` and count entries with `github_username: "gaearon"`.
- **Expected result:** Step 2 returns 200 with the **original** record (techs unchanged). Step 3 shows exactly 1 matching entry.

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

## TC-011 — Missing github_username is rejected
- **Requirement:** FR-1.1 (validation gap — see OI of requirements doc)
- **Type:** Functional (currently expected to FAIL — documents a defect) | **P1**
- **Steps:** `POST /devs` with `github_username` omitted.
- **Expected result (desired):** 400 with a validation error.
- **Actual result (as of this audit):** Likely 500 or unhandled rejection — becomes BUG-003 once confirmed by running the automated suite.

## TC-012 — Non-existent GitHub username
- **Requirement:** FR-7.2, OI-1
- **Type:** Functional (currently expected to FAIL) | **P1**
- **Steps:** `POST /devs` with `github_username: "ghost-user-does-not-exist-xyz"`.
- **Expected result (desired):** 404 or 422 with a clear error message, no partial DB write.
- **Actual result (as of this audit):** GitHub API 404 is not caught in `DevController.store` — likely surfaces as an unhandled promise rejection / 500. Confirm and file as BUG-004.

## TC-013 — Non-numeric latitude/longitude
- **Requirement:** Input validation gap
- **Type:** Functional (currently expected to FAIL) | **P2**
- **Steps:** `POST /devs` with `latitude: "not-a-number"`.
- **Expected result (desired):** 400.
- **Actual result:** Likely accepted and stored as `NaN` inside the GeoJSON point, corrupting the 2dsphere index entry. Confirm and file.

## TC-014 (Web) — Geolocation pre-fills coordinates
- **Requirement:** FR-5.1
- **Type:** Functional | **P2**
- **Steps:** Grant browser geolocation permission (mock via Playwright `context.setGeolocation`). Load the app.
- **Expected result:** Latitude/longitude inputs are pre-filled and match the mocked coordinates.

## TC-015 (Web) — Submitting the form updates the list without reload
- **Requirement:** FR-5.2, FR-5.3
- **Type:** Functional | **P1**
- **Steps:** Fill and submit the form with a valid GitHub username.
- **Expected result:** New `<li class="dev-item">` appears with correct avatar/name/techs/bio/profile link; no full navigation occurs; form's username/techs fields reset to empty.

## TC-016 (Web) — Developer list loads on mount
- **Requirement:** FR-5.3
- **Type:** Functional | **P2**
- **Steps:** Seed backend with 2 developers. Load the web app.
- **Expected result:** Both developers rendered in the list.

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
| FR-2 | TC-007 |
| FR-3 | TC-008, TC-009, TC-010 |
| FR-4 | TC-004, TC-005, TC-006, TC-019 |
| FR-5 | TC-014, TC-015, TC-016 |
| FR-6 | TC-017, TC-018, TC-019, TC-020, TC-021 |
| FR-7 | TC-012 |
| NFR-1/2 | TC-010 |
| NFR-7 | TC-022 |
