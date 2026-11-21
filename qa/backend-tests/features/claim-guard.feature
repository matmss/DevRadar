Feature: A stranger holding a renamed owner's old login cannot claim the legacy profile (spec 05, B1)
  As the renamed owner of a profile created before sign-in existed
  I want the account that now holds my old GitHub login to be unable to take over my profile
  So that my location, techs and bio never show up under someone else's account

  # Spec: dev/docs/05-claim-guard-spec.md (AC-1 to AC-17; AC-18 is web-tests/features/claim-guard.feature).
  # Rule (services/devOwnership.js): a legacy dev (github_id missing or null) whose login matches
  # account N's but whose avatar_url parses (utils/githubAvatarId.js) to another account's id M is
  # GUARDED against N: it is never N's to read, claim, change or delete, exactly like another
  # account's dev showing N's login (rule 3). N's newer GitHub read displaces it (POST /devs, and
  # at sign-in); PUT, DELETE and GET /devs/me answer 404 dev_not_found. An avatar id equal to N,
  # unparseable or missing keeps the old rule (claimed by login on the first write).
  # "was stored before sign-in with avatar id M" seeds a legacy dev as the pre-auth backend did
  # (name = login, techs "Node.js", latitude -23.5505, longitude -46.6333) with avatar_url
  # https://avatars.githubusercontent.com/u/M?v=4. "I am signed in as" issues a test session
  # token whose GitHub read is now, so it is newer than any seeded login state; it does not run
  # the sign-in itself ("I signed in through GitHub as" does).

  Background:
    Given the developer database is empty

  # --- AC-1 to AC-4: the guarded dev is never the stranger's -----------------------------------

  @smoke @regression @P1
  Scenario: POST /devs displaces the guarded developer and registers a fresh profile (AC-1)
    Given the legacy developer "alice" was stored before sign-in with avatar id 111
    And the legacy developer "alice" has the name "Alice Before Rename" and the bio "legacy bio text"
    And a signed-in client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "Node.js"
    And I am signed in as "alice" with GitHub account 222
    And I remember every stored developer
    And the server's log lines are being recorded
    When I submit a registration with techs "Node.js", latitude "-23.5505" and longitude "-46.6333"
    Then the response should be a new developer of GitHub account 222 with login "alice", not "alice"
    And the developer "alice" should be displaced, with everything else as before
    And the developer "alice" should have the avatar id 111
    And client "watcher" should receive exactly 1 "dev-updated" event within 2 seconds
    And the "dev-updated" event for "watcher" should be the developer "alice", displaced
    And client "watcher" should receive exactly 1 "new-dev" event within 1 seconds
    And the log should have 2 guard warnings, each naming the developer "alice", login "alice", account 222 and avatar id 111
    And no log line should contain the session token, an avatar URL, "Alice Before Rename", "legacy bio text" or the coordinates
    And the response should not reveal the developer "alice"

  @smoke @regression @P1
  Scenario: PUT /devs/me is 404 and leaves the guarded developer untouched (AC-2)
    Given the legacy developer "alice" was stored before sign-in with avatar id 111
    And the legacy developer "alice" has the name "Alice Before Rename" and the bio "legacy bio text"
    And a signed-in client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "Node.js,Go"
    And I am signed in as "alice" with GitHub account 222
    And I remember every stored developer
    And the server's log lines are being recorded
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 404
    And the response should be a JSON error with code "dev_not_found"
    And the response should not reveal the developer "alice"
    And nothing should have been written to the database
    And exactly 0 developers should belong to GitHub account 222
    And client "watcher" should not receive a "dev-updated" event within 1 seconds
    And the log should have 1 guard warning, each naming the developer "alice", login "alice", account 222 and avatar id 111
    And no log line should contain the session token, an avatar URL, "Alice Before Rename", "legacy bio text" or the coordinates

  @smoke @regression @P1
  Scenario: DELETE /devs/me is 404 and deletes nothing (AC-3)
    Given the legacy developer "alice" was stored before sign-in with avatar id 111
    And a signed-in client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "Node.js"
    And I am signed in as "alice" with GitHub account 222
    And I remember every stored developer
    And the server's log lines are being recorded
    When I delete my profile
    Then the response status should be 404
    And the response should be a JSON error with code "dev_not_found"
    And nothing should have been written to the database
    And client "watcher" should not receive a "dev-deleted" event within 1 seconds
    And the log should have 1 guard warning, each naming the developer "alice", login "alice", account 222 and avatar id 111

  @smoke @regression @P1
  Scenario: GET /devs/me does not show the guarded developer, and logs nothing (AC-4)
    Given the legacy developer "alice" was stored before sign-in with avatar id 111
    And I am signed in as "alice" with GitHub account 222
    And I remember every stored developer
    And the server's log lines are being recorded
    When I request my profile
    Then the response status should be 404
    And the response should be a JSON error with code "dev_not_found"
    And the response should not reveal the developer "alice"
    And nothing should have been written to the database
    And the log should have no guard warning

  # --- AC-5 to AC-7: no evidence against the claimer keeps today's rule ----------------------------

  @smoke @regression @P1
  Scenario: The avatar names the claimer: read-only on GET, claimed on the first PUT (AC-5)
    Given the legacy developer "alice" was stored before sign-in with avatar id 222
    And I am signed in as "alice" with GitHub account 222
    And I remember every stored developer
    And the server's log lines are being recorded
    When I request my profile
    Then the response status should be 200
    And the response should be the developer "alice"
    And nothing should have been written to the database
    When I update my profile with techs "Go", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 200
    And the response should be the developer "alice"
    And the developer "alice" should belong to GitHub account 222
    And the developer "alice" should show login "alice"
    And the log should have no guard warning

  @regression @P1
  Scenario: The avatar names the claimer: POST returns the claimed developer (AC-5)
    Given the legacy developer "alice" was stored before sign-in with avatar id 222
    And I am signed in as "alice" with GitHub account 222
    When I submit a registration with techs "Go", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 200
    And the response should be the developer "alice"
    And the developer "alice" should belong to GitHub account 222
    And exactly 1 developer should belong to GitHub account 222

  @regression @P1
  Scenario: The avatar names the claimer: DELETE deletes the legacy developer (AC-5)
    Given the legacy developer "alice" was stored before sign-in with avatar id 222
    And I am signed in as "alice" with GitHub account 222
    When I delete my profile
    Then the response status should be 204
    And the developer "alice" should no longer exist

  @regression @P1
  Scenario Outline: The login matches in any letter case, for the guard as for the claim (AC-6): avatar id <avatar>
    Given the legacy developer "Alice" was stored before sign-in with avatar id <avatar>
    And I am signed in as "ALICE" with GitHub account 222
    And I remember every stored developer
    When I submit a registration with techs "Node.js", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And <outcome>

    Examples:
      | avatar | outcome                                                                          |
      | 111    | the developer "Alice" should be displaced, with everything else as before        |
      | 222    | the response should be the developer "Alice"                                     |

  @regression @P1
  Scenario: A guarded developer in another letter case is a fresh registration with the claimer's spelling (AC-6)
    Given the legacy developer "Alice" was stored before sign-in with avatar id 111
    And I am signed in as "ALICE" with GitHub account 222
    When I submit a registration with techs "Node.js", latitude "-23.5505" and longitude "-46.6333"
    Then the response should be a new developer of GitHub account 222 with login "ALICE", not "Alice"

  @regression @P1
  Scenario Outline: Without evidence against the claimer the legacy developer is claimed as before (AC-7): <avatar_url>
    Given the legacy developer "alice" was stored before sign-in with avatar_url "<avatar_url>"
    And I am signed in as "alice" with GitHub account 222
    And the server's log lines are being recorded
    When I update my profile with techs "Go", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 200
    And the response should be the developer "alice"
    And the developer "alice" should belong to GitHub account 222
    And the log should have no guard warning

    Examples:
      | avatar_url                                                    |
      | https://example.com/avatar.png                                |
      | https://secure.gravatar.com/avatar/0cc175b9c0f1b6a            |
      | https://avatars.githubusercontent.com/in/123?v=4              |
      | https://avatars.githubusercontent.com/u/810438?v=4&u=ab       |
      | https://avatars.githubusercontent.com/u/0123?v=4              |
      | https://avatars.githubusercontent.com/u/99999999999999999?v=4 |
      | <empty>                                                       |
      | <missing>                                                     |
      | <null>                                                        |

  # Mongoose casts these when it reads the dev, so the claim's "avatar as read" filter must still
  # match what is stored (a non-string is never evidence).
  @edge @regression @P2
  Scenario Outline: A hand-edited non-string avatar_url carries no evidence and the claim still works: <value>
    Given the legacy developer "alice" was stored before sign-in with the hand-edited avatar_url <value>
    And I am signed in as "alice" with GitHub account 222
    When I update my profile with techs "Go", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 200
    And the developer "alice" should belong to GitHub account 222

    Examples:
      | value                                                 |
      | 5                                                     |
      | true                                                  |
      | {"u":111}                                             |
      | []                                                    |
      | ["https://avatars.githubusercontent.com/u/111?v=4"]   |

  # --- AC-8: github_id missing versus null; owned devs are never read by their avatar -------------

  @regression @P1
  Scenario Outline: A guarded developer with github_id <github_id> is treated identically (AC-8): <request>
    Given the legacy developer "alice" was stored before sign-in with github_id <github_id> and avatar id 111
    And I am signed in as "alice" with GitHub account 222
    And I remember every stored developer
    When <request>
    Then the response status should be <status>
    And <outcome>

    Examples:
      | github_id | request                                                                            | status | outcome                                                                    |
      | missing   | I request my profile                                                               | 404    | nothing should have been written to the database                           |
      | null      | I request my profile                                                               | 404    | nothing should have been written to the database                           |
      | missing   | I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"  | 404    | nothing should have been written to the database                           |
      | null      | I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"  | 404    | nothing should have been written to the database                           |
      | missing   | I delete my profile                                                                | 404    | nothing should have been written to the database                           |
      | null      | I delete my profile                                                                | 404    | nothing should have been written to the database                           |
      | missing   | I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333" | 200 | the developer "alice" should be displaced, with everything else as before |
      | null      | I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333" | 200 | the developer "alice" should be displaced, with everything else as before |

  @regression @P1
  Scenario Outline: An owned developer's avatar is never evidence: today's conflict rules (AC-8): avatar id <avatar>, <age> state
    Given a developer "alice" owned by GitHub account 111 with avatar id <avatar> and an <age> login state
    And I am signed in as "alice" with GitHub account 222
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be <status>
    And the developer "alice" should belong to GitHub account 111
    And <outcome>

    Examples:
      | avatar | age   | status | outcome                                                         |
      | 222    | older | 200    | the developer "alice" should be displaced                       |
      | 111    | older | 200    | the developer "alice" should be displaced                       |
      | 222    | newer | 409    | the response should be a JSON error with code "github_username_conflict" |
      | 111    | newer | 409    | the response should be a JSON error with code "github_username_conflict" |

  # --- AC-9 and AC-10: sign-in ---------------------------------------------------------------------

  @smoke @regression @P1
  Scenario: Signing in displaces a guarded developer and claims nothing; then GET is 404 and POST registers fresh (AC-9)
    Given the legacy developer "alice" was stored before sign-in with avatar id 111
    And a signed-in client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "Node.js"
    And I remember every stored developer
    And the server's log lines are being recorded
    When I signed in through GitHub as "alice" with GitHub account 222
    Then the developer "alice" should be displaced, with everything else as before
    And exactly 0 developers should belong to GitHub account 222
    And client "watcher" should receive exactly 1 "dev-updated" event within 2 seconds
    And the "dev-updated" event for "watcher" should be the developer "alice", displaced
    And the log should have 1 guard warning, each naming the developer "alice", login "alice", account 222 and avatar id 111
    When I request my profile
    Then the response status should be 404
    And the response should be a JSON error with code "dev_not_found"
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response should be a new developer of GitHub account 222 with login "alice", not "alice"

  @regression @P1
  Scenario Outline: Signing in leaves a legacy developer the account may claim untouched (AC-9): <avatar_url>
    Given the legacy developer "alice" was stored before sign-in with avatar_url "<avatar_url>"
    And I remember every stored developer
    When I signed in through GitHub as "alice" with GitHub account 222
    Then nothing should have been written to the database

    Examples:
      | avatar_url                                       |
      | https://avatars.githubusercontent.com/u/222?v=4  |
      | https://example.com/avatar.png                   |
      | <missing>                                        |

  @regression @P1
  Scenario Outline: An account that owns a developer displaces the legacy holder of its login whatever its avatar (AC-10): avatar id <avatar>, <action>
    Given the legacy developer "alice" was stored before sign-in with avatar id <avatar>
    And a developer "alice-old" owned by GitHub account 222 with avatar id 222 and an older login state
    And I am signed in as "alice" with GitHub account 222
    When <action>
    Then the developer "alice" should be displaced
    And the developer "alice" should still be legacy
    And the developer "alice-old" should show login "alice"
    And exactly 1 developer should belong to GitHub account 222

    Examples:
      | avatar | action                                                                                 |
      | 111    | I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"   |
      | 222    | I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"   |
      | 111    | I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"       |
      | 222    | I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"       |
      | 111    | I signed in through GitHub as "alice" with GitHub account 222                          |
      | 222    | I signed in through GitHub as "alice" with GitHub account 222                          |

  # --- AC-11: an older read than the guarded dev's login state --------------------------------------

  @edge @regression @P1
  Scenario: A guarded developer with a newer login state: POST is 409, PUT and DELETE 404, nothing written (AC-11)
    Given the legacy developer "alice" was stored before sign-in with avatar id 111
    And the legacy developer "alice" has a login state newer than my session
    And I am signed in as "alice" with GitHub account 222
    And I remember every stored developer
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 409
    And the response should be a JSON error with code "github_username_conflict"
    And nothing should have been written to the database
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 404
    And the response should be a JSON error with code "dev_not_found"
    When I delete my profile
    Then the response status should be 404
    And nothing should have been written to the database

  # --- AC-12 to AC-14: races ------------------------------------------------------------------------

  @edge @regression @P1
  Scenario: The real owner claims while the stranger registers: no server error, the newest read wins (AC-12)
    Given the legacy developer "alice" was stored before sign-in with avatar id 111
    When GitHub account 111 as "alice" with a session from 2 days ago updates their profile while GitHub account 222 as "alice" registers
    Then no concurrent request should get a server error
    And the request of GitHub account 222 should be answered 200
    And the developer showing github_username "alice" should belong to GitHub account 222
    And at most one developer should show the login "alice", in any letter case
    And the developer "alice" should be displaced
    And the developer "alice" should not belong to GitHub account 222

  @edge @regression @P1
  Scenario: The real owner's claim lands just before the stranger's displacement: it is displaced as the owner's dev (AC-12)
    Given the legacy developer "alice" was stored before sign-in with avatar id 111
    And GitHub account 111 claims the legacy developer "alice" with an older read just before its displacement
    And I am signed in as "alice" with GitHub account 222
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the race should have happened
    And the response should be a new developer of GitHub account 222 with login "alice", not "alice"
    And the developer "alice" should belong to GitHub account 111
    And the developer "alice" should be displaced

  @edge @regression @P1
  Scenario: The stranger's displacement lands just before the real owner's claim: the claim misses, 404 (AC-12)
    Given the legacy developer "alice" was stored before sign-in with avatar id 111
    And another account displaces the legacy developer "alice" just before my claim
    And I am signed in as "alice" with GitHub account 111, in a session that began 2 days ago
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the race should have happened
    And the response status should be 404
    And the developer "alice" should still be legacy
    And the developer "alice" should be displaced

  # QA-CG-2 for an owned holder (QA's legacy variant is in claim-guard-review.feature): a
  # successful displacement does not use up one of the registration's attempts.
  @edge @regression @P2
  Scenario: Another account takes the login from an owned holder between my displacement and my registration: I still register (QA-CG-2)
    Given a developer "alice" owned by GitHub account 444 with avatar id 444 and an older login state
    And GitHub account 333 as "alice", with an older read, displaces the developer of GitHub account 444 and then registers, interleaved with my registration
    And I am signed in as "alice" with GitHub account 222
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the race should have happened
    And the response status should be 200
    And exactly 1 developer should belong to GitHub account 222
    And the developer showing github_username "alice" should belong to GitHub account 222
    And the developer of GitHub account 333 should be displaced
    And the developer of GitHub account 444 should be displaced

  @edge @regression @P1
  Scenario: A double-clicked registration displaces the guarded developer once and registers once (AC-13)
    Given the legacy developer "alice" was stored before sign-in with avatar id 111
    And a signed-in client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "Node.js"
    And I am signed in as "alice" with GitHub account 222
    When I submit the same registration twice at the same time
    Then both registrations should be answered 200 with the same developer
    And exactly 1 developer should belong to GitHub account 222
    And the developer "alice" should be displaced
    And client "watcher" should receive exactly 1 "dev-updated" event within 2 seconds
    And client "watcher" should receive exactly 1 "new-dev" event within 1 seconds

  @edge @regression @P1
  Scenario: The avatar changes to another account's between the guard's read and the claim: the claim misses and is refused (AC-14)
    Given the legacy developer "alice" was stored before sign-in with avatar id 222
    And the avatar of the legacy developer "alice" changes to avatar id 111 just before my claim
    And I am signed in as "alice" with GitHub account 222
    And the server's log lines are being recorded
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the race should have happened
    And the response status should be 404
    And the response should be a JSON error with code "dev_not_found"
    And the developer "alice" should still be legacy
    And the developer "alice" should show login "alice"
    And the developer "alice" should have the avatar id 111
    And the log should have 1 guard warning, each naming the developer "alice", login "alice", account 222 and avatar id 111

  @edge @regression @P1
  Scenario: The avatar changes between the guard's read and the claim of a registration: displaced, fresh profile (AC-14)
    Given the legacy developer "alice" was stored before sign-in with avatar id 222
    And the avatar of the legacy developer "alice" changes to avatar id 111 just before my claim
    And I am signed in as "alice" with GitHub account 222
    And I remember every stored developer
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the race should have happened
    And the response should be a new developer of GitHub account 222 with login "alice", not "alice"
    And the developer "alice" should still be legacy
    And the developer "alice" should be displaced

  # --- AC-15: nothing sent by the client decides ownership ----------------------------------------

  @regression @P1
  Scenario: A body naming the guarded developer's avatar, id and login does not make it mine (AC-15)
    Given the legacy developer "alice" was stored before sign-in with avatar id 111
    And I am signed in as "alice" with GitHub account 222
    And I remember every stored developer
    When I send a signed-in PUT request to "/devs/me" carrying every ownership field of "alice"
    Then the response status should be 404
    And nothing should have been written to the database

  # --- AC-16: the operator CLI shows who can claim each legacy developer --------------------------

  @smoke @regression @P1
  Scenario: list shows claimable_by for guarded, unguarded and displaced developers, and writes nothing (AC-16)
    Given the legacy developer "anna" was stored before sign-in with avatar id 111
    And the legacy developer "bert" was stored before sign-in with avatar "https://example.com/avatar.png"
    And the legacy developer "cleo" was stored before sign-in without an avatar
    And the legacy developer "dora" was stored before sign-in with avatar id 444
    And the legacy developer "dora" has been displaced
    When the operator lists the legacy developers as JSON
    Then nothing should have been written to the database
    And the listing entry for "anna" should show:
      | claimable_by | 111 |
      | status       | legacy |
    And the listing entry for "bert" should show:
      | claimable_by | login |
    And the listing entry for "cleo" should show:
      | claimable_by | login |
    And the listing entry for "dora" should show:
      | claimable_by | none      |
      | status       | displaced |
      | avatar_id    | 444       |
    When the operator runs "list"
    Then the command should succeed
    And nothing should have been written to the database
    And the output should contain "claimable_by       111"
    And the output should contain "claimable_by       login"
    And the output should contain "claimable_by       none"
