Feature: A profile write that gives up after concurrent changes answers 503 profile_busy
  As a DevRadar client
  I want a write that lost every race against concurrent changes to say "busy, try again"
  So that I retry instead of reporting a broken server, and nothing was half-written

  # services/devOwnership.js retries a lost race a bounded number of times: resolveOwnDev's
  # legacy claim (MAX_ATTEMPTS) and inLoginOrder, which takes the account's login (MAX_ATTEMPTS
  # lost races, MAX_ROUNDS rounds in all). Both give up with a ProfileBusyError, which
  # middleware/errorHandler.js answers 503 { error: "Profile is busy", code: "profile_busy",
  # details } with Retry-After: 1, logged as one warning line (not an error with a stack).
  # Exhaustion is forced deterministically: every conditional write of one kind misses, as if
  # another request changed the record between the read and the write each time.
  # Sign-in stays best effort: its login refresh gives up the same way, is logged, and the
  # sign-in succeeds. GET /devs/me never claims, so it never gives up.

  Background:
    Given the developer database is empty

  @regression @P2
  Scenario Outline: A legacy claim that loses every race answers 503 profile_busy: <method> <path>
    Given the legacy developer "alice" was stored before sign-in without an avatar
    And every claim of a legacy developer misses
    And I am signed in as "alice" with GitHub account 222
    And the server's log lines are being recorded
    When <action>
    Then the race should have happened
    And the response should be 503 profile_busy, retry after 1 second
    And the developer "alice" should still be legacy
    And the developer "alice" should show login "alice"
    And exactly 0 developers should belong to GitHub account 222
    And the log should have one profile_busy warning for "<method> <path>" and no error

    Examples:
      | method | path     | action                                                                                |
      | POST   | /devs    | I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333" |
      | PUT    | /devs/me | I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"     |
      | DELETE | /devs/me | I delete my profile                                                                   |

  @regression @P2
  Scenario: Reading my profile never gives up, even when every claim would miss
    Given the legacy developer "alice" was stored before sign-in without an avatar
    And every claim of a legacy developer misses
    And I am signed in as "alice" with GitHub account 222
    When I request my profile
    Then the response status should be 200
    And the response should be the developer "alice"
    And the developer "alice" should still be legacy

  @regression @P2
  Scenario Outline: Taking my login loses every race against its holder: <method> <path> answers 503 profile_busy
    Given a developer "alice" owned by GitHub account 111 with avatar id 111 and an older login state
    And a developer "alice-old" owned by GitHub account 222 with avatar id 222 and an older login state
    And every displacement of a developer misses
    And I am signed in as "alice" with GitHub account 222
    And the server's log lines are being recorded
    When <action>
    Then the race should have happened
    And the response should be 503 profile_busy, retry after 1 second
    And the developer "alice" should show login "alice"
    And the developer "alice-old" should show login "alice-old"
    And the developer of GitHub account 222 should have techs "Go"
    And the log should have one profile_busy warning for "<method> <path>" and no error

    Examples:
      | method | path     | action                                                                                  |
      | POST   | /devs    | I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"   |
      | PUT    | /devs/me | I update my profile with techs "Rust", latitude "-23.5505" and longitude "-46.6333"     |

  @regression @P2
  Scenario: Sign-in still succeeds when taking my login loses every race against its holder
    Given a developer "alice" owned by GitHub account 111 with avatar id 111 and an older login state
    And a developer "alice-old" owned by GitHub account 222 with avatar id 222 and an older login state
    And every displacement of a developer misses
    And the server's log lines are being recorded
    When I signed in through GitHub as "alice" with GitHub account 222
    Then the race should have happened
    And the log should say the login could not be refreshed at sign-in
    And the developer "alice" should show login "alice"
    And the developer "alice-old" should show login "alice-old"
    When I call GET /auth/me with the session token
    Then the response status should be 200
