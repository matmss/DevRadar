Feature: Sign in and out of the web app with GitHub (US-6)
  As a developer using the DevRadar web app
  I want to sign in with my GitHub account
  So that I register as myself and only signed-in users see the app

  # Spec: dev/docs/03-auth-spec.md, US-6 (update/delete come in slice 5). The real backend runs
  # with a real Mongo (support/backend-server.js). Only GitHub is faked: the browser's visit to
  # https://github.com/login/oauth/authorize is answered by Playwright (auth.steps.js), which
  # sends it to the backend callback with the state it received, and the backend's calls to
  # GitHub's token and user endpoints are answered by nock. The app's UI is in Portuguese.

  @smoke @P1
  Scenario: Signed out, I only see the sign-in button
    Given the backend has 2 registered developers
    When I open the DevRadar web app
    Then I should see the signed-out view

  @smoke @P1
  Scenario: Signing in shows my GitHub username and avatar, the form and the dev list
    Given the backend has 2 registered developers
    And GitHub will sign me in as "gaearon"
    When I open the DevRadar web app
    And I sign in with GitHub
    Then I should be signed in as "gaearon"
    And I should see the registration form
    And the developer list should show 2 entries
    And GitHub should have been asked for sign-in with a state and no extra scope
    And the address bar should show the app without a sign-in code
    And the PKCE verifier should be cleared

  @regression @P1
  Scenario: The session survives a page reload
    Given I am signed in with GitHub as "gaearon"
    When I reload the page
    Then I should be signed in as "gaearon"
    And I should see the registration form

  @regression @P1
  Scenario: Signing out clears the session and hides the app
    Given the backend has 2 registered developers
    And I am signed in with GitHub as "gaearon"
    When I sign out
    Then I should see the signed-out view
    And the session token should be cleared
    When I reload the page
    Then I should see the signed-out view

  @regression @P1
  Scenario: Cancelling on GitHub shows "sign-in cancelled", and I can retry
    Given I will cancel on GitHub's consent page
    When I open the DevRadar web app
    And I sign in with GitHub
    Then I should see the signed-out view
    And I should see the message "Login cancelado"
    And the address bar should show the app without a sign-in code
    Given GitHub will sign me in as "gaearon"
    When I sign in with GitHub
    Then I should be signed in as "gaearon"

  @edge @regression @P2
  Scenario: A GitHub failure during sign-in shows a clear message
    Given GitHub will fail to sign me in
    When I open the DevRadar web app
    And I sign in with GitHub
    Then I should see the signed-out view
    And I should see the message "Não foi possível falar com o GitHub, tente novamente"

  @edge @regression @P1
  Scenario: An expired session on load returns to the signed-out view with a message
    Given the backend has 2 registered developers
    When I open the DevRadar web app with an expired session token for "gaearon"
    Then I should see the signed-out view
    And I should see the message "Sessão expirada, entre novamente"
    And the session token should be cleared

  @edge @regression @P2
  Scenario: An invalid session token on load returns to the signed-out view without a message
    When I open the DevRadar web app with the session token "not-a-jwt"
    Then I should see the signed-out view
    And I should see no message
    And the session token should be cleared

  # A 429 means "slow down", not "signed out": the session is kept and can be retried.
  @edge @regression @P2
  Scenario: A rate-limited session check keeps the session and says to try again later
    Given the backend answers GET /auth/me with 429 and body '{"error":"Too many requests","code":"rate_limited","details":[]}'
    When I open the DevRadar web app with a stored session token for "gaearon"
    Then I should see the message "Muitas tentativas em pouco tempo, tente novamente mais tarde"
    And I should be offered to try again or sign out, with my session kept
    When I try again
    Then I should be signed in as "gaearon"

  # The callback page never navigates to a URL taken from its query string, and a code without
  # this browser's PKCE verifier (e.g. a forwarded link) does not sign anyone in.
  @edge @regression @P1
  Scenario Outline: A forged sign-in callback link does not sign me in or navigate away
    When I open the sign-in callback link "<link>"
    Then I should see the signed-out view
    And I should see the message "Não foi possível entrar com o GitHub, tente novamente"
    And the address bar should show the app without a sign-in code

    Examples:
      | link                                                        |
      | /auth/callback?code=stolen-code                             |
      | /auth/callback?code=stolen-code&redirect=//evil.example/    |
      | /auth/callback?error=sign_in_failed&reason=<script>x</script> |
