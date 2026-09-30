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

- **No auth layer.** Any client can register a dev as anyone (no
  verification that the submitter owns the `github_username` claimed).
  Fine for the current scope; flag before this goes anywhere near
  production data.
- **Unauthenticated GitHub API calls.** Rate-limited at 60/hr per backend
  IP. A `GITHUB_TOKEN` env var + authenticated requests would raise this to
  5,000/hr if registration volume ever becomes a bottleneck.
- **Single MongoDB collection, no pagination.** `GET /devs` returns
  everything. Fine at seed-data scale; will need pagination or a stricter
  default radius before this is a real dataset.
