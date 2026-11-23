Feature: QA review of 503 profile_busy (retry exhaustion)
  As the QA engineer reviewing "retry exhaustion 500 -> 503"
  I want the paths the delivery's scenarios do not reach pinned down
  So that "busy, try again" is only said when a retry can succeed, and giving up leaves nothing
  locked and my own profile unchanged and unannounced (displacements of older holders done in
  earlier rounds stay, and were pushed)

  # Delivery scenarios: features/profile-busy.feature. Exhaustion is forced the same way (every
  # conditional claim or displacement write misses) with the steps of profile-busy.steps.js.

  Background:
    Given the developer database is empty

  # --- Giving up releases every queue key ------------------------------------------------------

  @edge @regression @P2
  Scenario Outline: After a 503 profile_busy on <method> <path>, nothing stays queued and my next write succeeds
    Given the legacy developer "alice" was stored before sign-in without an avatar
    And every claim of a legacy developer misses
    And I am signed in as "alice" with GitHub account 222
    When <action>
    Then the response should be 503 profile_busy, retry after 1 second
    And no write should be queued for any login
    When claims of legacy developers stop missing
    And I update my profile with techs "Rust", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the developer of GitHub account 222 should have techs "Rust"
    And no write should be queued for any login

    Examples:
      | method | path     | action                                                                                |
      | POST   | /devs    | I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333" |
      | PUT    | /devs/me | I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"     |
      | DELETE | /devs/me | I delete my profile                                                                   |

  @edge @regression @P2
  Scenario: After a 503 profile_busy that held the login holder's key too, the holder's account can still write
    Given a developer "alice" owned by GitHub account 111 with avatar id 111 and an older login state
    And a developer "alice-old" owned by GitHub account 222 with avatar id 222 and an older login state
    And every displacement of a developer misses
    And I am signed in as "alice" with GitHub account 222
    When I update my profile with techs "Rust", latitude "-23.5505" and longitude "-46.6333"
    Then the response should be 503 profile_busy, retry after 1 second
    And no write should be queued for any login
    When displacements of developers stop missing
    And I am signed in as "alice" with GitHub account 111
    And I update my profile with techs "Elixir", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the developer of GitHub account 111 should have techs "Elixir"
    And no write should be queued for any login

  @edge @regression @P2
  Scenario: Many concurrent writes of one account that all give up are each answered 503 and leave the queue empty
    Given the legacy developer "alice" was stored before sign-in without an avatar
    And every claim of a legacy developer misses
    And I am signed in as "alice" with GitHub account 222
    When I send 6 profile updates at once with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then every one of those updates should be answered 503 profile_busy with Retry-After 1
    And no write should be queued for any login
    And the developer "alice" should still be legacy

  # --- Giving up announces nothing -------------------------------------------------------------

  @edge @regression @P2
  Scenario Outline: A <method> <path> that gives up pushes no live event
    Given the legacy developer "alice" was stored before sign-in without an avatar
    And a signed-in client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "Go,Node.js"
    And every claim of a legacy developer misses
    And I am signed in as "alice" with GitHub account 222
    When <action>
    Then the response should be 503 profile_busy, retry after 1 second
    And client "watcher" should receive no "new-dev", "dev-updated" or "dev-deleted" event within 1 second

    Examples:
      | method | path     | action                                                                                |
      | POST   | /devs    | I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333" |
      | PUT    | /devs/me | I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"     |
      | DELETE | /devs/me | I delete my profile                                                                   |

  # --- Retry-After only on profile_busy ----------------------------------------------------------

  @edge @regression @P2
  Scenario: An unexpected server error is still 500 internal_error, without Retry-After
    Given I am signed in as "alice" with GitHub account 222
    And the database fails when listing developers
    When I request the list of all developers
    Then the response status should be 500
    And the response should be a JSON error with code "internal_error"
    And the response should have no Retry-After header

  @edge @regression @P2
  Scenario: A write that does not give up carries no Retry-After
    Given I am signed in as "alice" with GitHub account 222
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the response should have no Retry-After header

  # --- "Try again" only when a retry can succeed ------------------------------------------------

  # QA-PB-1: a write that can never succeed is not contention. The claim and displacement filters
  # use the dev as Mongoose read it (`_id: sameLogin._id`, `github_id: null`), and Mongoose reads a
  # hand-edited non-ObjectId _id as undefined and a github_id that is no number as undefined/null.
  # The filter then never matches the stored document: every attempt misses for the same reason,
  # gives up with ProfileBusyError, and every retry will too. Before this change that was a 500
  # logged as an error with a stack (an operator could see it); now it is a 503 "try again" with
  # Retry-After: 1 and a warn line that names no developer. Hand-edited data only (the same class as
  # QA-CG-1/QA-CG-3), but the client is told to retry something that cannot work.
  @edge @regression @P2
  Scenario Outline: A legacy developer stored with <hand edit> is never answered "busy, try again" forever (QA-PB-1)
    Given the legacy developer "alice" was stored before sign-in with <hand edit>
    And I am signed in as "alice" with GitHub account 222
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    And I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333" again after 1 second
    Then the response should not be 503 profile_busy
    And exactly 1 developer should belong to GitHub account 222

    Examples:
      | hand edit                                                 |
      | the string _id "legacy-alice-1" and avatar id 222         |
      | the string _id "legacy-alice-1" and no avatar             |
      | the string _id "legacy-alice-1" and avatar id 111         |
      | the hand-edited github_id "not-a-number"                  |
      | the hand-edited github_id ""                              |

  # --- Re-check of the QA-PB-1 fix (f3962e1): stored values, driver writes ----------------------

  # QA-PB-3: isLegacy() now reads the STORED github_id and calls anything that is not a positive
  # safe JS number legacy. A dev whose github_id names account 222 in a BSON type the driver does
  # not hand back as a number (a numeric string "222", a Decimal128) used to be read by Mongoose as
  # 222, i.e. owned: nobody else could claim it. Now it is legacy, so whichever account holds its
  # login on GitHub claims it by login, unless an avatar guards it. Expected: the stored id is
  # ownership evidence; account 333 displaces it and registers fresh (rule 3), it never takes it
  # over. Int32/Long/Double are controls (the driver reads them as the number 222).
  @edge @regression @P2
  Scenario Outline: A developer whose github_id names account 222 as a BSON <type> is never taken over by another account with its login (QA-PB-3)
    Given the developer "alice" was stored with the github_id 222 as a BSON <type> and no avatar
    And I am signed in as "alice" with GitHub account 333
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the developer "alice" should not belong to GitHub account 333

    Examples:
      | type       |
      | String     |
      | Decimal128 |
      | Int32      |
      | Long       |
      | Double     |

  # missesForGood re-reads after a missed write: a document changed and changed back (ABA) is as
  # read again, but the filter matches it, so that is a retry, never the "cannot be claimed" 500.
  @edge @regression @P2
  Scenario: A legacy developer changed and changed back around my claim is still claimed, not a 500
    Given the legacy developer "alice" was stored before sign-in without an avatar
    And the legacy developer "alice" is changed and changed back around my next claim
    And I am signed in as "alice" with GitHub account 222
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the race should have happened
    And the response status should be 200
    And the developer "alice" should belong to GitHub account 222

  # QA-PB-7 (accepted by the coordinator): the driver path (writeStored for a hand-edited _id)
  # neither casts nor validates the update. The same request must store the same document shape
  # as the model path, except that the model path gives location (PointSchema) an ObjectId _id and
  # the driver path does not (nothing reads it; the step ignores it). Every other field type
  # (Int32 github_id, Date, Double coordinates, string techs) must agree.
  @edge @regression @P3
  Scenario: A claim and update of a hand-edited string _id store the same fields and BSON types as for an ObjectId (QA-PB-7)
    Given the legacy developer "alice" was stored before sign-in without an avatar
    And the legacy developer "bob" was stored before sign-in with the string _id "legacy-bob-1" and no avatar
    And I am signed in as "alice" with GitHub account 222
    And I update my profile with techs "Go, Rust", latitude "-23.5505" and longitude "-46.6333"
    And I am signed in as "bob" with GitHub account 333
    And I update my profile with techs "Go, Rust", latitude "-23.5505" and longitude "-46.6333"
    Then the stored developers of GitHub accounts 222 and 333 should have the same fields with the same BSON types
    And the stored developers of GitHub accounts 222 and 333 should have the same techs and location
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "Rust"
    Then the response should contain exactly 2 developers

  # QA-PB-4: since the fix GET /devs/me, PUT, dev-updated and dev-deleted carry a hand-edited
  # string _id, but GET /devs (Dev.find) and GET /search still drop it (Mongoose cannot cast it),
  # so the list a client merges events into has an entry without _id.
  @edge @regression @P3
  Scenario: GET /devs lists a developer with a hand-edited string _id under that _id (QA-PB-4)
    Given the legacy developer "alice" was stored before sign-in with the string _id "legacy-alice-1" and no avatar
    And I am signed in as "carol" with GitHub account 444
    When I request the list of all developers
    Then the response status should be 200
    And the response should include the developer "alice"

  # QA-PB-5: the operator CLI (scripts/lib/legacyDevs.js isLegacy, `github_id: null` query) still
  # calls only a missing or null github_id legacy, while the API now also claims "", "not-a-number"
  # and 0. `list` then hides a dev that the API lets its login's holder claim.
  @edge @regression @P3
  Scenario Outline: The operator tool lists a developer with the hand-edited github_id <github_id> that the API treats as legacy (QA-PB-5)
    Given the legacy developer "alice" was stored before sign-in with the hand-edited github_id <github_id>
    When the operator lists the legacy developers as JSON
    And GitHub account 222 as "alice" updates their profile
    Then the update should agree with the listing's claimable_by for "alice" and GitHub account 222

    Examples:
      | github_id      |
      | "not-a-number" |
      | ""             |

  # QA-PB-6: the placeholder is `_stale_<stored _id>`, and logins are unique case-insensitively.
  # Two hand-edited string _ids that differ only in letter case get placeholders the index calls
  # equal, so the second displacement fails with a duplicate key: a 500 on every try.
  @edge @regression @P3
  Scenario: Two guarded developers whose string _ids differ only in letter case can both be displaced (QA-PB-6)
    Given the legacy developer "alice" was stored before sign-in with the string _id "Legacy-1" and avatar id 111
    And the legacy developer "bob" was stored before sign-in with the string _id "legacy-1" and avatar id 111
    And I am signed in as "alice" with GitHub account 222
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    Given I am signed in as "bob" with GitHub account 333
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And exactly 1 developer should belong to GitHub account 333

  # --- Final re-check (8b08167): utils/githubId.js storedGithubId, the one ownership rule --------

  # Every owned form is that account's: its owner reads, updates (normalized to Int32 for a string
  # or Decimal128) and nobody else takes it over by login.
  @edge @regression @P2
  Scenario Outline: A developer stored with the github_id <type> "<value>" is account 222's: mine to update, never another login holder's
    Given the developer "alice" was stored with the github_id <type> "<value>" and no avatar
    And I am signed in as "alice" with GitHub account 222
    When I request my profile
    Then the response status should be 200
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And exactly 1 developer should belong to GitHub account 222
    And the developer "alice" should store github_id 222 as a BSON <stored as>

    Examples:
      | type       | value    | stored as |
      | String     | 222      | Int32     |
      | Decimal128 | 2.22E+2  | Int32     |
      | Decimal128 | 222.000  | Int32     |
      | Long       | 222      | Long      |
      | Double     | 222      | Double    |

  @edge @regression @P2
  Scenario Outline: A developer stored with the github_id <type> "<value>" is never taken over by another account holding its login
    Given the developer "alice" was stored with the github_id <type> "<value>" and no avatar
    And I am signed in as "alice" with GitHub account 333
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the developer "alice" should not belong to GitHub account 333
    And exactly 1 developer should belong to GitHub account 333

    Examples:
      | type       | value    |
      | Decimal128 | 2.22E+2  |
      | Decimal128 | 222.000  |
      | String     | 222      |

  # Forms that name no account are legacy: claimed by the login's holder, the claim guard first.
  @edge @regression @P2
  Scenario Outline: A developer stored with the github_id <type> "<value>" names no account: claimed by my login, unless its avatar names another account
    Given the developer "alice" was stored with the github_id <type> "<value>" and <avatar>
    And I am signed in as "alice" with GitHub account 222
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be <status>
    And exactly <count> developers should belong to GitHub account 222

    Examples:
      | type       | value     | avatar        | status | count |
      | String     | 0222      | no avatar     | 200    | 1     |
      | String     | 222 x     | no avatar     | 200    | 1     |
      | Number     | -5        | no avatar     | 200    | 1     |
      | Number     | 1.5       | no avatar     | 200    | 1     |
      | Number     | Infinity  | no avatar     | 200    | 1     |
      | Boolean    | true      | no avatar     | 200    | 1     |
      | Document   | 222       | no avatar     | 200    | 1     |
      | Decimal128 | 222.5     | no avatar     | 200    | 1     |
      | String     | 0222      | avatar id 111 | 404    | 0     |
      | Decimal128 | 0         | avatar id 111 | 404    | 0     |
      | Number     | -5        | avatar id 222 | 200    | 1     |

  # The operator CLI reads the same rule: an owned form is not listed, a legacy form is listed and
  # its claimable_by agrees with what the API does.
  @edge @regression @P3
  Scenario Outline: The operator tool does not list a developer stored with the owned github_id <type> "<value>"
    Given the developer "alice" was stored with the github_id <type> "<value>" and no avatar
    When the operator lists the legacy developers as JSON
    Then the listing should not include the developer "alice"

    Examples:
      | type       | value   |
      | String     | 222     |
      | Decimal128 | 2.22E+2 |
      | Long       | 222     |

  @edge @regression @P3
  Scenario Outline: The operator tool's claimable_by agrees with the API for the legacy github_id <type> "<value>" and <avatar>
    Given the developer "alice" was stored with the github_id <type> "<value>" and <avatar>
    When the operator lists the legacy developers as JSON
    And GitHub account 222 as "alice" updates their profile
    Then the update should agree with the listing's claimable_by for "alice" and GitHub account 222

    Examples:
      | type     | value | avatar        |
      | String   | 0222  | no avatar     |
      | Number   | -5    | no avatar     |
      | Boolean  | true  | no avatar     |
      | String   | 0222  | avatar id 111 |
      | Number   | 0     | avatar id 222 |

  # GET /devs and GET /search now read lean and hydrate (QA-PB-4): for normal developers the
  # answer must be byte for byte what Dev.find() serialized (field order, location _id, __v, no
  # github_username_seen_at), and $near keeps its distance order.
  @edge @regression @P2
  Scenario: GET /devs and GET /search answer normal developers byte for byte as before
    Given the legacy developer "legacy" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/9?v=4"
    And I am signed in as "alice" with GitHub account 222
    And I submit a registration with techs "Go, Rust", latitude "-23.5505" and longitude "-46.6333"
    And I am signed in as "bob" with GitHub account 333
    And I submit a registration with techs "Rust", latitude "-23.56" and longitude "-46.64"
    When I request the list of all developers
    Then the response body should be byte-identical to Dev.find() serialized
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "Rust,Node.js"
    Then the response body should be byte-identical to a Mongoose search at latitude -23.5505, longitude -46.6333 for techs "Rust,Node.js"

  # QA-PB-6 fix: a string _id with control characters gets a printable, hex-encoded placeholder.
  @edge @regression @P3
  Scenario: A guarded developer whose string _id holds control characters is displaced to a printable placeholder
    Given the legacy developer "alice" was stored before sign-in with a 100-character string _id holding control characters and avatar id 111
    And I am signed in as "alice" with GitHub account 222
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the developer "alice" should have been displaced to "_stale_s_" plus the hex of its stored _id, printable ASCII only
    And exactly 1 developer should belong to GitHub account 222
