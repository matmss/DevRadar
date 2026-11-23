Feature: QA review of 503 profile_busy, web
  As a signed-in developer whose save or delete hit "too many concurrent changes"
  I want to be told to try again, with my input and my session kept
  So that one retry is all it takes

  # Delivery: dev/web/src/services/requestErrors.js (unit tests only). The real harness backend
  # runs in another process and cannot be made to run out of retries, so the 503 is faked with
  # page.route, CORS preflight answered (the "backend answers ... with" steps of
  # auth-slice5-review.steps.js and auth-review.steps.js). Everything else is the real backend.

  Background:
    Given the backend has no registered developers

  @edge @regression @P2
  Scenario: A 503 profile_busy on update says "try again" and keeps the typed values and the session
    Given the backend has a developer "gaearon" with techs "ReactJS" at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "gaearon"
    And the backend answers PUT /devs/me with 503 and body '{"error":"Profile is busy","code":"profile_busy","details":["Too many concurrent changes to this profile; try again"]}'
    When I change techs to "Elixir", latitude to "-23.5505" and longitude to "-46.6333" and update
    Then I should see the error "Perfil ocupado, tente novamente."
    And I should be signed in as "gaearon"
    And the form should be in update mode
    And the techs field should contain "Elixir"
    And the entry for "gaearon" in the developer list should show techs "ReactJS"

  @edge @regression @P2
  Scenario: A 503 profile_busy on delete says "try again", deletes nothing and closes the confirmation
    Given the backend has a developer "gaearon" with techs "ReactJS" at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "gaearon"
    And the backend answers DELETE /devs/me with 503 and body '{"error":"Profile is busy","code":"profile_busy","details":["Too many concurrent changes to this profile; try again"]}'
    When I click "Excluir meu perfil"
    And I confirm the deletion
    Then I should see the error "Perfil ocupado, tente novamente."
    And I should not be told that my profile was deleted
    And I should not be asked to confirm the deletion
    And I should be signed in as "gaearon"
    And the form should be in update mode
    And the entry for "gaearon" in the developer list should show techs "ReactJS"
    And the backend should still have "gaearon"

  @edge @regression @P2
  Scenario: A 503 profile_busy on registration says "try again" and keeps the typed values and the session
    Given the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "gaearon"
    And the backend answers POST /devs with 503 and body '{"error":"Profile is busy","code":"profile_busy","details":["Too many concurrent changes to this profile; try again"]}'
    When I fill in techs "Go,Rust" and submit
    Then I should see the error "Perfil ocupado, tente novamente."
    And I should be signed in as "gaearon"
    And the form should be in registration mode
    And the techs field should contain "Go,Rust"
    And the backend should have no developers

  @edge @regression @P2
  Scenario: A 503 that is not profile_busy still shows the backend's own text
    Given the backend has a developer "gaearon" with techs "ReactJS" at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "gaearon"
    And the backend answers PUT /devs/me with 503 and body '{"error":"Service unavailable","code":"maintenance","details":["Back soon"]}'
    When I change techs to "Elixir", latitude to "-23.5505" and longitude to "-46.6333" and update
    Then I should see the error "Service unavailable: Back soon"
    And I should be signed in as "gaearon"
    And the techs field should contain "Elixir"
