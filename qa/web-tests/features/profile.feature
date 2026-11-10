Feature: Update and delete my profile from the web app (US-6 "Already registered", US-4)
  As a developer signed in with GitHub who is already registered
  I want my saved techs and location in the form, with "Atualizar" and "Excluir meu perfil"
  So that I can keep my profile current or remove it

  # Spec: dev/docs/03-auth-spec.md, US-4 and US-6 (auth slice 5). The web app asks
  # GET /devs/me after sign-in: 404 shows the registration form ("Salvar"), a profile shows the
  # update form ("Atualizar") with "Excluir meu perfil" behind an in-page confirmation (never a
  # native window.confirm dialog). Real backend + Mongo; only GitHub is faked.
  # "the backend has a developer" seeds the record directly, like a legacy (pre-sign-in) profile.

  Background:
    Given the backend has no registered developers

  @smoke @P1
  Scenario: An already registered developer sees the form prefilled with the saved profile
    Given the browser grants geolocation permission at latitude "-22.9068" and longitude "-43.1729"
    And the backend has a developer "gaearon" with techs "ReactJS,Redux" at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "gaearon"
    Then the form should be in update mode
    And the techs field should contain "ReactJS, Redux"
    And the latitude field should contain "-23.5505"
    And the longitude field should contain "-46.6333"

  @smoke @P1
  Scenario: Updating my profile changes the list and the backend
    Given the backend has a developer "gaearon" with techs "ReactJS" at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "gaearon"
    When I change techs to "Elixir, Go", latitude to "-22.9068" and longitude to "-43.1729" and update
    Then I should see the status "Perfil atualizado"
    And the entry for "gaearon" in the developer list should show techs "Elixir, Go"
    And the developer list should show 1 entries
    And the backend should have "gaearon" with techs "Elixir,Go" at latitude "-22.9068" and longitude "-43.1729"
    And the form should be in update mode
    And the techs field should contain "Elixir, Go"
    When I reload the page
    Then the form should be in update mode
    And the techs field should contain "Elixir, Go"
    And the latitude field should contain "-22.9068"

  @edge @regression @P1
  Scenario: A rejected update shows the server's error and keeps the input
    Given the backend has a developer "gaearon" with techs "ReactJS" at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "gaearon"
    When I change techs to "Elixir", latitude to "91" and longitude to "-46.6333" and update
    Then I should see the error "latitude must be a number between -90 and 90"
    And the techs field should contain "Elixir"
    And the backend should have "gaearon" with techs "ReactJS" at latitude "-23.5505" and longitude "-46.6333"

  @edge @regression @P1
  Scenario: Double-clicking "Atualizar" sends one update
    Given the backend has a developer "gaearon" with techs "ReactJS" at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "gaearon"
    And the backend answers PUT /devs/me slowly
    When I change techs to "Elixir" and double-click "Atualizar"
    Then the "Atualizar" button should be disabled until the update is answered
    And exactly 1 PUT /devs/me request should have been sent
    And the entry for "gaearon" in the developer list should show techs "Elixir"

  @smoke @P1
  Scenario: Deleting my profile after confirming returns the form to registration
    Given the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And the backend has 1 registered developers
    And the backend has a developer "gaearon" with techs "ReactJS" at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "gaearon"
    And native dialogs are watched
    When I click "Excluir meu perfil"
    Then I should be asked to confirm the deletion in the page
    And the backend should still have "gaearon"
    When I confirm the deletion
    Then I should see the status "Perfil excluído"
    And the form should be in registration mode
    And the techs field should be empty
    And there should be no entry for "gaearon" in the developer list
    And the developer list should show 1 entries
    And the backend should not have "gaearon"
    And no native dialog should have been opened

  @regression @P1
  Scenario: Cancelling the confirmation keeps my profile
    Given the backend has a developer "gaearon" with techs "ReactJS" at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "gaearon"
    And native dialogs are watched
    When I click "Excluir meu perfil"
    And I cancel the deletion
    Then I should not be asked to confirm the deletion
    And the form should be in update mode
    And the entry for "gaearon" in the developer list should show techs "ReactJS"
    And the backend should still have "gaearon"
    And no native dialog should have been opened

  @regression @P1
  Scenario: After deleting my profile I can register again
    Given the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And the backend has a developer "gaearon" with techs "ReactJS" at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "gaearon"
    When I click "Excluir meu perfil"
    And I confirm the deletion
    Then the form should be in registration mode
    When I fill in techs "Go" and submit
    Then the entry for "gaearon" in the developer list should show techs "Go"
    And the form should be in update mode
    And the backend should have exactly 1 developer, "gaearon"

  @regression @P1
  Scenario: Registering switches the form to update mode
    Given the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "alice"
    Then the form should be in registration mode
    When I fill in techs "ReactJS, Redux" and submit
    Then a new entry for "alice" should appear in the developer list
    And the form should be in update mode
    And the techs field should contain "ReactJS, Redux"

  # US-8 / Q5: a legacy profile in another letter case is the signed-in user's.
  @regression @P2
  Scenario: A legacy profile in another letter case is shown as mine
    Given the backend has a developer "GAEARON" with techs "Node.js" at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "gaearon"
    Then the form should be in update mode
    And the techs field should contain "Node.js"

  # Deleted in another tab or device: the update answers 404 and the form offers registration.
  @edge @regression @P2
  Scenario: Updating a profile that was deleted elsewhere offers registration again
    Given the backend has a developer "gaearon" with techs "ReactJS" at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "gaearon"
    And my profile is deleted from another device
    When I change techs to "Elixir", latitude to "-23.5505" and longitude to "-46.6333" and update
    Then I should see the error "Seu perfil não existe mais, cadastre-se novamente"
    And the form should be in registration mode
    And there should be no entry for "gaearon" in the developer list
