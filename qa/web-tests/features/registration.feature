Feature: Register a developer from the web app

  # Runs against a real Express server + real (ephemeral) MongoDB — see
  # support/backend-server.js. Only GitHub's third-party API is stubbed there.

  @smoke @P2
  Scenario: Browser geolocation pre-fills the coordinates
    Given the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And the backend has no registered developers
    When I open the DevRadar web app
    Then the latitude field should contain "-23.5505"
    And the longitude field should contain "-46.6333"

  @smoke @P1
  Scenario: Submitting the form adds the developer to the visible list without a page reload
    Given the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And the backend has no registered developers
    When I open the DevRadar web app
    And I fill in github username "gaearon", techs "ReactJS,Redux" and submit
    Then a new entry for "gaearon" should appear in the developer list
    And the github username field should be empty
    And the techs field should be empty

  @edge @P2
  Scenario: Geolocation permission denied still allows manual entry
    Given the browser denies geolocation permission
    And the backend has no registered developers
    When I open the DevRadar web app
    And I manually fill in latitude "-23.5505" and longitude "-46.6333"
    And I fill in github username "gaearon", techs "ReactJS" and submit
    Then a new entry for "gaearon" should appear in the developer list

  @regression @P2
  Scenario: Developer list loads existing developers on page load
    Given the backend has 2 registered developers
    When I open the DevRadar web app
    Then the developer list should show 2 entries

  @regression @P2
  Scenario: A registered developer survives a page reload
    Given the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And the backend has no registered developers
    When I open the DevRadar web app
    And I fill in github username "gaearon", techs "ReactJS,Redux" and submit
    Then reloading the page should still show "gaearon" in the developer list

  @edge @regression @P1
  Scenario: A rejected registration shows the server's error and keeps the input
    Given the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And the backend has no registered developers
    When I open the DevRadar web app
    And I fill in github username "-bad-name-", techs "ReactJS" and submit
    Then I should see the error "github_username is not a valid GitHub username"
    And the github username field should contain "-bad-name-"
    And the developer list should show 0 entries
