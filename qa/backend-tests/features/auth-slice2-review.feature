Feature: QA review of GitHub sign-in slices 2 and 3, backend (defects found in review)
  As QA reviewing feat/auth-slice-2-dev
  I want the defects found in review reproduced as scenarios
  So that the fixes can be proven and do not regress

  # Spec: dev/docs/03-auth-spec.md, US-3 and US-8, plus DEV's delivery notes ("an existing dev is
  # returned unchanged"). Reuses the registration harness ("I am signed in as" signs a real-shaped
  # token with the test JWT_SECRET and the fixture profile, registration.steps.js).

  Background:
    Given the developer database is empty

  # --- QA-AUTH2-1: concurrent registrations by the same signed-in user create duplicates -------
  # DevController.store does findOne -> create with no unique index on github_username (and no
  # upsert), so two POST /devs that overlap (a double-clicked "Salvar", a retry after a slow
  # response, two tabs) both see "no dev" and both insert. The signed-in user ends up with two
  # profiles, GET /devs and GET /search list them twice, two new-dev pushes go out, and slice 5's
  # PUT/DELETE /devs/me has no single "me" to act on. Now that the identity comes from the token,
  # "one dev per GitHub login" is an invariant the backend must hold.
  @edge @regression @P1
  Scenario Outline: Concurrent registrations by the same signed-in user create one developer
    Given I am signed in as "gaearon"
    When I submit <count> registrations at the same time with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then every concurrent registration should succeed with status 200
    And exactly 1 developer with github_username "gaearon" should exist in the database
    And every concurrent registration should return the same developer

    Examples:
      | count |
      | 2     |
      | 5     |

  @edge @regression @P1
  Scenario: Concurrent registrations in different letter case by the same login create one developer
    Given I am signed in as "gaearon"
    And a second session token for "Gaearon"
    When both sessions submit a registration at the same time with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then every concurrent registration should succeed with status 200
    And exactly 1 developer should match github_username "gaearon" case-insensitively
