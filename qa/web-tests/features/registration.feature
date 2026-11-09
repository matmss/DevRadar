Feature: Register as the signed-in developer from the web app

  # Runs against a real Express server + real (ephemeral) MongoDB — see
  # support/backend-server.js. Only GitHub is faked: its authorize page at the browser level
  # (auth.steps.js) and its OAuth API with nock in the harness backend. Every scenario signs in
  # through the real GitHub sign-in flow first (dev/docs/03-auth-spec.md, US-3 and US-6).

  @smoke @P2
  Scenario: Browser geolocation pre-fills the coordinates
    Given the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And the backend has no registered developers
    And I am signed in with GitHub as "gaearon"
    Then the latitude field should contain "-23.5505"
    And the longitude field should contain "-46.6333"

  @smoke @P1
  Scenario: Submitting the form adds the developer to the visible list without a page reload
    Given the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And the backend has no registered developers
    And I am signed in with GitHub as "gaearon"
    When I fill in techs "ReactJS,Redux" and submit
    Then a new entry for "gaearon" should appear in the developer list
    And the techs field should be empty

  @edge @P2
  Scenario: Geolocation permission denied still allows manual entry
    Given the browser denies geolocation permission
    And the backend has no registered developers
    And I am signed in with GitHub as "gaearon"
    When I manually fill in latitude "-23.5505" and longitude "-46.6333"
    And I fill in techs "ReactJS" and submit
    Then a new entry for "gaearon" should appear in the developer list

  @regression @P2
  Scenario: Developer list loads existing developers on page load
    Given the backend has 2 registered developers
    And I am signed in with GitHub as "gaearon"
    Then the developer list should show 2 entries

  @regression @P2
  Scenario: A registered developer survives a page reload
    Given the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And the backend has no registered developers
    And I am signed in with GitHub as "gaearon"
    When I fill in techs "ReactJS,Redux" and submit
    Then reloading the page should still show "gaearon" in the developer list

  @edge @regression @P1
  Scenario: A rejected registration shows the server's error and keeps the input
    Given the browser denies geolocation permission
    And the backend has no registered developers
    And I am signed in with GitHub as "gaearon"
    When I manually fill in latitude "not-a-number" and longitude "-46.6333"
    And I fill in techs "ReactJS" and submit
    Then I should see the error "latitude must be a number between -90 and 90"
    And the techs field should contain "ReactJS"
    And the developer list should show 0 entries

  # --- US-3 / US-6: the form registers the signed-in user ----------------------------------

  @smoke @P1
  Scenario: The registration form has no username field and registers the signed-in user
    Given the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And the backend has no registered developers
    And I am signed in with GitHub as "alice"
    Then the registration form should have no username field
    When I fill in techs "Elixir" and submit
    Then a new entry for "alice" should appear in the developer list
    And the backend should have exactly 1 developer, "alice"

  @edge @regression @P1
  Scenario: A session that expires while I use the app returns me to the signed-out view
    Given the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And the backend has no registered developers
    And I am signed in with GitHub as "gaearon"
    When my session token expires
    And I fill in techs "ReactJS" and submit
    Then I should see the signed-out view
    And I should see the message "Sessão expirada, entre novamente"
    And the session token should be cleared
    And the backend should have no developers
