Feature: QA review of the avatar-id claim guard (spec 05, B1)
  As the QA engineer reviewing the claim guard
  I want the edge cases the delivery's scenarios do not reach pinned down
  So that the guard never turns a registration into a server error, its log always names the
  developer, and the operator tool tells the truth about who can claim

  # Spec: dev/docs/05-claim-guard-spec.md. Delivery scenarios: features/claim-guard.feature.
  # QA-CG-1: Mongoose casts a hand-edited BSON Binary or an embedded document with a string _id
  #   to that string when it reads the dev, so the guard reads a guarding avatar URL, but the
  #   displacement filter (avatar exactly as read) never matches the stored non-string: POST /devs
  #   retries three times and answers 500, every time; the sign-in displacement fails the same way
  #   (logged, swallowed). The operator tool (raw documents) calls the same dev unparseable,
  #   "claimable_by login".
  # QA-CG-2: the guard displacement costs a registration one more inLoginOrder attempt than a
  #   claim, so a concurrent stale session of another account that displaces the guarded dev and
  #   then registers the login (its own two writes) leaves no attempt for the real holder: 500.
  # QA-CG-3: a developer with a hand-edited non-ObjectId _id is logged as "dev undefined" (the
  #   cast fails on read), so the warning does not name it.
  # QA-CG-4: list says "claimable_by none" for every dev flagged github_username_stale, even when
  #   its login is a real one that the API still lets its holder claim (hand-edited flag).

  Background:
    Given the developer database is empty

  @edge @regression @P2
  Scenario Outline: A registration over a hand-edited <kind> avatar naming another account is never a server error (QA-CG-1)
    Given the legacy developer "alice" was stored before sign-in with a hand-edited <kind> avatar_url naming avatar id 111
    And I am signed in as "alice" with GitHub account 222
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And exactly 1 developer should belong to GitHub account 222
    And at most one developer should show the login "alice", in any letter case

    Examples:
      | kind            |
      | BSON Binary     |
      | embedded _id    |

  @edge @regression @P2
  Scenario Outline: The operator tool's claimable_by agrees with what the API does for a hand-edited <kind> avatar (QA-CG-1)
    Given the legacy developer "alice" was stored before sign-in with a hand-edited <kind> avatar_url naming avatar id 111
    When the operator lists the legacy developers as JSON
    And GitHub account 222 as "alice" updates their profile
    Then the update should agree with the listing's claimable_by for "alice" and GitHub account 222

    Examples:
      | kind            |
      | BSON Binary     |
      | embedded _id    |

  @edge @regression @P2
  Scenario: A stale session of another account displaces the guarded developer and registers in between: the newest holder still registers (QA-CG-2)
    Given the legacy developer "alice" was stored before sign-in with avatar id 111
    And GitHub account 333 as "alice", with an older read, displaces "alice" and then registers, interleaved with my registration
    And I am signed in as "alice" with GitHub account 222
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the race should have happened
    And the response status should be 200
    And exactly 1 developer should belong to GitHub account 222
    And the developer showing github_username "alice" should belong to GitHub account 222
    And the developer of GitHub account 333 should be displaced

  @edge @regression @P2
  Scenario: A refused claim on a developer with a hand-edited string _id names that _id in the log (QA-CG-3)
    Given the legacy developer "alice" was stored before sign-in with the string _id "legacy-alice-1" and avatar id 111
    And I am signed in as "alice" with GitHub account 222
    And the server's log lines are being recorded
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 404
    And the log should have 1 guard warning, each naming the developer "alice", login "alice", account 222 and avatar id 111

  @edge @regression @P2
  Scenario Outline: claimable_by agrees with the API for a developer flagged stale that still shows a real login (QA-CG-4): avatar <avatar>, account <account>
    Given the legacy developer "erin" was stored before sign-in with avatar "<avatar>"
    And the legacy developer "erin" is flagged github_username_stale but still shows its login
    When the operator lists the legacy developers as JSON
    And GitHub account <account> as "erin" updates their profile
    Then the update should agree with the listing's claimable_by for "erin" and GitHub account <account>

    Examples:
      | avatar                                          | account |
      | https://example.com/avatar.png                  | 222     |
      | https://avatars.githubusercontent.com/u/111?v=4 | 111     |

  # --- Mutation guards: these pass on the delivery and fail on a mutant the delivery's scenarios
  # --- let through (see the QA review). -------------------------------------------------------

  # Kills: the guarded displacement without "its avatar as read" in its filter, or with a filter
  # that also matches a non-string (which is no evidence, so the dev is mine to claim).
  @edge @regression @P2
  Scenario Outline: The avatar changes to <change> just before the guarded displacement: the displacement misses and I claim the developer
    Given the legacy developer "alice" was stored before sign-in with avatar id 111
    And the avatar of the legacy developer "alice" changes to <change> just before its displacement
    And I am signed in as "alice" with GitHub account 222
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the race should have happened
    And the response status should be 200
    And the response should be the developer "alice"
    And the developer "alice" should belong to GitHub account 222
    And the developer "alice" should show login "alice"

    Examples:
      | change                                                  |
      | avatar id 222                                           |
      | a hand-edited BSON Binary avatar_url naming avatar id 111 |

  # Kills: a guard warning (or the avatar filter) on the AC-10 path, where the account owns a dev.
  @regression @P2
  Scenario Outline: An account that owns a developer displaces a legacy holder with another account's avatar without a guard warning: <action>
    Given the legacy developer "alice" was stored before sign-in with avatar id 111
    And a developer "alice-old" owned by GitHub account 222 with avatar id 222 and an older login state
    And I am signed in as "alice" with GitHub account 222
    And the server's log lines are being recorded
    When <action>
    Then the developer "alice" should be displaced
    And the developer "alice-old" should show login "alice"
    And the log should have no guard warning

    Examples:
      | action                                                                                 |
      | I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"   |
      | I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"       |
      | I signed in through GitHub as "alice" with GitHub account 222                          |

  # Kills: a "displaced" guard warning for a guarded displacement that missed (the real owner
  # claimed first; the retry displaces the owner's dev, which is not a guarded displacement).
  @edge @regression @P2
  Scenario: A guarded displacement that loses to the real owner's claim logs only the refused claim
    Given the legacy developer "alice" was stored before sign-in with avatar id 111
    And GitHub account 111 claims the legacy developer "alice" with an older read just before its displacement
    And I am signed in as "alice" with GitHub account 222
    And the server's log lines are being recorded
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the race should have happened
    And the response should be a new developer of GitHub account 222 with login "alice", not "alice"
    And the log should have 1 guard warning, each naming the developer "alice", login "alice", account 222 and avatar id 111
    And every guard warning should say "claim refused"

  # Kills: claimable_by written as a string for a guarded dev (avatar_id is a number in the JSON).
  @regression @P2
  Scenario: list --json gives claimable_by the same JSON type as avatar_id
    Given the legacy developer "anna" was stored before sign-in with avatar id 111
    When the operator lists the legacy developers as JSON
    Then the listing entry for "anna" should have claimable_by equal to its avatar_id, the number 111

  # Kills: printable() without its character filter or its 64-character cap (live since the log
  # names the stored _id, QA-CG-3 fix).
  @edge @regression @P2
  Scenario: A hand-edited string _id with control characters is logged as at most 64 printable ASCII characters
    Given the legacy developer "alice" was stored before sign-in with a 100-character string _id holding control characters and avatar id 111
    And I am signed in as "alice" with GitHub account 222
    And the server's log lines are being recorded
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 404
    And the guard warning should name the first 64 characters of that _id with each non-printable character as "?"

  # Kills: no cap on the DISPLACED rounds (QA-CG-2 fix), or a cap above nine. Reachable with API
  # access only, by accounts whose sessions read "alice" before mine (they held it on GitHub
  # earlier, tokens live 7 days): each deletes its profile and registers again while my
  # registration has just freed the login. Every round of mine then displaces one of them.
  @edge @regression @P2
  Scenario: An endless stream of older holders: the registration gives up after at most nine displacements with a JSON 500
    Given the developer "alice" owned by GitHub account 1000 with an older login state is replaced by another older holder after every displacement
    And I am signed in as "alice" with GitHub account 222
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 500
    And the response should be a JSON error with code "internal_error"
    And at most 9 developers should have been displaced
    And exactly 0 developers should belong to GitHub account 222
