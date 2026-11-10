Feature: Update and delete my own developer profile (US-4, BUG-008)
  As a developer signed in with GitHub
  I want to change my techs and location, or remove my profile
  So that what nearby developers see stays true, and I can leave DevRadar

  # Spec: dev/docs/03-auth-spec.md, US-4, Q4, Q7 and Q9 (auth slice 5).
  #   GET    /devs/me  my dev, or 404 dev_not_found
  #   PUT    /devs/me  techs, latitude and longitude, all required, validated like POST /devs;
  #                    name/avatar/bio refreshed from the token's sign-in profile; 404 without a profile
  #   DELETE /devs/me  hard delete, 204; 404 dev_not_found without a profile (also on a repeat)
  # The dev is always the session token's login (case-insensitive match, US-8); the body never
  # chooses whose profile changes. Live pushes: dev-updated to subscribers matching the NEW
  # position and techs (Q4), never new-dev; dev-deleted ({ _id, github_username } only) to
  # subscribers matching the last position and techs.
  #
  # "a developer already exists" seeds a dev at latitude -23.5505, longitude -46.6333 (Sao Paulo)
  # with name = username and bio "seed fixture". Rio de Janeiro (-22.9068, -43.1729) is ~360 km
  # away, far outside the 10 km radius.

  Background:
    Given the developer database is empty

  # --- GET /devs/me ---------------------------------------------------------------------------

  @smoke @P1
  Scenario: I can read my own profile
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I am signed in as "gaearon"
    When I request my profile
    Then the response status should be 200
    And the registered developer should be "gaearon"
    And the developer's techs should be "Node.js"

  @regression @P1
  Scenario: Reading my profile when I have none is a 404
    Given a developer already exists with github_username "bob" and techs "Elixir"
    And I am signed in as "gaearon"
    When I request my profile
    Then the response status should be 404
    And the response should be a JSON error with code "dev_not_found"
    And the response should be an error with details
    And the response should not mention "bob"

  @regression @P1
  Scenario: Reading my profile requires a session token
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    When I request my profile
    Then the response status should be 401
    And the response should be an auth error with code "token_missing"
    And the response should not reveal any developer

  # --- PUT /devs/me ---------------------------------------------------------------------------

  @smoke @P1
  Scenario: Update my techs and location
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I am signed in as "gaearon"
    When I update my profile with techs " Elixir ,, Go ", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 200
    And the registered developer should be "gaearon"
    And the developer's techs should be "Elixir,Go"
    And the response should place the developer at latitude "-22.9068" and longitude "-43.1729"
    And the stored developer "gaearon" should have techs "Elixir,Go"
    And the stored developer "gaearon" should be at latitude "-22.9068" and longitude "-43.1729"
    And the database should contain exactly 1 developer

  @smoke @P1
  Scenario: An updated profile shows up in search at its new location only
    Given a developer already exists with github_username "gaearon" and techs "ReactJS"
    And I am signed in as "gaearon"
    When I update my profile with techs "Elixir", latitude "-22.9068" and longitude "-43.1729"
    And I search at latitude "-22.9068", longitude "-43.1729" for techs "Elixir"
    Then the response should contain exactly 1 developer
    And the response should include "gaearon"
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "ReactJS,Elixir"
    Then the response should contain exactly 0 developers

  @regression @P1
  Scenario: An update refreshes name, avatar and bio from the profile captured at sign-in
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I am signed in as "gaearon"
    When I update my profile with techs "Node.js", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the response should include the name, avatar_url and bio of "gaearon"'s GitHub profile
    And the stored developer "gaearon" should have the name, avatar_url and bio of "gaearon"'s GitHub profile
    And no call should have been made to GitHub's public users API

  @regression @P2
  Scenario: Numeric coordinates in the JSON body are accepted, like registration
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I am signed in as "gaearon"
    When I update my profile with techs "Go" and numeric latitude -22.9068 and longitude -43.1729
    Then the response status should be 200
    And the stored developer "gaearon" should be at latitude "-22.9068" and longitude "-43.1729"

  @smoke @P1
  Scenario: Updating when I have no profile is a 404 and creates nothing
    Given I am signed in as "gaearon"
    When I update my profile with techs "Elixir", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 404
    And the response should be a JSON error with code "dev_not_found"
    And the response should be an error with details
    And no developer should be persisted

  @smoke @P1
  Scenario: Updating without a session token is rejected
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    When I update my profile with techs "Elixir", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 401
    And the response should be an auth error with code "token_missing"
    And the response should challenge for a Bearer token
    And the stored developer "gaearon" should have techs "Node.js"

  @edge @regression @P1
  Scenario: Updating with an expired session token is rejected as expired
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I have a session token for "gaearon" that expired 1 hour ago
    When I update my profile with techs "Elixir", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 401
    And the response should be an auth error with code "token_expired"
    And the stored developer "gaearon" should have techs "Node.js"

  @edge @regression @P1
  Scenario Outline: Invalid update input is rejected with the same 400 as registration
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I am signed in as "gaearon"
    When I update my profile with techs "<techs>", latitude "<latitude>" and longitude "<longitude>"
    Then the response status should be 400
    And the response should be an error with details
    And the stored developer "gaearon" should have techs "Node.js"
    And the stored developer "gaearon" should be at latitude "-23.5505" and longitude "-46.6333"

    Examples:
      | techs   | latitude     | longitude    |
      | ReactJS | not-a-number | -46.6333     |
      | ReactJS | -23.5505     | not-a-number |
      | ReactJS |              | -46.6333     |
      | ReactJS | 91           | -46.6333     |
      | ReactJS | 0x10         | -46.6333     |
      | ReactJS | -23.5505     | 1e1          |
      | ReactJS | -23.5505     | 181          |
      |         | -23.5505     | -46.6333     |
      | ,  ,    | -23.5505     | -46.6333     |

  # A full update: techs, latitude and longitude are all required (no partial PUT).
  @edge @regression @P2
  Scenario: An update with only some of the fields is rejected
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I am signed in as "gaearon"
    When I update my profile with only techs "Elixir"
    Then the response status should be 400
    And the response should be an error with details
    And the stored developer "gaearon" should have techs "Node.js"

  @edge @regression @P2
  Scenario: The authentication check comes before validation on update
    When I update my profile with techs "", latitude "not-a-number" and longitude "-46.6333"
    Then the response status should be 401
    And the response should be an auth error with code "token_missing"

  # Q9: the token's identity always wins; nothing in the body picks or rewrites a profile.
  @edge @regression @P1
  Scenario: Identity fields in the update body are ignored
    Given a developer already exists with github_username "bob" and techs "Elixir"
    And a developer already exists with github_username "alice" and techs "Node.js"
    And I am signed in as "alice"
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333" and a body that claims to be "bob"
    Then the response status should be 200
    And the registered developer should be "alice"
    And the stored developer "alice" should have techs "Go"
    And the stored developer "alice" should have the name, avatar_url and bio of "alice"'s GitHub profile
    And the stored developer "alice" should be at latitude "-23.5505" and longitude "-46.6333"
    And the stored developer "bob" should have techs "Elixir"
    And the stored developer "bob" should have name "bob"
    And the stored developer "bob" should have bio "seed fixture"
    And the database should contain exactly 2 developers

  # US-8 / Q5: a legacy profile in another letter case belongs to the same GitHub login. Its
  # stored github_username keeps its letter case.
  @regression @P1
  Scenario Outline: The owner of a legacy profile in another letter case can update it
    Given a developer already exists with github_username "<legacy username>" and techs "Node.js"
    And I am signed in as "<github login>"
    When I update my profile with techs "Go", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 200
    And the registered developer should be "<legacy username>"
    And the stored developer "<legacy username>" should have techs "Go"
    And the database should contain exactly 1 developer

    Examples:
      | legacy username | github login |
      | GAEARON         | gaearon      |
      | gaearon         | Gaearon      |

  # US-4 "Cannot touch others": there is no route that takes a username or id.
  @edge @regression @P1
  Scenario: Another user's profile cannot be changed or deleted through a /devs/<username> path
    Given a developer already exists with github_username "bob" and techs "Elixir"
    And I am signed in as "alice"
    When I send a signed-in PUT request to "/devs/bob" with techs "Go", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 404
    And the response should be a JSON error with code "not_found"
    When I send a signed-in DELETE request to "/devs/bob" with techs "Go", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 404
    And the response should be a JSON error with code "not_found"
    And the stored developer "bob" should have techs "Elixir"
    And the database should contain exactly 1 developer

  # --- DELETE /devs/me ------------------------------------------------------------------------

  @smoke @P1
  Scenario: Delete my profile: it is gone from the list and search, and I can register again
    Given a developer already exists with github_username "gaearon" and techs "ReactJS"
    And a developer already exists with github_username "bob" and techs "ReactJS"
    And I am signed in as "gaearon"
    When I delete my profile
    Then the response status should be 204
    And the response body should be empty
    And no developer with github_username "gaearon" should be persisted
    When I request the list of all developers
    Then the response should contain 1 developers
    And the developer list should not include "gaearon"
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    Then the response should contain exactly 1 developer
    And the response should not include "gaearon"
    When I request my profile
    Then the response status should be 404
    When I submit a registration with techs "Go", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 200
    And the registered developer should be "gaearon"
    And the developer's techs should be "Go"
    And the database should contain exactly 2 developers

  @regression @P1
  Scenario: The owner of a legacy profile in another letter case can delete it
    Given a developer already exists with github_username "GAEARON" and techs "Node.js"
    And I am signed in as "gaearon"
    When I delete my profile
    Then the response status should be 204
    And no developer should be persisted

  @regression @P1
  Scenario: Deleting when I have no profile is a 404
    Given a developer already exists with github_username "bob" and techs "Elixir"
    And I am signed in as "gaearon"
    When I delete my profile
    Then the response status should be 404
    And the response should be a JSON error with code "dev_not_found"
    And the database should contain exactly 1 developer

  @regression @P2
  Scenario: Deleting twice answers 404 the second time
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I am signed in as "gaearon"
    When I delete my profile
    Then the response status should be 204
    When I delete my profile
    Then the response status should be 404
    And the response should be a JSON error with code "dev_not_found"

  @smoke @P1
  Scenario: Deleting without a session token is rejected
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    When I delete my profile
    Then the response status should be 401
    And the response should be an auth error with code "token_missing"
    And the response should challenge for a Bearer token
    And the database should contain exactly 1 developer

  @edge @regression @P1
  Scenario Outline: Deleting with an invalid session token is rejected
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I have a <kind> session token
    When I delete my profile
    Then the response status should be 401
    And the response should be an auth error with code "token_invalid"
    And the database should contain exactly 1 developer

    Examples:
      | kind           |
      | tampered       |
      | alg-none       |
      | forged-profile |

  @edge @regression @P1
  Scenario: Deleting with an expired session token is rejected as expired
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I have a session token for "gaearon" that expired 1 hour ago
    When I delete my profile
    Then the response status should be 401
    And the response should be an auth error with code "token_expired"
    And the database should contain exactly 1 developer

  # --- Concurrency ----------------------------------------------------------------------------
  # PUT never upserts, so an update can never bring a deleted profile back.

  @edge @regression @P1
  Scenario: Updates racing a delete do not crash or resurrect the profile
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I am signed in as "gaearon"
    When I send 6 updates and a delete of my profile at the same time
    Then the delete should be answered 204
    And every update should be answered 200 or 404 dev_not_found
    And no developer should be persisted

  @edge @regression @P1
  Scenario: An update applied just after a delete answers 404 and does not resurrect the profile
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I am signed in as "gaearon"
    And my profile is deleted just before my update is applied
    When I update my profile with techs "Elixir", latitude "-22.9068" and longitude "-43.1729"
    Then the delete should be answered 204
    And the response status should be 404
    And the response should be a JSON error with code "dev_not_found"
    And no developer should be persisted

  # --- Live pushes (Q4) -----------------------------------------------------------------------

  @integration @smoke @P1
  Scenario: An update is pushed as dev-updated, never as new-dev, to subscribers matching the new position and techs
    Given a developer already exists with github_username "gaearon" and techs "ReactJS"
    And I am signed in as "gaearon"
    And a signed-in client "watcher" is connected via WebSocket at latitude "-22.9068", longitude "-43.1729" watching techs "Elixir"
    When I update my profile with techs "Elixir", latitude "-22.9070" and longitude "-43.1730"
    Then the response status should be 200
    And client "watcher" should receive a "dev-updated" event within 2 seconds
    And the "dev-updated" event for "watcher" should be "gaearon" with techs "Elixir" at latitude "-22.9070" and longitude "-43.1730"
    And client "watcher" should receive exactly 0 "new-dev" events within 1 seconds

  @integration @regression @P1
  Scenario: Subscribers that only matched the old position or the old techs get no dev-updated
    Given a developer already exists with github_username "gaearon" and techs "ReactJS"
    And I am signed in as "gaearon"
    And a signed-in client "old-area-old-techs" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    And a signed-in client "old-area-new-techs" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "Elixir"
    And a signed-in client "new-area-old-techs" is connected via WebSocket at latitude "-22.9068", longitude "-43.1729" watching techs "ReactJS"
    And a signed-in client "new-area-new-techs" is connected via WebSocket at latitude "-22.9068", longitude "-43.1729" watching techs "Elixir"
    When I update my profile with techs "Elixir", latitude "-22.9068" and longitude "-43.1729"
    Then client "new-area-new-techs" should receive a "dev-updated" event within 2 seconds
    And client "old-area-old-techs" should receive exactly 0 "dev-updated" events within 1 seconds
    And client "old-area-new-techs" should receive exactly 0 "dev-updated" events within 1 seconds
    And client "new-area-old-techs" should receive exactly 0 "dev-updated" events within 1 seconds

  @integration @regression @P2
  Scenario: A rejected or not-found update pushes nothing
    Given I am signed in as "gaearon"
    And a signed-in client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    When I update my profile with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 404
    Given a developer already exists with github_username "gaearon" and techs "ReactJS"
    When I update my profile with techs "ReactJS", latitude "not-a-number" and longitude "-46.6333"
    Then the response status should be 400
    And client "watcher" should receive exactly 0 "dev-updated" events within 1 seconds
    And client "watcher" should receive exactly 0 "new-dev" events within 1 seconds

  @integration @regression @P1
  Scenario: A delete is pushed as dev-deleted, with only the id and login, to subscribers matching the last position and techs
    Given a developer already exists with github_username "gaearon" and techs "ReactJS"
    And I am signed in as "gaearon"
    And a signed-in client "nearby" is connected via WebSocket at latitude "-23.5510", longitude "-46.6330" watching techs "ReactJS"
    And a signed-in client "far" is connected via WebSocket at latitude "-22.9068", longitude "-43.1729" watching techs "ReactJS"
    And a signed-in client "other-techs" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "Python"
    When I delete my profile
    Then the response status should be 204
    And client "nearby" should receive a "dev-deleted" event within 2 seconds
    And the "dev-deleted" event for "nearby" should only carry the _id and github_username "gaearon"
    And client "far" should receive exactly 0 "dev-deleted" events within 1 seconds
    And client "other-techs" should receive exactly 0 "dev-deleted" events within 1 seconds
