Feature: Old sessions and legacy profiles in the web app (auth slice 6)
  As a developer using the DevRadar web app
  I want an old session to just send me to sign in again, and my pre-sign-in profile to stay mine
  So that the switch to GitHub account ids is invisible apart from one sign-in

  # Spec: dev/docs/03-auth-spec.md, US-8 and Q10. Since auth slice 6 a session token's subject is
  # the GitHub account id; a token stored by an earlier version (subject = login, no id) is
  # answered 401 token_invalid, which ends the session without a message (only token_expired has
  # one). A legacy profile (created before sign-in, no GitHub id) is found by login in any letter
  # case, read without being claimed, and claimed for the account on its owner's first update.
  # Real backend + Mongo; only GitHub is faked.

  @smoke @P1
  Scenario: A session stored before auth slice 6 shows the signed-out view, and signing in again works
    Given the backend has 2 registered developers
    And GitHub will sign me in as "gaearon"
    When I open the DevRadar web app with a session token for "gaearon" stored before auth slice 6
    Then I should see the signed-out view
    And I should see no message
    And the session token should be cleared
    When I sign in with GitHub
    Then I should be signed in as "gaearon"
    And the developer list should show 2 entries

  @smoke @P1
  Scenario: The owner of a legacy profile in another letter case sees it, claims it by updating, and it is listed once
    Given the backend has no registered developers
    And the backend has a developer "GAEARON" with techs "ReactJS" at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "gaearon"
    Then the form should be in update mode
    And the techs field should contain "ReactJS"
    And the backend's developer "GAEARON" should not belong to any GitHub account yet
    When I change techs to "Elixir", latitude to "-22.9068" and longitude to "-43.1729" and update
    Then I should see the status "Perfil atualizado"
    And the developer list should show 1 entries
    And the entry for "gaearon" in the developer list should show techs "Elixir"
    And the backend should have "gaearon" with techs "Elixir" at latitude "-22.9068" and longitude "-43.1729"
    And the backend's developer "gaearon" should belong to the GitHub account of "gaearon"

  # QA-AUTH6-1: another GitHub account's profile still shows "alice", a login GitHub now gives to
  # me. My sign-in displaces it (placeholder login, github_username_stale): it stays listed with
  # its name, but without a GitHub link (its old link would open my profile), and I can register.
  @smoke @P1
  Scenario: A profile displaced from my login stays listed without a GitHub link, and I can register as that login
    Given the backend has no registered developers
    And the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"
    And the backend has a developer "alice" named "Previous Alice", owned by another GitHub account, with techs "Go" at latitude "-23.5505" and longitude "-46.6333"
    And I am signed in with GitHub as "alice"
    Then the developer list should show 1 entries
    And the entry named "Previous Alice" should have no GitHub link and say "Perfil do GitHub indisponível"
    When I fill in techs "ReactJS" and submit
    Then the developer list should show 2 entries
    And exactly one entry should link to "https://github.com/alice"
    And the entry named "Previous Alice" should have no GitHub link and say "Perfil do GitHub indisponível"
