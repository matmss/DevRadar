# DevRadar: GitHub sign-in (BUG-006 auth part + BUG-008)

Status: **delivered** (2026-11-10, all six slices; BUG-006 and BUG-008 fixed). Approved for
development 2026-11-08. Written by the PO agent; product decisions confirmed by the product
owner. This is the source of truth for DEV and QA on this feature; how it is built is in
`dev/docs/00-architecture.md`, Authentication.

## Product decisions (confirmed)

| # | Decision |
|---|---|
| Q1 | **Everything that shows devs requires sign-in**: `GET /devs`, `GET /search` and the Socket.io subscription. No anonymous browsing. Only auth endpoints (and a health check, if added) are public. |
| Q2 | **Mobile sign-in ships in the same release as gated reads** (otherwise the map breaks). |
| Q3 | **Session = signed token valid 7 days, no refresh token.** After expiry the user signs in again. |
| Q4 | **Profile updates are broadcast live** as a new `dev-updated` Socket.io event to nearby, tech-matching subscribers (same `isNearby` + techs rule as `new-dev`, evaluated against the *new* location/techs). Mobile updates/moves the marker. |
| Q5 | Legacy (pre-auth) profile: the real GitHub owner **takes over the existing record** on sign-in (case-insensitive match). No audit log. |
| Q6 | Socket token is **checked on connect only**; an open socket is not force-closed at expiry. |
| Q7 | Delete is a **hard delete**. |
| Q8 | The product owner registers the GitHub OAuth App. Scope: **public profile only, no email** (`read:user` not needed; no scope = public data). Development and tests mock GitHub, so they don't wait for it. |
| Q9 | A `github_username` in the request body is **ignored**; the token's identity always wins. |
| Q10 | (Added for slice 6.) **A DevRadar profile belongs to a GitHub account by its numeric id** (`id` from GitHub `GET /user`), not by its login. Logins can be renamed and then registered by someone else; matching by login would let the new holder of a login take over, move or delete the previous owner's profile. The login stays as display data, refreshed from GitHub on every sign-in, and is how a legacy profile (no id yet) is matched, case-insensitively (Q5): its owner's first write claims it for their id. A profile of another id that still shows the user's login is never theirs (`POST /devs` answers 409 `github_username_conflict`; it is freed when its owner signs in under their new login). Session tokens issued before this decision carry no id and are rejected, so each user signs in again once. |

## Access matrix

| Surface | Auth |
|---|---|
| `GET /auth/github`, `GET /auth/github/callback`, token exchange endpoint | Public (rate limited) |
| `POST /devs` | Required, identity (GitHub id and login) from token |
| `PUT /devs/me`, `DELETE /devs/me` (new) | Required |
| `GET /devs`, `GET /search` | Required |
| Socket.io handshake (`new-dev`, `dev-updated`) | Required |

## User stories

### US-1 Sign in with GitHub (backend)
```
Scenario: Start the flow
  Given I am signed out
  When a client requests the login start endpoint
  Then it is redirected to GitHub's authorize URL with a per-request random, single-use `state`
  And no extra scope is requested (public profile only)

Scenario: Successful callback
  Given GitHub redirects back with a valid code and the matching state
  When the backend exchanges the code
  Then it reads my GitHub login and issues a DevRadar session token for that login
  And the GitHub access token is not returned to the client nor stored

Scenario: State mismatch or missing
  Given the callback state is missing, reused, expired, or does not match
  When the callback is called
  Then the response is 400 and no token is issued

Scenario: User denies consent
  Given the callback has error=access_denied
  Then no token is issued and the client receives a "sign-in cancelled" result it can show
```

### US-2 Protected routes
```
Scenario: No token
  When I call any protected route without an Authorization: Bearer token
  Then I get 401 with { error, details }

Scenario: Invalid or expired token
  Given my token is malformed, tampered with, or expired
  When I call any protected route
  Then I get 401 and the body lets the client distinguish "expired" from "invalid"

Scenario: Valid token
  Then the request proceeds with my GitHub account id (Q10) and login available server-side as the identity
```

### US-3 Register as myself
```
Scenario: Username from identity
  Given I am signed in as "alice"
  When I POST /devs with techs, latitude, longitude and a body github_username "bob"
  Then the dev created is "alice" ("bob" is ignored, Q9)

Scenario: First registration
  Given I am signed in as "alice" with no profile
  When I POST /devs with valid techs, latitude, longitude
  Then a profile is created with name, avatar and bio from GitHub
  And nearby tech-matching sockets receive new-dev (existing behavior)

Scenario: Existing validation preserved
  When I POST /devs with invalid coordinates or empty techs
  Then I get the same 400 as today (BUG-003/005 behavior unchanged)
```

### US-4 Update and delete my profile (BUG-008)
```
Scenario: Update location and techs
  Given I am signed in as "alice" with a profile
  When I PUT /devs/me with new techs and coordinates (same validation as POST /devs)
  Then my profile is updated and returned
  And nearby tech-matching sockets (by the NEW location/techs) receive dev-updated with the profile (Q4)

Scenario: Update without profile
  Given I am signed in with no profile
  When I PUT /devs/me
  Then I get 404

Scenario: Delete my profile
  Given I am signed in as "alice" with a profile
  When I DELETE /devs/me
  Then I get 204, and my profile no longer appears in GET /devs or GET /search, and I can register again

Scenario: Cannot touch others
  Then these routes take no username parameter, so editing/deleting another user's profile is impossible
```

### US-5 Socket authentication
```
Scenario: Authenticated handshake
  Given I connect with a valid token plus valid latitude, longitude, techs
  Then I am subscribed and receive new-dev and dev-updated pushes

Scenario: Missing or invalid token at handshake
  Given I connect without a token, or with an invalid or expired one
  Then I receive an auth error and am disconnected, I am not added to `connections`, and the server does not crash

Scenario: Token expires mid-connection
  Then the open socket is left alone (Q6); the next connect with the expired token is rejected
```

### US-6 Web sign-in and sign-out
```
Scenario: Signed out
  Given I open the web app without a session
  Then I see a "Sign in with GitHub" button, and no form or dev list

Scenario: Sign in
  Given I click "Sign in with GitHub" and approve
  When I return to the app
  Then I see my GitHub username and avatar, the form (no username field), and the dev list

Scenario: Session persists
  When I reload the page
  Then I stay signed in until the token expires

Scenario: Sign out
  When I click "Sign out"
  Then the token is cleared, protected data is hidden, and the Sign in button returns

Scenario: Expired token during use
  When a request returns 401 "expired"
  Then I see the signed-out view with "Session expired, sign in again"

Scenario: Consent denied
  Given I cancel on GitHub
  Then I see the signed-out view with "Sign-in cancelled" and can retry

Scenario: Already registered
  Given I am signed in with a profile
  Then the form is prefilled with my techs and location, the button says "Update",
  and "Delete my profile" is available behind a confirmation
```

### US-7 Mobile sign-in
```
Scenario: Signed out
  Given I open the app without a session
  Then I see a "Sign in with GitHub" screen instead of the map

Scenario: Sign in
  Given I complete GitHub sign-in in the system auth session (PKCE) and return to the app
  Then I land on the map, and /search and the socket both use my token

Scenario: Session persistence
  When I relaunch the app
  Then I land on the map without signing in again until the token expires
  And the token is in platform secure storage (expo-secure-store), not AsyncStorage

Scenario: Expired token
  When a request or socket handshake fails with an auth error
  Then I return to the sign-in screen with a message, not an empty map

Scenario: Sign out
  When I tap sign out
  Then the token is cleared and the socket is closed

Scenario: Live profile update
  When a nearby matching dev updates their profile
  Then their marker moves/updates without a new search (dev-updated)
```
Mobile registration and profile editing are out of scope.

### US-8 Legacy profiles
```
Scenario: Legacy owner signs in
  Given a profile for "alice" created before auth
  When "alice" signs in (any letter case)
  Then she owns that profile and can update or delete it (Q5)

Scenario: Legacy profiles remain visible
  Then they still appear in authenticated GET /devs and GET /search

Scenario: No data migration required
  Then deploying auth does not delete or rewrite existing documents

Scenario: The legacy profile is claimed for my GitHub account (Q10)
  Given a profile for "alice" created before auth
  When "alice" first updates, registers or deletes it (any letter case)
  Then it is tied to her GitHub id, keeps its _id and data, and is hers from then on
  And of two accounts claiming it at the same time, exactly one wins (no server error)

Scenario: A renamed login does not hand over a profile (Q10)
  Given account A registered as "alice", then renamed itself to "alice2" on GitHub without signing in again
  And account B now holds the login "alice"
  When B signs in as "alice"
  Then B cannot read, update or delete A's profile (404), and registering answers 409 github_username_conflict
  When A signs in as "alice2"
  Then the profile is still A's, now showing "alice2", and B can register as "alice"

Scenario: Old sessions
  Given a session token issued before GitHub ids were captured
  Then every protected route and the socket answer token_invalid, and the client shows its signed-out view
```

## Security and non-functional criteria
- GitHub client secret and the token-signing secret live only in backend env (`.env.example` placeholders). Never in web/mobile bundles, logs, or responses. The server refuses to start in production without them.
- OAuth `state`: random, single-use, ~10 min lifetime, verified on callback. PKCE for mobile.
- Session tokens: signed, `exp` = 7 days (Q3).
- GitHub access token is used once to read identity, then discarded.
- Post-login redirect targets are allow-listed (reuse the `CORS_ORIGINS` approach plus the mobile app scheme).
- Tokens never go in logged query strings: hand the client a short-lived one-time code (or URL fragment) that it exchanges for the token.
- Auth endpoints are rate limited.
- Registration identity comes from the OAuth identity, not the unauthenticated `GET /users/:username` lookup.
- All errors use `{ error, details }`; no stack traces or token values.

## QA expectations
- New `@smoke`/`@regression` scenarios in `qa/backend-tests` and `qa/web-tests`. GitHub OAuth endpoints mocked with `nock` (backend) and at the network level in the web harness ("only GitHub is faked"). Provide a test-only sign-in helper in the harnesses.
- Existing backend and web scenarios updated to authenticate.
- Mobile sign-in covered by Maestro flows (Detox blocked by BUG-009).
- Docs: `qa/docs/01`–`05`, BUG-006 and BUG-008 status, `dev/docs/00-architecture.md`, `CLAUDE.md`.

## Delivery order (each slice is its own PR, all delivered)
0. CORS restricted to an origin allow-list (#61, before slice 1).
1. Backend OAuth flow + token middleware (US-1, US-2), no routes protected yet (#62).
2. Protect `POST /devs`, username from token (US-3); test sign-in helper for harnesses. Closes the squatting hole (#66).
3. Web sign-in/out + registration form (US-6, minus update/delete) (#66, with slice 2).
4. Protect `GET /devs`, `GET /search` and the socket, plus mobile sign-in (US-5, US-7). Ship together (#67).
5. `PUT`/`DELETE /devs/me` + `dev-updated` event + web update/delete UI + mobile marker update (US-4, rest of US-6/US-7) (#69).
6. Legacy handling (US-8), profiles owned by GitHub id (Q10), docs, bug-tracker closure (branch `feat/auth-slice-6-dev`).

## Out of scope
Username/password or other providers; roles/admin/moderation; refresh tokens; mobile registration or
profile edit screens; privacy settings (approximate location, opt-out); further CORS work (done in #61);
CSRF beyond OAuth `state` (Bearer tokens avoid cookie CSRF); BUG-009.
