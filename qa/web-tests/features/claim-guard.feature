Feature: A legacy profile registered by another GitHub account is not mine (spec 05, B1)
  As a developer whose GitHub login used to belong to someone else
  I want the app to give me a fresh profile instead of that person's old one
  So that I never see or edit their data, and they keep it

  # Spec: dev/docs/05-claim-guard-spec.md, AC-18 (no client change). The legacy developer's
  # avatar names another GitHub account, so it is guarded against me: my sign-in displaces it
  # (placeholder login, no GitHub link), GET /devs/me is 404 and the form is empty ("Salvar").
  # Backend scenarios: backend-tests/features/claim-guard.feature. Real backend + Mongo; only
  # GitHub is faked.

  @smoke @regression @P1
  Scenario: Signed in as a login whose legacy profile has another account's avatar: empty form, a fresh profile, both listed (AC-18)
    Given the backend has no registered developers
    And the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And the backend has a legacy developer "alice" named "Renamed Owner" with the avatar of GitHub account 111, techs "Go" at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "alice"
    Then the form should be in registration mode
    And the techs field should be empty
    And the developer list should show 1 entries
    And the entry named "Renamed Owner" should have no GitHub link and say "Perfil do GitHub indisponível"
    When I fill in techs "ReactJS" and submit
    Then the developer list should show 2 entries
    And exactly one entry should link to "https://github.com/alice"
    And the entry named "Renamed Owner" should have no GitHub link and say "Perfil do GitHub indisponível"
    And the backend's developer "alice" should belong to the GitHub account of "alice"
