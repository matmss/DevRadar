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
- **FR-1.1** The system shall accept a new developer registration containing `github_username`, `techs` (free-text, comma-separated), `latitude`, and `longitude`.
- **FR-1.2** On registration, the system shall look up the given GitHub username via the GitHub public API and populate `name` (falling back to the username if no name is set), `avatar_url`, and `bio`.
- **FR-1.3** The system shall not create a duplicate developer record for a `github_username` that already exists; it shall return the existing record instead.
- **FR-1.4** The system shall persist `techs` as an array, parsed from the comma-separated input string, trimming whitespace around each tech.
- **FR-1.5** The system shall persist `location` as a GeoJSON `Point` (`[longitude, latitude]`) indexed with a `2dsphere` index.
- **FR-1.6** On successful registration, the system shall notify (via WebSocket) any currently-connected client whose search radius (10 km) and tech filter match the new developer.

### FR-2 — Developer listing
- **FR-2.1** The system shall expose an endpoint returning all registered developers, unfiltered.

### FR-3 — Geospatial / tech search
- **FR-3.1** The system shall expose a search endpoint accepting `latitude`, `longitude`, and `techs` (comma-separated) as query parameters.
- **FR-3.2** The system shall return only developers whose `techs` array intersects the requested `techs` list.
- **FR-3.3** The system shall return only developers within a 10,000-meter (10 km) radius of the given coordinates, using MongoDB's `$near`/`$geometry` geospatial query.

### FR-4 — Real-time updates (WebSocket)
- **FR-4.1** On WebSocket connect, the client shall supply `latitude`, `longitude`, and `techs` via the handshake query.
- **FR-4.2** The server shall track each open connection's coordinates and tech interests in memory.
- **FR-4.3** When a new developer is created, the server shall compute the Haversine distance (km) between the new developer and each open connection and emit a `new-dev` event to connections within 10 km whose tech list intersects the new developer's techs.
- **FR-4.4** The server shall support disconnect/reconnect without leaking stale in-memory connection entries indefinitely (see NFR-4).

### FR-5 — Web client
- **FR-5.1** The web app shall request the browser's geolocation on load and pre-fill latitude/longitude in the registration form (user-editable).
- **FR-5.2** The web app shall submit a registration via `POST /devs` and append the returned developer to the visible list without a full reload.
- **FR-5.3** The web app shall load and display the full developer list (`GET /devs`) on mount, showing avatar, name, techs, bio, and a link to the developer's GitHub profile.

### FR-6 — Mobile client
- **FR-6.1** The mobile app shall request device location permission and center the map on the current position once granted.
- **FR-6.2** The mobile app shall render each nearby developer as a map marker with avatar; tapping the marker shall show a callout with name, bio, and techs.
- **FR-6.3** The mobile app shall let the user filter by `techs` (free text) and trigger a search (`GET /search`) via a search button.
- **FR-6.4** Triggering a search shall (re)connect the WebSocket with the current region and techs so new matching developers appear live without re-searching.
- **FR-6.5** Tapping a marker's callout shall navigate to a Profile screen that renders the developer's GitHub profile in an in-app WebView.

### FR-7 — GitHub integration
- **FR-7.1** The system shall treat the GitHub username as the unique external identity for a developer.
- **FR-7.2** If the GitHub API call fails or the username does not exist, the system's behavior shall be defined and tested explicitly (currently unhandled — see Open Issues, OI-1).

## 3. Non-functional requirements

- **NFR-1 (Data integrity):** `location.type` must always be `"Point"`; `coordinates` must always be `[longitude, latitude]` order (GeoJSON standard) — reversal is a high-severity class of bug given three independent clients construct this payload.
- **NFR-2 (Consistency of "nearby"):** Search and the real-time push must agree on the 10 km radius. Originally duplicated (`$maxDistance: 10000` vs `calculateDistance(...) < 10`); since BUG-002 both use `utils/nearby.js`, and `features/radius.feature` asserts they agree at the boundary.
- **NFR-3 (Real-time latency):** A `new-dev` event should reach a matching connected client within a short, testable bound (suggested target: < 2s in an integration test using an in-process server) after the triggering `POST /devs`.
- **NFR-4 (Resource cleanup):** In-memory WebSocket connection state should not grow unbounded across disconnect/reconnect cycles.
- **NFR-5 (Security):** No authentication currently exists on `POST /devs`, `GET /devs`, or `GET /search`. CORS is fully open (`origin: '*'`). These are explicit, documented risk acceptances for a learning project — flagged in the Bug Tracker as known issues rather than defects, unless the project's threat model changes.
- **NFR-6 (Compatibility):** Mobile targets an unmaintained Expo SDK (36, released 2019) and `react-native-maps` 0.26.1 — environment/tooling compatibility is itself a testable NFR (does the app still build and run on currently available Xcode/Android SDK toolchains?).
- **NFR-7 (Config portability):** Mobile's API/socket base URL is hardcoded to a LAN IP (`192.168.15.11`) rather than an environment variable, unlike web (`REACT_APP_API_URL`). This blocks automated mobile testing against a configurable backend and is tracked as a defect (see Bug Tracker BUG-001).

## 4. Out of scope / not implemented (confirmed by code reading)
- No update or delete endpoints for developers (`SearchController.update`/`destroy` are stubbed and commented out).
- No authentication, authorization, or rate limiting.
- No input validation layer (e.g., no check that `latitude`/`longitude` are numeric, in range, or that `github_username` is non-empty) — see Open Issues.
- No automated test suite currently exists in the repo (this project builds one).

## 5. Open issues to confirm with product owner
- **OI-1:** Behavior when `github_username` does not exist on GitHub (backend currently does not catch the Axios error — likely results in an unhandled promise rejection / 500).
- **OI-2:** Whether `techs` should support case-insensitive matching (currently exact string match server-side).
- **OI-3:** Intended behavior when GitHub API rate-limits the server (no API token is used — 60 requests/hour unauthenticated limit).
