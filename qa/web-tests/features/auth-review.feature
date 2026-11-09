Feature: QA review of GitHub sign-in slices 2 and 3, web (defects found in review)
  As QA reviewing feat/auth-slice-2-dev
  I want the defects found in review reproduced as scenarios
  So that the fixes can be proven and do not regress

  # Spec: dev/docs/03-auth-spec.md, US-3 and US-6, plus DEV's delivery notes. Same harness as
  # auth.feature and registration.feature: real backend + Mongo, only GitHub faked. QA-AUTH2-4
  # is the one place a backend answer is faked (page.route), because the real backend has no
  # way to produce a 401 with a code the web app does not know.

  # --- QA-AUTH2-1 (web side): double-clicking "Salvar" registers me twice ----------------------
  # The button stays enabled while POST /devs is in flight, and the backend's find-then-create
  # is not atomic (backend-tests auth-slice2-review.feature), so a double-click stores two
  # profiles for the signed-in user. The list hides it until the next load.
  @edge @regression @P1
  Scenario: Double-clicking "Salvar" registers the signed-in developer once
    Given the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And the backend has no registered developers
    And I am signed in with GitHub as "gaearon"
    When I fill in techs "ReactJS" and double-click submit
    Then the backend should have exactly 1 developer, "gaearon"
    And reloading the page should show exactly 1 entry for "gaearon"

  # --- QA-AUTH2-3: another tab changes the session, this tab keeps acting on the old view ------
  # The token lives in localStorage (shared by every tab) but the signed-in user shown is React
  # state from load time, and nothing listens for the `storage` event. After signing in as
  # another account in a second tab, the first tab still says "gaearon" but its requests carry
  # alice's token, so "Salvar" registers alice's profile at the location typed under gaearon.
  @edge @regression @P2
  Scenario: A tab never registers someone other than the user it shows
    Given the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And the backend has no registered developers
    And I am signed in with GitHub as "gaearon"
    And GitHub will sign me in as "alice"
    When in a second tab I sign out and sign in with GitHub
    And I fill in techs "ReactJS" and submit in the first tab
    Then the developer registered from the first tab should be the user it showed

  @edge @regression @P2
  Scenario: Signing out in another tab signs this tab out too
    Given the backend has 2 registered developers
    And I am signed in with GitHub as "gaearon"
    When in a second tab I sign out
    Then the first tab should eventually show the signed-out view

  # --- QA-AUTH2-4: a 401 with an unrecognised code leaves the app stuck or silent --------------
  # DEV: "other codes show the signed-out view". The api interceptor only ends the session for
  # token_expired/token_invalid/token_missing, while App.js treats every 401 as "already handled".
  # On load that leaves "Carregando..." forever; on registration the click does nothing visible.
  # A 401 from a proxy/gateway in front of the API, or a new backend code, hits this path.
  @edge @regression @P2
  Scenario Outline: A 401 with an unrecognised body on load shows the signed-out view
    Given the backend answers GET /auth/me with 401 and body '<body>'
    When I open the DevRadar web app with a stored session token for "gaearon"
    Then I should see the signed-out view

    Examples:
      | body                                                   |
      | {"error":"Session revoked","code":"session_revoked"}   |
      | {"error":"Unauthorized"}                               |

  @edge @regression @P2
  Scenario: A 401 with an unrecognised code on registration is not silently ignored
    Given the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And the backend has no registered developers
    And I am signed in with GitHub as "gaearon"
    And the backend answers POST /devs with 401 and body '{"error":"Session revoked","code":"session_revoked"}'
    When I fill in techs "ReactJS" and submit
    Then I should get visible feedback that the registration did not happen

  # --- QA-AUTH2-5: a callback link opened while signed in fakes a sign-out ---------------------
  # completeSignIn() fails (no PKCE verifier) and App shows the signed-out view with "Não foi
  # possível entrar...", but the valid token stays in localStorage: the user believes they are
  # signed out (e.g. on a shared computer) while a reload signs them straight back in.
  @edge @regression @P2
  Scenario: A sign-in callback link opened while signed in does not show me signed out while my session is still stored
    Given I am signed in with GitHub as "gaearon"
    When I open the sign-in callback link "/auth/callback?code=stolen-code"
    Then the view should match the stored session
