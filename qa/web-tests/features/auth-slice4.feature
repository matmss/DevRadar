Feature: Protected developer list and session robustness in the web app (auth slice 4)
  As a developer using the DevRadar web app
  I want the developer list to use my session, and a broken session check to never leave me stuck
  So that the app stays usable now that every read requires sign-in

  # Spec: dev/docs/03-auth-spec.md, Q1 (GET /devs requires a session token since slice 4), plus
  # two QA follow-ups from slice 3: a 401 must only clear the stored token if it is still the one
  # the failing request carried, and a session check that never answers must time out into the
  # "unavailable" view. Real backend + Mongo; a backend answer is faked (page.route) only where the
  # real backend cannot produce it.

  @smoke @P1
  Scenario: The developer list is requested with my session token
    Given the backend has 2 registered developers
    And I am signed in with GitHub as "gaearon"
    Then the developer list should show 2 entries
    And reloading the page should request the developer list with my session token

  @edge @regression @P1
  Scenario: A 401 on the developer list signs me out
    Given the backend has 2 registered developers
    And the backend answers GET /devs with 401 and body '{"error":"Session expired, sign in again","code":"token_expired","details":[]}'
    When I open the DevRadar web app with a stored session token for "gaearon"
    Then I should see the signed-out view
    And I should see the message "Sessão expirada, entre novamente"
    And the session token should be cleared

  # QA follow-up 1: the 401 arrives after another tab saved a new session (this tab has not heard
  # of it yet). Clearing unconditionally would sign both tabs out of the new session.
  @edge @regression @P2
  Scenario: A 401 for a token another tab has replaced keeps the new session
    Given I am signed in with GitHub as "gaearon"
    And the next GET /devs will be answered 401 "token_expired" after another tab signs in as "alice"
    When I reload the page
    Then I should be signed in as "alice"
    And the stored session token should belong to "alice"

  # QA follow-up 2: axios had no timeout, so a hung GET /auth/me left "Carregando..." forever.
  # The web app gives up after 10 s (REQUEST_TIMEOUT_MS) and treats it like an unreachable server.
  @edge @regression @P2 @timeout:60000
  Scenario: A session check that never answers shows the "unavailable" view instead of loading forever
    Given the backend never answers GET /auth/me
    When I open the DevRadar web app with a stored session token for "gaearon"
    Then within 20 seconds I should see the message "Não foi possível falar com o servidor, tente novamente mais tarde"
    And I should be offered to try again or sign out, with my session kept
    When I try again
    Then I should be signed in as "gaearon"
