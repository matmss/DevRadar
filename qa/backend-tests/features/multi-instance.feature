@multi-instance
Feature: Backend instances keep their runtime state to themselves (multi-instance, phase PR0)
  As the team scaling the backend out to several instances that share one MongoDB
  I want each server instance built by createServer() to own its runtime state
  So that later phases can share exactly the pieces that must be shared, one at a time

  # Two instances run in this test process: "A" is the scenario's own instance (hooks.js) and
  # "B" another one (support/testApp.js startTestInstance), both on 127.0.0.1, sharing the same
  # database and the same GitHub mock. Each has its own server context
  # (dev/backend/src/serverContext.js).
  #
  # These scenarios document TODAY's behaviour: nothing in memory is shared. The later phases
  # invert them on purpose:
  #   PR1 (OAuth state, one-time codes and rate limits in MongoDB): a state or code issued by A is
  #       accepted by B, and A and B count against one rate limit.
  #   PR2 (cross-instance socket push): B's subscribers get the events of writes made on A. Each
  #       instance still keeps its own connections (A never lists B's sockets).
  #   PR3 (a lease lock per account under the local queue): a write on B waits for the same
  #       account's write held on A.

  Background:
    Given the developer database is empty
    And backend instances "A" and "B" share the database

  @regression @P2
  Scenario: An OAuth state issued by one instance is unknown to the other
    Given GitHub will sign in "alice" at the next callback
    When sign-in is started on instance "A"
    And GitHub sends the browser back to instance "B" with that state
    Then the response status should be 400
    And the response should be an auth error with code "state_invalid"
    When GitHub sends the browser back to instance "A" with that state
    Then the browser should be sent back to the client with a one-time code

  @regression @P2
  Scenario: A one-time sign-in code issued by one instance is unknown to the other
    Given "alice" got a one-time sign-in code from instance "A"
    When the one-time code is redeemed on instance "B"
    Then the response status should be 400
    And the response should be an auth error with code "code_invalid"
    When the one-time code is redeemed on instance "A"
    Then the response should carry a session token for "alice"

  @regression @P2
  Scenario: Rate-limit counters are per instance
    Given the sign-in rate limit is 2 requests per window
    When sign-in is started 2 times on instance "A"
    And sign-in is started on instance "B"
    Then the response status should be 302
    When sign-in is started on instance "A"
    Then the response status should be 429
    And the response should be an auth error with code "rate_limited"

  @integration @regression @P2
  Scenario: Sockets and live pushes stay on the instance they are connected to
    Given a signed-in client "watcher-a" is connected to instance "A" at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    And a signed-in client "watcher-b" is connected to instance "B" at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    Then instance "A" should have 1 live subscription near latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    And instance "B" should have 1 live subscription near latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    Given I am signed in as "gaearon"
    When I register on instance "A" with techs "ReactJS", latitude "-23.5510" and longitude "-46.6330"
    Then the response status should be 200
    And client "watcher-a" should receive a "new-dev" event within 2 seconds
    And client "watcher-b" should not receive a "new-dev" event within 1 seconds

  @regression @P2
  Scenario: Write queues are per instance
    Given I am signed in as "gaearon"
    And I registered on instance "A" with techs "ReactJS", latitude "-23.5510" and longitude "-46.6330"
    And the next profile delete is held at the database
    When I start deleting my profile on instance "A"
    Then instance "A" should have 1 account with a write queued
    And instance "B" should have 0 accounts with a write queued
    When I delete my profile on instance "B"
    Then the response status should be 204
    And instance "A" should have 1 account with a write queued
    When the held delete is released
    Then the response status should be 404
    And the response should be a JSON error with code "dev_not_found"
    And instance "A" should have 0 accounts with a write queued
