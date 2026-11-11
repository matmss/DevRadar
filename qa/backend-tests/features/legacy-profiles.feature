Feature: Profiles belong to a GitHub account, and legacy profiles are claimed by their owner (US-8, Q10)
  As a developer signed in with GitHub
  I want the profile I created before sign-in existed to stay mine, and nobody else to get it
  So that a renamed or re-registered GitHub login can never take over my profile

  # Spec: dev/docs/03-auth-spec.md, US-8, Q5 and Q10 (auth slice 6). A profile belongs to a GitHub
  # account by its numeric id (`github_id`, GitHub GET /user `id`, the session token's subject),
  # not by its login, which can be renamed and later registered by someone else. Rules
  # (dev/backend/src/services/devOwnership.js), for every /devs/me route and POST /devs:
  #   1. a dev with my github_id is mine; my writes and sign-ins refresh its login
  #   2. else a dev WITHOUT a github_id (missing or null) whose login matches mine (any letter
  #      case) is a legacy profile: my first write claims it atomically; GET /devs/me reads it
  #      without claiming
  #   3. else a dev with ANOTHER github_id and my login is never mine: GET/PUT/DELETE 404,
  #      POST 409 github_username_conflict
  #   4. else nothing is mine: 404, and POST creates a dev with my github_id
  # Logins stay unique. A sign-in is GitHub's fresh answer: another dev still showing my login
  # with an older state is DISPLACED (login "_stale_<_id>", github_username_stale true, nothing
  # else changes, dev-updated pushed); its owner's next sign-in gives it their current login back.
  # Logins are ordered by when GitHub was read (the token's login_read_at), never set back.
  # No migration: deploying never rewrites a document; legacy profiles stay visible.
  #
  # "a developer already exists with github_username" seeds a legacy profile (no github_id) at
  # latitude -23.5505, longitude -46.6333, name = username, bio "seed fixture". "I am signed in as"
  # uses the fixture GitHub id for the login (support/github-mock.js githubIdFor: the same id in
  # any letter case); "with GitHub account N" picks the account explicitly.

  Background:
    Given the developer database is empty

  # --- US-8: the legacy owner claims on their first write --------------------------------------

  @smoke @P1
  Scenario Outline: A legacy owner claims their profile on the first update, in any letter case
    Given a developer already exists with github_username "<legacy username>" and techs "Node.js"
    And I remember the stored developer "<legacy username>"
    And I am signed in as "<github login>"
    When I update my profile with techs "Go", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 200
    And the response should be the remembered developer
    And the registered developer should be "<github login>"
    And the stored developer "<github login>" should belong to the GitHub account of "<github login>"
    And the stored developer "<github login>" should have techs "Go"
    And the database should contain exactly 1 developer

    Examples:
      | legacy username | github login |
      | alice           | alice        |
      | ALICE           | alice        |
      | alice           | Alice        |

  @smoke @P1
  Scenario Outline: A legacy owner claims their profile on the first registration, and its data is kept
    Given a developer already exists with github_username "<legacy username>" and techs "Node.js"
    And I remember the stored developer "<legacy username>"
    And I am signed in as "<github login>"
    When I submit a registration with techs "ReactJS", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 200
    And the response should be the remembered developer
    And the developer's techs should be "Node.js"
    And the stored developer "<github login>" should belong to the GitHub account of "<github login>"
    And the stored developer "<github login>" should be at latitude "-23.5505" and longitude "-46.6333"
    And the stored developer "<github login>" should have name "<legacy username>"
    And the stored developer "<github login>" should have bio "seed fixture"
    And the database should contain exactly 1 developer

    Examples:
      | legacy username | github login |
      | gaearon         | gaearon      |
      | GAEARON         | gaearon      |
      | gaearon         | GaeARon      |

  @regression @P1
  Scenario Outline: A legacy owner can delete their profile, in any letter case
    Given a developer already exists with github_username "<legacy username>" and techs "Node.js"
    And I am signed in as "<github login>"
    When I delete my profile
    Then the response status should be 204
    And no developer should be persisted

    Examples:
      | legacy username | github login |
      | alice           | alice        |
      | Alice           | aLICE        |

  @integration @regression @P1
  Scenario: Deleting a claimed legacy profile is pushed with its new GitHub id
    Given a developer already exists with github_username "gaearon" and techs "ReactJS"
    And I am signed in as "gaearon"
    And a signed-in client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    When I delete my profile
    Then the response status should be 204
    And client "watcher" should receive a "dev-deleted" event within 2 seconds
    And the "dev-deleted" event for "watcher" should only carry the _id, github_id and github_username "gaearon"

  # A read is not a write: it finds the legacy profile but claims nothing.
  @regression @P1
  Scenario: Reading my legacy profile finds it without claiming or changing it
    Given a developer already exists with github_username "ALICE" and techs "Node.js"
    And I remember the stored developer "ALICE"
    And I am signed in as "alice"
    When I request my profile
    Then the response status should be 200
    And the response should be the remembered developer
    And the registered developer should be "ALICE"
    And the stored developer "ALICE" should be unchanged

  @smoke @P1
  Scenario: Legacy profiles remain visible in the authenticated list and search
    Given a developer already exists with github_username "alice" and techs "ReactJS"
    And a developer already exists with github_username "bob" and techs "ReactJS"
    And I remember the stored developer "alice"
    And I am signed in as "carol"
    When I request the list of all developers
    Then the response status should be 200
    And the response should contain 2 developers
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    Then the response status should be 200
    And the response should contain exactly 2 developers
    And the response should include "alice"
    And the response should include "bob"
    And the stored developer "alice" should be unchanged

  # --- US-8: no data migration ------------------------------------------------------------------

  @smoke @P1
  Scenario: Deploying onto a database with legacy profiles rewrites no document
    Given the database holds these legacy developers, stored before sign-in existed and without the new indexes:
      | github_username | techs           | latitude | longitude |
      | alice           | ReactJS         | -23.5505 | -46.6333  |
      | Bob             | Node.js,ReactJS | -23.5510 | -46.6330  |
      | carol-2         | Elixir          | -22.9068 | -43.1729  |
    When the backend builds its indexes at startup
    Then every legacy document should be exactly as it was stored
    And the developers collection should have a unique index on github_id that leaves out documents without one
    And the developers collection should still have the unique case-insensitive index on github_username
    Given I am signed in as "dave"
    When I request the list of all developers
    Then the response should contain 3 developers
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    Then the response should contain exactly 2 developers
    Given I am signed in as "bob"
    When I request my profile
    Then the response status should be 200
    And the registered developer should be "Bob"
    And every legacy document should be exactly as it was stored

  # --- Concurrent claims ------------------------------------------------------------------------
  # Two different GitHub accounts present the same login: the current holder, and an account that
  # renamed away but still has a valid token (up to 7 days) from before. Exactly one claims.

  @edge @regression @P1
  Scenario: Two accounts updating a legacy profile with the same login at once: one claims it, no 500
    Given a developer already exists with github_username "alice" and techs "Node.js"
    When GitHub accounts 501 as "alice" and 502 as "ALICE" update their profile at the same time with techs "Go"
    Then one concurrent request should be answered 200 and the other 404 with code "dev_not_found"
    And the stored developer "alice" should belong to the GitHub account that was answered 200
    And the database should contain exactly 1 developer

  # The newest GitHub read wins whatever the timing (QA-AUTH6-4): 502 read "alice" now, 501's token
  # is two days old. Either 502 claims first (501 then gets 409), or 501 claims first and 502's
  # registration displaces 501's profile and creates its own (both 200).
  @edge @regression @P1
  Scenario: Two accounts registering over a legacy profile with the same login at once: the newest GitHub read ends with it, no 500
    Given a developer already exists with github_username "alice" and techs "Node.js"
    When GitHub account 501 as "alice" with a session from 2 days ago and GitHub account 502 as "Alice" register at the same time with techs "Go"
    Then every concurrent request should be answered 200 or 409 with code "github_username_conflict"
    And the developer showing github_username "alice" should belong to GitHub account 502
    And no developer should show github_username "alice" for GitHub account 501

  # Deterministic version: the other account's claim lands between my read and my claim (that
  # claim records a newer GitHub read than mine).
  @edge @regression @P1
  Scenario Outline: A claim that loses the race leaves the profile to the winner
    Given a developer already exists with github_username "alice" and techs "Node.js"
    And I remember the stored developer "alice"
    And GitHub account 501 claims the legacy developer "alice" just before my claim
    And I am signed in as "alice" with GitHub account 502
    When I <action>
    Then the response status should be <status>
    And the response should be a JSON error with code "<code>"
    And the stored developer "alice" should belong to GitHub account 501
    And the stored developer "alice" should have techs "Node.js"
    And the database should contain exactly 1 developer

    Examples:
      | action                                                                    | status | code                     |
      | update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333" | 404    | dev_not_found            |
      | delete my profile                                                         | 404    | dev_not_found            |
      | submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333" | 409    | github_username_conflict |

  # --- Q10: a renamed login never hands over its profile -----------------------------------------
  # Account 501 registered as "alice", then renamed itself to "alice2" on GitHub without signing in
  # to DevRadar again. GitHub then let account 502 take the login "alice".

  @smoke @P1
  Scenario: The new holder of a renamed login signs in: the previous owner's profile is displaced, never handed over
    Given a developer "alice" owned by GitHub account 501 already exists with techs "Node.js"
    And I remember the stored developer "alice"
    And I signed in through GitHub as "alice" with GitHub account 502
    Then the remembered developer should be displaced, with everything else unchanged
    When I request my profile
    Then the response status should be 404
    And the response should be a JSON error with code "dev_not_found"
    When I update my profile with techs "Go", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 404
    And the response should be a JSON error with code "dev_not_found"
    When I delete my profile
    Then the response status should be 404
    And the response should be a JSON error with code "dev_not_found"
    And the remembered developer should be displaced, with everything else unchanged
    When I submit a registration with techs "Go", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 200
    And the stored developer "alice" should belong to GitHub account 502
    And the database should contain exactly 2 developers
    When I request the list of all developers
    Then the remembered developer should be listed as displaced, with no GitHub login

  # The newest GitHub read wins on registration too (QA-AUTH6-4), even without a displacing
  # sign-in (here a test-only token, read now; the seeded profile records no read).
  @smoke @P1
  Scenario: The new holder of a renamed login registers with a newer session: the previous profile is displaced
    Given a developer "alice" owned by GitHub account 501 already exists with techs "Node.js"
    And I remember the stored developer "alice"
    And I am signed in as "alice" with GitHub account 502
    When I submit a registration with techs "Go", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 200
    And the stored developer "alice" should belong to GitHub account 502
    And the remembered developer should be displaced, with everything else unchanged
    And the database should contain exactly 2 developers

  # The reverse: a session that read GitHub BEFORE the holder's login was confirmed is the stale
  # one. It never takes the login: 409 on registration, and an update keeps its own stored login.
  @smoke @P1
  Scenario: An older session never takes a login confirmed by a newer GitHub read
    Given a developer "alice" owned by GitHub account 502 already exists with techs "Go"
    And I signed in through GitHub as "alice" with GitHub account 502
    And I remember the stored developer "alice"
    And I am signed in as "alice" with GitHub account 501, in a session that began 2 days ago
    When I submit a registration with techs "Node.js", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 409
    And the response should be a JSON error with code "github_username_conflict"
    And the response should be an error with details
    And the response should not mention "seed fixture"
    And the stored developer "alice" should be unchanged
    And the database should contain exactly 1 developer

  @edge @regression @P1
  Scenario: An older session's update keeps its own login when a newer read gave the login to someone else
    Given a developer "alice2" owned by GitHub account 501 already exists with techs "Node.js"
    And a developer "alice" owned by GitHub account 502 already exists with techs "Go"
    And I signed in through GitHub as "alice" with GitHub account 502
    And I remember the stored developer "alice"
    And I am signed in as "alice" with GitHub account 501, in a session that began 2 days ago
    When I update my profile with techs "Elixir", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the developer of GitHub account 501 should show github_username "alice2"
    And the developer of GitHub account 501 should have techs "Elixir"
    And the stored developer "alice" should be unchanged

  # A write with a newer read than the holder's state displaces it (QA-AUTH6-4), here an update
  # whose session read "carol" after the holder's profile last confirmed it.
  @edge @regression @P1
  Scenario: An update with a newer GitHub read displaces a profile still showing the session's login
    Given a developer "alice" owned by GitHub account 501 already exists with techs "Node.js"
    And a developer "carol" owned by GitHub account 503 already exists with techs "Go"
    And I remember the stored developer "carol"
    And I am signed in as "carol" with GitHub account 501
    When I update my profile with techs "Elixir", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the registered developer should be "carol"
    And the developer of GitHub account 501 should show github_username "carol"
    And the remembered developer should be displaced, with everything else unchanged

  @smoke @P1
  Scenario: The previous owner signs in under the new login: the profile is still theirs, and the old login is freed
    Given a developer "alice" owned by GitHub account 501 already exists with techs "Node.js"
    And I remember the stored developer "alice"
    When I signed in through GitHub as "alice2" with GitHub account 501
    Then the stored developer "alice2" should belong to GitHub account 501
    And no developer with github_username "alice" should be persisted
    When I request my profile
    Then the response status should be 200
    And the response should be the remembered developer
    And the registered developer should be "alice2"
    And the developer's techs should be "Node.js"
    Given I am signed in as "alice" with GitHub account 502
    When I submit a registration with techs "Go", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 200
    And the registered developer should be "alice"
    And the stored developer "alice" should belong to GitHub account 502
    And the database should contain exactly 2 developers

  @regression @P1
  Scenario: The previous owner's next update also refreshes the login
    Given a developer "alice" owned by GitHub account 501 already exists with techs "Node.js"
    And I remember the stored developer "alice"
    And I am signed in as "alice2" with GitHub account 501
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the response should be the remembered developer
    And the registered developer should be "alice2"
    And the stored developer "alice2" should belong to GitHub account 501
    And the stored developer "alice2" should have techs "Go"

  # A token from before the rename is still valid for up to 7 days. It can still edit its own
  # account's profile, but never set the login back (that would block the login's new holder).
  @edge @regression @P1
  Scenario: An older session of the same account does not set a refreshed login back
    Given a developer "alice" owned by GitHub account 501 already exists with techs "Node.js"
    And I signed in through GitHub as "alice2" with GitHub account 501
    And I am signed in as "alice" with GitHub account 501, in a session that began 2 days ago
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the registered developer should be "alice2"
    And the stored developer "alice2" should have techs "Go"
    And no developer with github_username "alice" should be persisted

  @integration @regression @P2
  Scenario: A login refreshed at sign-in is pushed as dev-updated
    Given a developer "alice" owned by GitHub account 501 already exists with techs "ReactJS"
    And a signed-in client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    When I signed in through GitHub as "alice2" with GitHub account 501
    Then client "watcher" should receive a "dev-updated" event within 2 seconds
    And the event payload for "watcher" should contain github_username "alice2"

  # --- Displacement (QA-AUTH6-1: logins stay unique, a fresh GitHub read wins) ---------------------

  @integration @regression @P1
  Scenario: A displaced profile is pushed as dev-updated without its old login
    Given a developer "alice" owned by GitHub account 501 already exists with techs "ReactJS"
    And a signed-in client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    When I signed in through GitHub as "alice" with GitHub account 502
    Then client "watcher" should receive a "dev-updated" event within 2 seconds
    And the "dev-updated" event for "watcher" should show a displaced developer with no GitHub login
    And client "watcher" should receive exactly 0 "dev-deleted" events within 1 seconds

  @regression @P1
  Scenario: A displaced profile gets its owner's current login back at the owner's next sign-in
    Given a developer "alice" owned by GitHub account 501 already exists with techs "Node.js"
    And I remember the stored developer "alice"
    And I signed in through GitHub as "alice" with GitHub account 502
    # The seeded name was the login "alice": cleared by the displacement (it is 502's login now).
    And the developer of GitHub account 501 should have no name
    When I signed in through GitHub as "alice2" with GitHub account 501
    Then the developer of GitHub account 501 should show github_username "alice2"
    And the developer of GitHub account 501 should not be marked stale
    And the developer of GitHub account 501 should have name "alice2"
    When I request my profile
    Then the response should be the remembered developer
    And the registered developer should be "alice2"

  # An old token of the displaced account (read before the displacement) cannot put the login back.
  @edge @regression @P1
  Scenario: An older session of a displaced account does not take the login back
    Given a developer "alice" owned by GitHub account 501 already exists with techs "Node.js"
    And I signed in through GitHub as "alice" with GitHub account 502
    And I am signed in as "alice" with GitHub account 501, in a session that began 1 days ago
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the developer of GitHub account 501 should be displaced
    And the developer of GitHub account 501 should have techs "Go"

  # Only a newer GitHub read displaces: here 502's sign-in read GitHub ("alice") before 501's
  # sign-in confirmed "alice" for 501, and redeemed its code after. 502's answer is the older one.
  @edge @regression @P1
  Scenario: A sign-in whose GitHub read is older than the holder's confirmed login displaces nothing
    Given a developer "alice" owned by GitHub account 501 already exists with techs "Node.js"
    And another device of GitHub account 502 reached the sign-in callback as "alice" and holds its one-time code
    When 1 seconds pass
    And I signed in through GitHub as "alice" with GitHub account 501
    And the other device redeems its one-time code
    Then the other device's sign-in should succeed
    And the developer of GitHub account 501 should show github_username "alice"
    And the developer of GitHub account 501 should not be marked stale

  # A legacy profile is displaced only by an account that already owns a dev (otherwise it is that
  # account's to claim). It stays listed and is never deleted; it can no longer be claimed by login.
  @regression @P1
  Scenario: A legacy profile showing a login whose holder already owns a profile is displaced, not deleted
    Given a developer "alice" owned by GitHub account 501 already exists with techs "Node.js"
    And a developer already exists with github_username "alice2" and techs "Go"
    And I remember the stored developer "alice2"
    When I signed in through GitHub as "alice2" with GitHub account 501
    Then the remembered developer should be displaced, with everything else unchanged
    And the developer of GitHub account 501 should show github_username "alice2"
    And the database should contain exactly 2 developers
    When I request the list of all developers
    Then the remembered developer should be listed as displaced, with no GitHub login

  @regression @P1
  Scenario: A sign-in does not displace a legacy profile its account can still claim
    Given a developer already exists with github_username "alice" and techs "Node.js"
    And I remember the stored developer "alice"
    When I signed in through GitHub as "alice" with GitHub account 501
    Then the stored developer "alice" should be unchanged
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the response should be the remembered developer
    And the stored developer "alice" should belong to GitHub account 501

  # Logins moved around a cycle: 501 "ann" -> "ben", 502 "ben" -> "cat", 503 "cat" -> "ann".
  @edge @regression @P1
  Scenario Outline: Three accounts that rotated their logins converge once each signs in, in any order
    Given a developer "ann" owned by GitHub account 501 already exists with techs "Node.js"
    And a developer "ben" owned by GitHub account 502 already exists with techs "Go"
    And a developer "cat" owned by GitHub account 503 already exists with techs "Elixir"
    When GitHub accounts sign in one after another in the order <order>, with 501 as "ben", 502 as "cat" and 503 as "ann"
    Then the developer of GitHub account 501 should show github_username "ben"
    And the developer of GitHub account 502 should show github_username "cat"
    And the developer of GitHub account 503 should show github_username "ann"
    And no developer should be marked stale
    And the database should contain exactly 3 developers

    Examples:
      | order       |
      | 501,502,503 |
      | 503,502,501 |
      | 502,501,503 |

  # Both sign-ins run at the same time: each one locks both accounts (sorted), so no deadlock.
  @edge @regression @P1
  Scenario: Two accounts that swapped logins sign in at the same time: both converge, nothing hangs
    Given a developer "alice" owned by GitHub account 501 already exists with techs "Node.js"
    And a developer "carol" owned by GitHub account 503 already exists with techs "Go"
    When GitHub accounts 501 as "carol" and 503 as "alice" complete their sign-ins at the same time
    Then both concurrent sign-ins should succeed
    And no write should be queued for any login
    When I signed in through GitHub as "carol" with GitHub account 501
    And I signed in through GitHub as "alice" with GitHub account 503
    Then the developer of GitHub account 501 should show github_username "carol"
    And the developer of GitHub account 503 should show github_username "alice"
    And no developer should be marked stale

  # --- QA note 2: a legacy profile stored with github_id null -------------------------------------

  @edge @regression @P1
  Scenario Outline: A legacy profile stored with a null github_id is claimed like one without the field
    Given a developer already exists with github_username "alice", a null github_id and techs "Node.js"
    And I remember the stored developer "alice"
    And I am signed in as "alice" with GitHub account 501
    When I <action>
    Then the response status should be <status>
    And the database should contain exactly <count> developer

    Examples:
      | action                                                                              | status | count |
      | update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"     | 200    | 1     |
      | submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333" | 200    | 1     |
      | delete my profile                                                                   | 204    | 0     |

  @regression @P2
  Scenario: Two legacy profiles stored with a null github_id coexist under the unique index
    Given a developer already exists with github_username "alice", a null github_id and techs "Node.js"
    And a developer already exists with github_username "bob", a null github_id and techs "Go"
    Then the database should contain exactly 2 developers

  @regression @P2
  Scenario: The API never exposes when a login was last refreshed
    Given I am signed in as "gaearon"
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the response should carry github_id of "gaearon" and no internal field
    When I request my profile
    Then the response should carry github_id of "gaearon" and no internal field

  # --- Q10: the session identity is the GitHub id -------------------------------------------------

  @smoke @P1
  Scenario Outline: A session token without a GitHub id (issued before auth slice 6) is rejected as invalid
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I have a <kind> session token
    When I call GET "<path>"
    Then the response status should be 401
    And the response should be an auth error with code "token_invalid"
    And the response should not reveal any developer

    Examples:
      # id-less: subject = login, no id, no login claim (how slices 1-5 signed tokens)
      | kind             | path      |
      | id-less          | /devs     |
      | id-less          | /devs/me  |
      | id-less          | /auth/me  |
      | login-less       | /devs     |
      | non-canonical-id | /devs/me  |
      | read-time-less   | /devs/me  |
      | read-after-issue | /auth/me  |

  @regression @P1
  Scenario: Writes with a token issued before auth slice 6 are rejected and change nothing
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I remember the stored developer "gaearon"
    And I have a id-less session token
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 401
    And the response should be an auth error with code "token_invalid"
    When I delete my profile
    Then the response status should be 401
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 401
    And the stored developer "gaearon" should be unchanged

  @smoke @P1
  Scenario: Sign-in issues a token whose subject is the GitHub id, and GET /auth/me returns it
    Given I signed in through GitHub as "gaearon"
    Then the session token's subject should be the GitHub id of "gaearon" and its login claim "gaearon"
    When I call GET /auth/me with the session token
    Then the response status should be 200
    And the signed-in user should have the name and avatar_url of "gaearon"'s GitHub profile

  @smoke @P1
  Scenario Outline: A GitHub user lookup without a valid account id fails the sign-in
    Given GitHub will sign in "gaearon" with id <id> for authorization code "code-without-id"
    And I start GitHub sign-in with redirect "http://localhost:3000/"
    When GitHub calls back with code "code-without-id" and the issued state
    Then I should be redirected to "http://localhost:3000/" with error "sign_in_failed" and reason "github_user_invalid"
    And no sign-in code should be issued

    Examples:
      | id                 |
      | <missing>          |
      | null               |
      | "810438"           |
      | 0                  |
      | -5                 |
      | 1.5                |
      | 9007199254740993   |
      | true               |
