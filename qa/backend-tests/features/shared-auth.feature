@multi-instance @shared-auth
Feature: Sign-in state, one-time codes and rate limits are shared by every backend instance (multi-instance PR1)
  As the team running several backend instances on one MongoDB
  I want a sign-in to work whichever instances its requests reach, and every limit to count them all
  So that no sticky sessions are needed and a client cannot multiply its budget by the number of instances

  # Two instances in this process, "A" (the scenario's own) and "B" (support/testApp.js
  # startTestInstance), both on 127.0.0.1, sharing the database and the GitHub mock.
  # dev/backend/src/utils/sharedOneTimeStore.js keeps each OAuth state and one-time code in
  # `auth_one_time` under the sha256 of its value, consumed by one atomic findOneAndDelete that
  # also tells, by MongoDB's clock, whether it was still live (so the document is spent either
  # way). dev/backend/src/middleware/mongoRateLimitStore.js counts every limiter in `rate_limits`.
  # Both expire by MongoDB's clock; the TTL indexes only clean up. Steps: shared-auth.steps.js.

  Background:
    Given the developer database is empty
    And backend instances "A" and "B" share the database

  # --- OAuth state and one-time codes --------------------------------------------------------

  @smoke @regression @P1
  Scenario: A sign-in started on one instance completes on the other, and the token works on the first
    Given GitHub will sign in "alice" at the next callback
    When sign-in is started on instance "A"
    And GitHub sends the browser back to instance "B" with that state
    Then the browser should be sent back to the client with a one-time code
    When the one-time code is redeemed on instance "B"
    Then the response should carry a session token for "alice"
    And the session token should work on instance "A"
    And the database should hold 0 stored states and 0 stored one-time codes

  @regression @P1
  Scenario: A one-time code from one instance's callback is redeemed on the other
    Given "alice" got a one-time sign-in code from instance "A"
    When the one-time code is redeemed on instance "B"
    Then the response should carry a session token for "alice"
    And the session token should work on instance "A"

  @edge @regression @P1
  Scenario: Concurrent callbacks with one state on both instances: exactly one gets a one-time code
    Given GitHub will sign in "alice" at the next callback
    When sign-in is started on instance "A"
    And GitHub sends the browser back 3 times at once to each of instances "A" and "B" with that state
    Then exactly one of those callbacks should send the browser back to the client with a one-time code
    And every other one should be answered 400 with the auth error code "state_invalid"

  @edge @regression @P1
  Scenario: Concurrent redemptions of one code on both instances: exactly one gets a session token
    Given "alice" got a one-time sign-in code from instance "A"
    When the one-time code is redeemed 3 times at once on each of instances "A" and "B"
    Then exactly one of those redemptions should carry a session token for "alice"
    And every other one should be answered 400 with the auth error code "code_invalid"
    And the database should hold 0 stored states and 0 stored one-time codes

  @edge @regression @P1
  Scenario: A wrong verifier on one instance burns the code for every instance
    Given "alice" got a one-time sign-in code from instance "A"
    When the one-time code is redeemed on instance "B" with a wrong verifier
    Then the response status should be 400
    And the response should be an auth error with code "code_verifier_invalid"
    And the stored one-time code should be gone from the database
    When the one-time code is redeemed on instance "A"
    Then the response status should be 400
    And the response should be an auth error with code "code_invalid"

  # "The server clock steps back" moves only the instances' clock (Date.now), not MongoDB's: an
  # instance whose clock is off still issues values that live their full lifetime.
  @edge @regression @P2
  Scenario: States live 10 minutes and one-time codes 60 seconds, by MongoDB's clock
    Given "alice" got a one-time sign-in code from instance "A"
    Then the stored one-time code should expire 60 seconds after it was issued, by MongoDB's clock
    When sign-in is started on instance "B"
    Then the stored state should expire 600 seconds after it was issued, by MongoDB's clock
    When the server clock steps back by 300000 ms
    And sign-in is started on instance "A"
    Then the stored state should expire 600 seconds after it was issued, by MongoDB's clock

  @edge @regression @P1
  Scenario: An expired state is rejected on the other instance before the TTL monitor removes it, and is spent
    Given MongoDB's TTL monitor is off
    And GitHub will sign in "alice" at the next callback
    When sign-in is started on instance "A"
    And the stored state expired 1 second ago
    Then the stored state should still be in the database
    When GitHub sends the browser back to instance "B" with that state
    Then the response status should be 400
    And the response should be an auth error with code "state_invalid"
    And the stored state should be gone from the database

  @edge @regression @P1
  Scenario: An expired one-time code is rejected on the other instance before the TTL monitor removes it, and is spent
    Given MongoDB's TTL monitor is off
    And "alice" got a one-time sign-in code from instance "A"
    And the stored one-time code expired 1 second ago
    Then the stored one-time code should still be in the database
    When the one-time code is redeemed on instance "B"
    Then the response status should be 400
    And the response should be an auth error with code "code_invalid"
    And the response should not contain a session token
    And the stored one-time code should be gone from the database

  @regression @P1
  Scenario: The stored sign-in values hold hashes, no raw state or code and no GitHub token
    Given "alice" got a one-time sign-in code from instance "A"
    When sign-in is started on instance "B"
    Then the database should hold 1 stored state and 1 stored one-time code
    And each stored sign-in value should be keyed by the sha256 of its raw value
    And no stored sign-in value should contain a raw state, one-time code, PKCE verifier or GitHub access token
    And the stored one-time code should carry the sign-in of "alice" and nothing else
    And the auth_one_time collection should have a TTL index on "expiresAt"
    And the rate_limits collection should have a TTL index on "resetTime"

  @regression @P1
  Scenario: Sign-ins across instances log no state, code, verifier or token
    Given the server log is captured
    And GitHub will sign in "alice" at the next callback
    When sign-in is started on instance "A"
    And GitHub sends the browser back to instance "B" with that state
    Then the browser should be sent back to the client with a one-time code
    When the one-time code is redeemed on instance "A" with a wrong verifier
    Then the response should be an auth error with code "code_verifier_invalid"
    When "bob" signs in on instance "B"
    And sign-in is started on instance "B"
    And the stored state expired 1 second ago
    And GitHub sends the browser back to instance "A" with that state
    Then the response should be an auth error with code "state_invalid"
    Given GitHub will sign in "carol" at the next callback
    When sign-in is started on instance "A"
    And the shared sign-in store fails at its next consume
    And GitHub sends the browser back to instance "B" with that state
    Then the response status should be 500
    And the captured server log should contain no state, one-time code, PKCE verifier or token of this scenario

  # --- Store failures: fail closed -------------------------------------------------------------

  @edge @regression @P2
  Scenario: A failing sign-in store answers 500 internal_error and logs no key
    Given the server log is captured
    And GitHub will sign in "alice" at the next callback
    When sign-in is started on instance "A"
    And the shared sign-in store fails at its next consume
    And GitHub sends the browser back to instance "B" with that state
    Then the response status should be 500
    And the response should be a JSON error with code "internal_error"
    And the captured server log should report a failed "auth_one_time consume (state)" without its key

  @edge @regression @P2
  Scenario: A failing rate-limit store answers 500 internal_error, never lets the request through, and logs no key
    Given the server log is captured
    And the shared rate-limit store fails at its next increment
    When sign-in is started on instance "B"
    Then the response status should be 500
    And the response should be a JSON error with code "internal_error"
    And the captured server log should report a failed "rate_limits increment" without its key

  # --- Rate limits -----------------------------------------------------------------------------

  @smoke @regression @P1
  Scenario: Sign-in requests from one IP count against one limit on every instance
    Given the sign-in rate limit is 3 requests per window
    When sign-in is started 2 times on instance "A"
    And sign-in is started on instance "B"
    Then the response status should be 302
    When sign-in is started on instance "B"
    Then the response should be the 429 rate-limit answer for at most 3 sign-in requests
    And the stored "sign_in:" counter should be at 4

  @regression @P2
  Scenario: The start, the callback and the token exchange count together across instances
    Given the sign-in rate limit is 3 requests per window
    And "alice" got a one-time sign-in code from instance "A"
    When the one-time code is redeemed on instance "B"
    Then the response should carry a session token for "alice"
    When sign-in is started on instance "B"
    Then the response should be the 429 rate-limit answer for at most 3 sign-in requests

  @regression @P2
  Scenario: Session checks count against one limit on every instance
    Given the session check rate limit is 2 requests per window
    And I am signed in as "gaearon"
    When I check my session on instance "A"
    And I check my session on instance "B"
    Then the response status should be 200
    When I check my session on instance "A"
    Then the response should be the 429 rate-limit answer for at most 2 session checks

  @regression @P1
  Scenario: Profile changes of one account count against one limit on every instance; another account is unaffected
    Given the profile change rate limit is 2 requests per window
    And I am signed in as "gaearon"
    And I registered on instance "A" with techs "ReactJS", latitude "-23.5510" and longitude "-46.6330"
    When I update my profile on instance "A" with techs "ReactJS, Node.js", latitude "-23.5510" and longitude "-46.6330"
    Then the response status should be 200
    When I update my profile on instance "B" with techs "ReactJS", latitude "-23.5510" and longitude "-46.6330"
    Then the response status should be 200
    When I delete my profile on instance "A"
    Then the response should be the 429 rate-limit answer for at most 2 profile changes
    Given I am signed in as "sophiebits"
    And I registered on instance "B" with techs "ReactJS", latitude "-23.5510" and longitude "-46.6330"
    When I update my profile on instance "B" with techs "Go", latitude "-23.5510" and longitude "-46.6330"
    Then the response status should be 200
    When I delete my profile on instance "A"
    Then the response status should be 204

  @edge @regression @P2
  Scenario: A finished window restarts the shared counter
    Given the sign-in rate limit is 2 requests per window
    When sign-in is started 2 times on instance "A"
    And sign-in is started on instance "B"
    Then the response status should be 429
    When 901 seconds pass
    And sign-in is started on instance "B"
    Then the response status should be 302
    And the stored "sign_in:" counter should be at 1
    When sign-in is started on instance "A"
    Then the response status should be 302
    When sign-in is started on instance "A"
    Then the response status should be 429

  @regression @P2
  Scenario: Resetting the rate limits on one instance clears the counters of every instance
    Given the sign-in rate limit is 2 requests per window
    And the session check rate limit is 1 requests per window
    And I am signed in as "gaearon"
    When sign-in is started 2 times on instance "A"
    And I check my session on instance "A"
    Then the response status should be 200
    When the rate limits of instance "B" are reset
    Then no rate-limit counter should be stored
    When sign-in is started 2 times on instance "A"
    And I check my session on instance "B"
    Then the response status should be 200
