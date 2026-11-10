# DevRadar — BDD Test Scenarios

Written in Gherkin. These are the human-readable scenario source of truth — the executable `.feature` files in the automation scaffold (`/backend-tests`, `/web-tests`, `/mobile-tests`) mirror these 1:1. Each scenario references the Requirement ID(s) it verifies.

## Feature: Developer Registration (Backend) — covers FR-1, US-3

Since auth slice 2 (`dev/docs/03-auth-spec.md`, US-3), `POST /devs` requires a session token. The dev is
the token's GitHub login (a body `github_username` is ignored, Q9) and name/avatar/bio come from the
profile captured at sign-in (a snapshot as of sign-in): registration makes no GitHub API call. The full
executable set is `qa/backend-tests/features/registration.feature`; summary:

```gherkin
Feature: Developer registration as the signed-in GitHub user (US-3)

  Background:
    Given the developer database is empty

  Scenario: Registering without a session token is rejected
    When I submit a registration with github_username "gaearon", techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 401
    And the response should be an auth error with code "token_missing"

  Scenario Outline: Registering with an expired or invalid session token is rejected
    Given I have a <kind> session token
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 401 with code "<code>"
    # expired -> token_expired; tampered, foreign-signed, alg-none, malformed, profile-less, forged-profile -> token_invalid

  Scenario: Register as the signed-in user with the profile captured at sign-in
    Given I am signed in as "gaearon"
    When I submit a registration with techs "ReactJS, Redux", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the stored developer "gaearon" should have the name, avatar_url and bio of "gaearon"'s GitHub profile
    And the developer's techs should be ["ReactJS", "Redux"]
    And no call should have been made to GitHub's public users API

  Scenario Outline: A github_username in the body is ignored
    Given I am signed in as "alice"
    When I submit a registration with github_username "<body username>", techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the registered developer should be "alice"
    # body username: bob, gaearon, empty, ../orgs/x, -bad-name-

  Scenario: Registering again returns the existing profile unchanged
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I am signed in as "gaearon"
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then exactly 1 developer with github_username "gaearon" should exist and its techs should be unchanged

  Scenario: A legacy profile is returned to its owner signing in with different letter case (US-8)
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I signed in through GitHub as "Gaearon"
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the registered developer should be "gaearon" and the database should contain exactly 1 developer

  Scenario: Registration triggers a real-time notification to a matching nearby listener
    Given I am signed in as "gaearon"
    And a client is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    When I submit a registration with techs "ReactJS", latitude "-23.5510" and longitude "-46.6330"
    Then the connected client should receive a "new-dev" event with github_username "gaearon"
    # Not notified: listener outside 10 km, or techs not matching (realtime.feature)

  @edge
  Scenario Outline: Invalid registration input is rejected with 400 (validation unchanged)
    Given I am signed in as "gaearon"
    When I submit a registration with techs "<techs>", latitude "<lat>" and longitude "<lon>"
    Then the response status should be 400

    Examples:
      | techs   | lat          | lon      |
      |         | -23.5505     | -46.6333 |
      | ReactJS | not-a-number | -46.6333 |
      | ReactJS | 91           | -46.6333 |

  @edge
  Scenario: Sign-in profile values are sanitized
    # null or invisible-only name -> login; bio cut to 160 characters (400 bytes); avatar_url kept only if https;
    # control and bidi-override characters replaced (registration.feature, unit/githubProfile.test.js)
```

## Feature: Developer Listing (Backend) — covers FR-2

```gherkin
Feature: List all developers

  Background:
    Given I am signed in as "gaearon"

  Scenario: Listing developers returns everyone regardless of location
    Given 3 developers exist scattered across different cities
    When I request the list of all developers
    Then the response status should be 200
    And the response should contain 3 developers
```

## Feature: Update and delete my profile (Backend) — covers FR-1.7 to FR-1.9, FR-4.5, FR-4.6, US-4, BUG-008

Automated in `qa/backend-tests/features/profile.feature` (auth slice 5).

```gherkin
Feature: Update and delete my own developer profile (US-4, BUG-008)

  Scenario: I can read my own profile (GET /devs/me); 404 dev_not_found without one; 401 without a token

  Scenario: Update my techs and location
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I am signed in as "gaearon"
    When I update my profile with techs " Elixir ,, Go ", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 200
    And the developer's techs should be "Elixir,Go"
    And the stored developer "gaearon" should be at latitude "-22.9068" and longitude "-43.1729"

  Scenario: An updated profile shows up in search at its new location only
  Scenario: An update refreshes name, avatar and bio from the profile captured at sign-in
  Scenario: Updating when I have no profile is a 404 and creates nothing
  Scenario: Updating without a token (401 token_missing) or with an expired one (token_expired) changes nothing
  Scenario Outline: Invalid update input is rejected with the same 400 as registration
  Scenario: An update with only some of the fields is rejected (no partial PUT)
  Scenario: Identity fields in the update body (github_username, _id, name, avatar_url, bio, location) are ignored (Q9)
  Scenario Outline: The owner of a legacy profile in another letter case can update it (US-8)
  Scenario: Another user's profile cannot be changed or deleted through a /devs/<username> path (404 not_found)

  Scenario: Delete my profile: it is gone from the list and search, and I can register again
    Given a developer already exists with github_username "gaearon" and techs "ReactJS"
    And I am signed in as "gaearon"
    When I delete my profile
    Then the response status should be 204
    And GET /devs, GET /search and GET /devs/me no longer return it
    And registering again creates a new profile with the new techs

  Scenario: Deleting a legacy profile in another letter case; deleting without a profile (404); deleting twice (204, then 404)
  Scenario: Deleting without a token, with an invalid or an expired one is rejected (401) and deletes nothing

  @edge
  Scenario: Updates racing a delete do not crash or resurrect the profile
  @edge
  Scenario: An update applied just after a delete answers 404 and does not resurrect the profile

  # Live pushes (Q4)
  Scenario: An update is pushed as dev-updated, never as new-dev, to subscribers matching the new position and techs
  Scenario: Subscribers that only matched the old position or the old techs get no dev-updated
  Scenario: A rejected or not-found update pushes nothing
  Scenario: A delete is pushed as dev-deleted, with only the id and login, to subscribers matching the last position and techs
```

## Feature: Reads and live updates require sign-in (Backend) — covers FR-2.1, FR-3.1, FR-4.1, US-5, Q6

```gherkin
Feature: Reading developers requires sign-in

  Scenario Outline: Reading without a valid session token is rejected
    Given I have <token>
    When I call GET "/devs" or GET "/search?latitude=...&longitude=...&techs=ReactJS"
    Then the response status should be 401 with code "<code>"
    And no developer is revealed
    Examples:
      | token                                         | code          |
      | no session token                              | token_missing |
      | an expired session token                      | token_expired |
      | a tampered/foreign-signed/alg-none/malformed token | token_invalid |

  Scenario: A token in the query string is not accepted
  Scenario: Search checks the session token before its parameters (401, not 400)
  Scenario: A 401 to the web app's origin still carries the CORS header

Feature: The live subscription requires sign-in

  Scenario: A client with a valid session token is subscribed and receives new-dev
  Scenario Outline: A handshake without, with an expired or with an invalid token is refused
    Then the client gets connect_error with data.code token_missing / token_expired / token_invalid
    And it is not connected and not in the server's subscriptions
  Scenario: A token in the query string or an Authorization header is not accepted (token_missing)
  Scenario: Authentication is checked before the subscription params
  Scenario: Refused clients get no pushes, and the server keeps serving signed-in clients
  Scenario: An open socket survives the expiry of its session token, a reconnect does not (Q6)
```

## Feature: Geospatial & Tech Search (Backend) — covers FR-3, NFR-1, NFR-2

```gherkin
Feature: Search developers by location and tech
  As a developer using DevRadar
  I want to find nearby developers who know specific technologies
  So that I can network with them

  Background:
    Given the following developers exist:
      | github_username | techs             | latitude  | longitude  |
      | near-match       | ReactJS,Node.js   | -23.5505  | -46.6333   |
      | near-no-tech     | Python            | -23.5506  | -46.6334   |
      | far-match        | ReactJS           | -22.9068  | -43.1729   |

  Scenario: Search returns only nearby developers with a matching tech
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    Then the response should contain exactly 1 developer
    And the response should include "near-match"

  Scenario: Search excludes developers outside the 10km radius even with matching tech
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    Then the response should not include "far-match"

  Scenario: Search excludes nearby developers without a matching tech
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    Then the response should not include "near-no-tech"

  @edge
  Scenario: Search with a tech nobody has returns an empty list
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "COBOL"
    Then the response should contain exactly 0 developers

  @regression
  Scenario: A developer exactly at the 10km boundary
    Given a developer "boundary-dev" exists exactly 10.0km from latitude "-23.5505", longitude "-46.6333" with techs "ReactJS"
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    Then the inclusion of "boundary-dev" should match the documented $maxDistance boundary behavior (inclusive/exclusive — see NFR-2)
```

## Feature: Web — Sign-in and Registration Form — covers FR-5, US-6

Executable in `qa/web-tests/features/auth.feature` and `registration.feature`. GitHub is faked at the network
level (its authorize page via Playwright, its OAuth API via nock in the harness backend).

```gherkin
Feature: Sign in and out of the web app with GitHub (US-6)

  Scenario: Signed out, I only see the sign-in button
    When I open the DevRadar web app
    Then I see "Entrar com GitHub", and no form or developer list

  Scenario: Signing in shows my GitHub username and avatar, the form and the dev list
    Given GitHub will sign me in as "gaearon"
    When I open the DevRadar web app and sign in with GitHub
    Then I see "gaearon", my avatar, the form and the developer list
    And the address bar shows the app without the sign-in code

  Scenario: The session survives a page reload
  Scenario: Signing out clears the session and hides the app
  Scenario: Cancelling on GitHub shows "Login cancelado", and I can retry
  Scenario: A GitHub failure during sign-in shows a clear message
  Scenario: An expired session (on load, or during use) returns to the signed-out view with "Sessão expirada, entre novamente"
  Scenario: A forged sign-in callback link does not sign me in or navigate away

Feature: Register as the signed-in developer from the web app

  Scenario: Browser geolocation pre-fills the coordinates
    Given the browser grants geolocation permission
    And I am signed in with GitHub as "gaearon"
    Then the latitude and longitude fields should be pre-filled with the browser's coordinates

  Scenario: The registration form has no username field and registers the signed-in user
    Given I am signed in with GitHub as "alice"
    When I fill in techs "Elixir" and submit
    Then a new entry for "alice" should appear in the developer list without a page reload
    And the form should switch to update mode ("Atualizar") with the saved techs (since auth slice 5)

  @edge
  Scenario: Geolocation permission denied still allows manual entry
    Given the browser denies geolocation permission
    And I am signed in with GitHub as "gaearon"
    When I manually fill in latitude "-23.5505" and longitude "-46.6333"
    And I fill in techs "ReactJS" and submit
    Then a new entry for "gaearon" should appear in the developer list

  Scenario: Developer list loads existing developers after sign-in
    Given 2 developers are already registered in the backend
    When I sign in
    Then the developer list should show 2 entries

  # Auth slice 4 (GET /devs protected) and QA follow-ups from slice 3
  Scenario: The developer list is requested with my session token
  Scenario: A 401 on the developer list signs me out ("Sessão expirada, entre novamente")
  Scenario: A 401 for a token another tab has replaced keeps the new session
  Scenario: A session check that never answers shows the "unavailable" view instead of loading forever

Feature: Update and delete my profile from the web app (US-6 "Already registered", US-4)

  # Auth slice 5, automated in qa/web-tests/features/profile.feature
  Scenario: An already registered developer sees the form prefilled with the saved profile
    Given I have a profile with techs "ReactJS,Redux" in São Paulo
    And the browser reports a position in Rio de Janeiro
    When I sign in with GitHub
    Then the form shows "ReactJS, Redux" and the saved São Paulo coordinates, with "Atualizar" and "Excluir meu perfil"

  Scenario: Updating my profile changes the list and the backend ("Perfil atualizado", survives a reload)
  @edge
  Scenario: A rejected update shows the server's error and keeps the input
  @edge
  Scenario: Double-clicking "Atualizar" sends one update (buttons disabled while in flight)
  Scenario: Deleting my profile after confirming in the page returns the form to registration ("Perfil excluído"), no native dialog
  Scenario: Cancelling the confirmation keeps my profile
  Scenario: After deleting my profile I can register again
  Scenario: Registering switches the form to update mode
  Scenario: A legacy profile in another letter case is shown as mine
  @edge
  Scenario: Updating a profile that was deleted elsewhere offers registration again
```

## Feature: Mobile — Sign-in — covers FR-6.0, US-7

```gherkin
Feature: Sign in to the mobile app with GitHub

  Scenario: Signed out, I see "Entrar com GitHub" instead of the map
    Given the app has no stored session
    When the app launches
    Then I see the "Entrar com GitHub" screen and no map, no search and no location prompt

  Scenario: Sign in lands on the map, and /search and the socket use my token
    When I complete GitHub sign-in in the system auth session
    Then I land on the map with my username and "Sair" in the header

  Scenario: Closing the auth session shows "Login cancelado"
  Scenario: The session survives a relaunch (token in expo-secure-store, not AsyncStorage)
  Scenario: An auth failure from /search or the socket returns to sign-in with a message
    ("Sessão expirada, entre novamente" when expired), not an empty map
  Scenario: "Sair" clears the token and closes the socket
```

## Feature: Mobile — Map Search & Live Updates — covers FR-6

```gherkin
Feature: Search and view developers on the map

  # Since auth slice 4 every scenario here starts signed in (see "Mobile — Sign-in").
  Background:
    Given I am signed in with GitHub

  Scenario: App centers the map on the current device location
    Given location permission is granted
    When the app launches
    Then the map should be centered on the device's current coordinates

  Scenario: Searching by tech shows matching nearby developers as markers
    Given developers matching "ReactJS" exist within 10km
    When I enter "ReactJS" in the search field and tap search
    Then markers for the matching developers should appear on the map

  Scenario: Tapping a marker shows the developer's callout details
    Given a developer marker is visible on the map
    When I tap the marker
    Then a callout should display the developer's name, bio and techs

  Scenario: Tapping the callout opens the GitHub profile
    Given a developer's callout is open
    When I tap the callout
    Then the app should navigate to the Profile screen
    And the Profile screen should load "https://github.com/<github_username>" in a WebView

  Scenario: A live "new-dev" event adds a marker without re-searching
    Given I have an active search for techs "ReactJS" centered on my region
    When a new developer matching "ReactJS" registers within 10km
    Then a new marker should appear on the map without me tapping search again

  # Auth slice 5 (US-7 "Live profile update"). Covered by Jest (dev/tests/mobile/pages/Main.test.js,
  # services/devList.test.js); on a device it needs a second, web-registered account (manual).
  Scenario: A live "dev-updated" event moves or updates a marker without re-searching
    Given a developer's marker is on my map
    When that developer updates their techs or location and still matches my search
    Then their marker moves/updates in place, without me tapping search again

  Scenario: A "dev-updated" event for a developer not on my map adds their marker
  Scenario: A live "dev-deleted" event removes the marker of a developer who deleted their profile

  @edge
  Scenario: Location permission denied
    Given location permission is denied
    When the app launches
    Then the app should not crash
    And the map should not attempt to render without a region
```

## Cross-cutting / Integration Scenarios — covers FR-4, NFR-3

```gherkin
Feature: End-to-end real-time propagation across layers

  Scenario: A web registration is seen live by a connected mobile client
    Given a mobile client has an active search/WebSocket connection near São Paulo for techs "ReactJS"
    When a developer matching "ReactJS" is registered via the web app near São Paulo
    Then the mobile client should receive the update within 2 seconds

  Scenario: The sign-in profile is used consistently as the source of truth for profile data
    When a developer is registered via web and the same data is later fetched via the mobile search
    Then the name, avatar_url and bio should be identical across both responses
    And they should match the GitHub profile captured when that developer signed in
```

## Exploratory testing charters (session-based, not scripted)

| Charter | Area | Time-box |
|---|---|---|
| Explore the registration form with unexpected input (emoji, extremely long strings, SQL/NoSQL injection-like strings in `techs`; a body `github_username` is ignored since auth slice 2) | Web + Backend | 30 min |
| Explore rapid repeated registrations of the same username (race condition on the `findOne` → `create` check in `DevController.store`) | Backend | 30 min |
| Explore map behavior when panning/zooming rapidly while a search is in flight | Mobile | 30 min |
| Explore WebSocket behavior across app backgrounding/foregrounding and connectivity loss | Mobile | 45 min |
| Explore GitHub sign-in failure modes (rate limit, consent denied, renamed account between sign-in and registration, stale sign-in profile) | Backend + Web | 30 min |
| Explore profile update/delete (auth slice 5): two tabs or devices editing and deleting the same profile, updating with an old token whose sign-in profile is stale, moving a profile out of a watcher's region (stale marker until the next search), and markers on a real device after `dev-updated`/`dev-deleted` | Web + Mobile + Backend | 45 min |
