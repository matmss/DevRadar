@multi-instance @shared-auth @mi-pr1-review
Feature: QA review of multi-instance PR1 (shared sign-in state and rate limits in MongoDB)
  As QA reviewing feat/mi-pr1-shared-auth
  I want the failure paths and headers the MongoDB stores introduced to keep the old contracts
  So that sharing the state across instances does not change what clients see

  # Reuses shared-auth.steps.js, multi-instance.steps.js and auth.steps.js. New steps:
  # mi-pr1-review.steps.js.

  Background:
    Given the developer database is empty
    And backend instances "A" and "B" share the database

  # QA-MI1-1. dev/docs/00-architecture.md, sign-in step 2: once the state is consumed "the browser
  # always goes back to the client with a 302" (error=sign_in_failed&reason=... on any failure).
  # Before PR1 nothing after the state check could throw; now the one-time code is written to
  # MongoDB after the state was spent, and a failure there answers the browser with the backend's
  # raw 500 JSON at the callback URL: the web tab stays on the backend page, and the mobile auth
  # session never returns to the app scheme.
  @edge @regression @P2
  Scenario: QA-MI1-1 A code store failure after the state was spent still sends the browser back to the client
    Given the server log is captured
    And GitHub will sign in "alice" at the next callback
    When sign-in is started on instance "A"
    And the shared sign-in store fails at its next issue
    And GitHub sends the browser back to instance "B" with that state
    Then the browser should be sent back to the client with error "sign_in_failed" and no one-time code
    And the stored state should be gone from the database
    And the database should hold 0 stored states and 0 stored one-time codes
    And the captured server log should name none of the state, PKCE verifier or GitHub token

  # QA-MI1-2. The window's end is MongoDB's clock (resetTime = $$NOW + 15 min), but express-rate-limit
  # turns it into the RateLimit "reset" and Retry-After seconds with the instance's Date.now().
  # Before PR1 both came from the same clock, so the headers were always 1..900 s. With an instance
  # clock behind MongoDB's they exceed the window; ahead by more than what is left, they are 0
  # (Retry-After: 0 invites an immediate retry into another 429).
  @edge @regression @P3
  Scenario Outline: QA-MI1-2 The 429 headers count the shared window down by MongoDB's clock when an instance's clock is <seconds> s <direction> it
    Given the sign-in rate limit is 1 requests per window
    When sign-in is started on instance "A"
    And the server clock runs <seconds> seconds <direction> MongoDB's
    And sign-in is started on instance "B"
    Then the response status should be 429
    And the rate-limit headers should say the window ends in about 900 seconds

    Examples:
      | direction | seconds |
      | behind    | 300     |
      | ahead of  | 1000    |

  # Same root cause, seen through the harness: "N seconds pass" moves Date.now forward AND the
  # stored resetTime back, so the headers lose 2N seconds and no scenario can check them after
  # time passes (in production both clocks move and this answers about 300).
  @edge @regression @P3
  Scenario: QA-MI1-2 After 600 seconds of a 900-second window, the 429 headers say about 300 seconds are left
    Given the sign-in rate limit is 1 requests per window
    When sign-in is started on instance "A"
    And 600 seconds pass
    And sign-in is started on instance "B"
    Then the response status should be 429
    And the rate-limit headers should say the window ends in about 300 seconds

  # QA-MI1-4 (test gap, re-check of 7489f27). Fixed windows: the window ends windowMs after its
  # FIRST hit, and later hits never move that end. shared-stores.feature's "Concurrent first hits"
  # used to catch a store that pushes resetTime out on every hit (all 20 hits had to share one
  # resetTime); since QA-MI1-2 it compares the stored count only, so this checks it directly.
  @edge @regression @P2
  Scenario: QA-MI1-4 A hit late in the window does not extend it: the counter restarts 15 minutes after the first hit
    Given the sign-in rate limit is 2 requests per window
    When sign-in is started on instance "A"
    And 600 seconds pass
    And sign-in is started on instance "B"
    Then the response status should be 302
    When 301 seconds pass
    And sign-in is started on instance "A"
    Then the response status should be 302
    And the stored "sign_in:" counter should be at 1
