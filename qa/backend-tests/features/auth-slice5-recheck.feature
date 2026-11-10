Feature: QA re-check of auth slice 5 hardening (per-login write order, profile rate limit)
  As QA re-checking feat/auth-slice-5-dev after the QA-AUTH5 fixes
  I want the hardening held at the HTTP level where DEV's scenarios do not reach
  So that a later change cannot quietly drop part of it

  # DevController runs POST /devs, PUT and DELETE /devs/me for one login one at a time, each with
  # its announcement (utils/keyedQueue.js), and rate limits PUT/DELETE per login after
  # requireAuth (middleware/rateLimit.js). DEV's scenarios cover PUT/PUT and PUT/DELETE ordering
  # and the 429. These add: ordering for registration, a failed write not blocking the login, a
  # slow login not delaying another login, and what the limiter must leave alone.
  # "the database answers my next update N ms late" (profile.steps.js) delays the reply of the
  # next Dev.findOneAndUpdate, which POST /devs also uses (its upsert); the write happens at once.

  Background:
    Given the developer database is empty

  # --- Per-login write order ------------------------------------------------------------------

  @integration @edge @regression @P1
  Scenario: A slow registration followed by a delete announces new-dev before dev-deleted
    Given I am signed in as "gaearon"
    And a signed-in client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    And the database answers my next update 500 ms late
    When I register with techs "ReactJS", latitude "-23.5510" and longitude "-46.6330" and, 100 ms later, delete my profile
    Then the registration should be answered 200
    And the delete should be answered 204
    And client "watcher" should have received "new-dev" before "dev-deleted"
    And no developer should be persisted
    And no write should be queued for any login

  @edge @regression @P1
  Scenario: A failed database write does not block the next write for the same login
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I am signed in as "gaearon"
    And the database fails my next update
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 500
    And the response should be a JSON error with code "internal_error"
    And no write should be queued for any login
    When I update my profile with techs "Elixir", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the stored developer "gaearon" should have techs "Elixir"
    And no write should be queued for any login

  @edge @regression @P2
  Scenario: A slow write for one login does not delay another login's write
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And a developer already exists with github_username "alice" and techs "Node.js"
    And the database answers my next update 1000 ms late
    When "gaearon" updates their profile and, 100 ms later, "alice" updates theirs
    Then both updates should be answered 200
    And the update of "alice" should be answered before the update of "gaearon"
    And no write should be queued for any login

  # --- Profile rate limit -----------------------------------------------------------------------

  @edge @regression @P1
  Scenario: The profile rate limit leaves reads, registration and authentication alone
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And the profile change rate limit is 2 requests per window
    And I am signed in as "gaearon"
    When I update my profile 2 times with techs "Go"
    And I update my profile with techs "Elixir", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 429
    And the response should be a JSON error with code "rate_limited"
    And the response should be an error with details
    When I request my profile
    Then the response status should be 200
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    Given I have no session token
    When I update my profile with techs "Elixir", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 401
    And the response should be an auth error with code "token_missing"
    Given I have a session token for "gaearon" that expired 1 hour ago
    When I delete my profile
    Then the response status should be 401
    And the response should be an auth error with code "token_expired"
    And the stored developer "gaearon" should have techs "Go"
