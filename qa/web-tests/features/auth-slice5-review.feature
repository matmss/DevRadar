Feature: QA review of GitHub sign-in slice 5, web (defects found in review)
  As QA reviewing feat/auth-slice-5-dev
  I want the defects found in review reproduced as scenarios
  So that the fixes can be proven and do not regress

  # Spec: dev/docs/03-auth-spec.md US-4 and US-6 "Already registered". Real backend + Mongo; only
  # GitHub is faked, except where a scenario says the backend answer is faked (an answer the
  # slice 5 backend cannot produce on purpose).

  Background:
    Given the backend has no registered developers

  # --- QA-AUTH5-1: any 404 is taken for "dev_not_found" ----------------------------------------
  # App.js handleDeleteDev treats EVERY 404 on DELETE /devs/me as "already deleted" and shows
  # "Perfil exclu<U+00ED>do" ("profile deleted") and the empty registration form;
  # handleUpdateDev treats every 404 on PUT /devs/me as "deleted elsewhere". The backend marks the case the client may treat as gone
  # with `code: "dev_not_found"`. Any other 404 (a backend without slice 5 while web and backend
  # are deployed separately, a proxy or a path prefix that does not route /devs/me: the backend's
  # own catch-all answers `code: "not_found"`) means nothing was deleted, yet the user is told
  # their profile, and with it their location, is gone. Other devs keep seeing them on the map.
  @edge @regression @P1
  Scenario: A 404 that is not dev_not_found on delete is not reported as a deletion
    Given the backend has a developer "gaearon" with techs "ReactJS" at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "gaearon"
    And the backend answers DELETE /devs/me with 404 and body '{"error":"Not found","code":"not_found","details":[]}'
    When I click "Excluir meu perfil"
    And I confirm the deletion
    Then I should see the error "Not found"
    And I should not be told that my profile was deleted
    And the form should be in update mode
    And the entry for "gaearon" in the developer list should show techs "ReactJS"
    And the backend should still have "gaearon"

  @edge @regression @P2
  Scenario: A 404 that is not dev_not_found on update does not say my profile is gone
    Given the backend has a developer "gaearon" with techs "ReactJS" at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "gaearon"
    And the backend answers PUT /devs/me with 404 and body '{"error":"Not found","code":"not_found","details":[]}'
    When I change techs to "Elixir", latitude to "-23.5505" and longitude to "-46.6333" and update
    Then I should see the error "Not found"
    And the form should be in update mode
    And the techs field should contain "Elixir"

  # --- QA-AUTH5-2: the update form prefills coordinates the backend then rejects ---------------
  # DevForm initialValues() prefills with String(number). For |value| < 1e-6 JavaScript writes
  # exponent notation (String(1e-7) === "1e-7"), which validateDevInput rejects on purpose (plain
  # decimals only, BUG-003/005). A latitude the backend accepted at registration ("0.0000001")
  # comes back as "1e-7", so "Atualizar" fails with a 400 until the user retypes it.
  @edge @regression @P2
  Scenario: Saving the update form unchanged works for a location the backend accepted
    Given the browser denies geolocation permission
    And I am signed in with GitHub as "gaearon"
    When I manually fill in latitude "0.0000001" and longitude "-46.6333"
    And I fill in techs "Go" and submit
    Then the form should be in update mode
    When I click "Atualizar"
    Then I should see the status "Perfil atualizado"
