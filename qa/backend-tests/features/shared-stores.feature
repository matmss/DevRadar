@shared-auth
Feature: The MongoDB-backed stores behind shared sign-in and rate limits (multi-instance PR1)
  As the team relying on MongoDB for state every backend instance shares
  I want each store method to keep its contract on its own, not only through the routes
  So that a limiter option or a future caller cannot reach an untested path

  # Store-level checks of dev/backend/src/middleware/mongoRateLimitStore.js (express-rate-limit
  # Store) and dev/backend/src/utils/sharedOneTimeStore.js, against the suite's real ephemeral
  # mongod (their $$NOW pipelines cannot be faked). They live here, not in unit/, because Jest's
  # sandbox breaks the MongoDB 7 driver's handshake ("Missing required sub-document 'driver'").
  # The routes only ever call increment and resetAll (rateLimits.reset()); get, decrement and
  # resetKey are covered here. Through the routes: shared-auth.feature. Steps: shared-stores.steps.js.

  # --- Rate-limit store ----------------------------------------------------------------------

  @regression @P2
  Scenario: Hits count in one window per key, taken back never below 0, and a finished window restarts
    Given a rate-limit store with prefix "p:" and a 60 second window
    When key "k" gets 2 hits in store "p:"
    Then store "p:" should count 2 hits for key "k" in a window ending about 60 seconds from now by MongoDB's clock
    When key "k" gets 3 hits taken back in store "p:"
    Then store "p:" should count 0 hits for key "k" in a window ending about 60 seconds from now by MongoDB's clock
    When key "k" gets 1 hit in store "p:"
    And the window of key "k" in store "p:" is over
    Then store "p:" should count no window for key "k"
    When key "k" gets 1 hit taken back in store "p:"
    Then the stored counter "p:k" should still be at 1
    When key "k" gets 1 hit in store "p:"
    Then store "p:" should count 1 hit for key "k" in a window ending about 60 seconds from now by MongoDB's clock

  @edge @regression @P2
  Scenario: Concurrent first hits of one key each count once
    Given a rate-limit store with prefix "p:" and a 60 second window
    When key "k" gets 20 hits at once in store "p:"
    Then those hits should have counted 1 to 20

  @regression @P2
  Scenario: Resetting a key or a store touches only its own prefix, matched literally
    Given a rate-limit store with prefix "a.b:" and a 60 second window
    And a rate-limit store with prefix "aXb:" and a 60 second window
    When key "1" gets 1 hit in store "a.b:"
    And key "2" gets 1 hit in store "a.b:"
    And key "1" gets 1 hit in store "aXb:"
    And key "1" of store "a.b:" is reset
    Then store "a.b:" should count no window for key "1"
    And store "a.b:" should count 1 hit for key "2" in a window ending about 60 seconds from now by MongoDB's clock
    When store "a.b:" is reset
    Then store "a.b:" should count no window for key "2"
    And store "aXb:" should count 1 hit for key "1" in a window ending about 60 seconds from now by MongoDB's clock

  # --- One-time store --------------------------------------------------------------------------

  @edge @regression @P2
  Scenario: A payload is stored as given, even strings that look like field paths or variables
    Given a one-time store for "state" values living 60 seconds
    When it issues a key for a payload with the strings "$notAPath", "$$NOW" and "$literal"
    Then consuming that key in the "state" store should give back the same payload
    And consuming that key in the "state" store again should give nothing

  @regression @P2
  Scenario: A state is never accepted as a code, and presenting it as one does not spend it
    Given a one-time store for "state" values living 60 seconds
    And a one-time store for "code" values living 60 seconds
    When the "state" store issues a key
    Then consuming that key in the "code" store should give nothing
    And consuming that key in the "state" store should give back the same payload

  @edge @regression @P3
  Scenario: A key whose hash is already stored is replaced by a fresh one, never overwriting the stored value
    Given a one-time store for "state" values living 60 seconds
    And the next 1 insert of a one-time value fails as a duplicate key
    When the "state" store issues a key
    Then it should have tried 2 different stored ids, each only if absent
    And consuming that key in the "state" store should give back the same payload

  @edge @regression @P3
  Scenario: Repeated key collisions fail closed
    Given a one-time store for "state" values living 60 seconds
    And the next 3 inserts of a one-time value fail as a duplicate key
    When the "state" store tries to issue a key
    Then issuing should have failed with "auth_one_time issue (state) failed: KeyCollision"

  @regression @P3
  Scenario: Clearing one kind leaves the other
    Given a one-time store for "state" values living 60 seconds
    And a one-time store for "code" values living 60 seconds
    When the "code" store issues a key
    And the "state" store issues another key
    And the "state" store is cleared
    Then the database should hold 0 stored states and 1 stored one-time code
    And consuming that key in the "code" store should give back the same payload
