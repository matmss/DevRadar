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

  Scenario: Listing developers returns everyone regardless of location
    Given 3 developers exist scattered across different cities
    When I request the list of all developers
    Then the response status should be 200
    And the response should contain 3 developers
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
    And the techs field should be cleared

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
```

## Feature: Mobile — Map Search & Live Updates — covers FR-6

```gherkin
Feature: Search and view developers on the map

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
