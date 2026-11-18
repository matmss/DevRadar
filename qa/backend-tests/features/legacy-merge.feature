Feature: Operator tool for legacy and displaced profiles: list, assign, merge (spec 04, option A)
  As an operator
  I want to find profiles created before sign-in, give one back to its owner's GitHub account, or
  retire a displaced duplicate into the owner's current profile
  So that renamed owners get their profile back and ghost entries disappear, without any client
  being able to trigger it

  # Spec: dev/docs/04-legacy-merge-spec.md (option A; decisions in section 8: the owner's current
  # profile wins on merge). Tool: dev/backend/scripts/legacy-devs.js, commands in
  # scripts/lib/legacyDevs.js, avatar id parser in src/utils/githubAvatarId.js (unit tests:
  # unit/githubAvatarId.test.js, unit/legacyDevsCli.test.js).
  # "When the operator runs" calls the tool in-process with the exact command-line arguments,
  # against this suite's MongoDB; "the command line" starts the real script with MONGO_URI in its
  # environment. In commands, "<alice>" is the _id of the developer seeded or known as "alice".
  # "the legacy developer ... was stored before sign-in" seeds a dev without github_id the way the
  # pre-auth backend stored it (name = login, techs "Node.js", latitude -23.5505, longitude
  # -46.6333); "has been displaced" writes what devOwnership.displace() writes.
  # Exit codes: 0 done or dry run, 1 refused (nothing written), 2 invalid command line, 3 error.

  # --- list (AC-1 to AC-4, AC-6b) -----------------------------------------------------------------

  @smoke @regression @P1
  Scenario: The listing shows every legacy developer with the owner hint, and writes nothing
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And the legacy developer "alice" has been displaced
    And the legacy developer "bob" was stored before sign-in with avatar "https://avatars0.githubusercontent.com/u/777?v=3"
    And the legacy developer "carol" was stored before sign-in with avatar "https://example.com/avatar.png"
    And the legacy developer "dave" was stored before sign-in without an avatar
    And a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    When the operator lists the legacy developers as JSON
    Then nothing should have been written to the database
    And the listing should contain 4 developers
    And the listing should not include the developer "alice2"
    And the listing entry for "alice" should show:
      | login               | _stale_<alice>                                   |
      | status              | displaced                                        |
      | name                | null                                             |
      | coordinates         | {"latitude":-23.5505,"longitude":-46.6333}       |
      | techs               | ["Node.js"]                                      |
      | avatar_url          | https://avatars.githubusercontent.com/u/501?v=4 |
      | avatar_id           | 501                                              |
      | owner_has_profile   | true                                             |
      | owner_profile._id   | <alice2>                                         |
      | duplicate_avatar_id | false                                            |
    And the listing entry for "bob" should show:
      | login               | bob         |
      | status              | legacy      |
      | name                | bob         |
      | avatar_id           | 777         |
      | owner_has_profile   | false       |
      | owner_profile       | null        |
      | duplicate_avatar_id | false       |
    And the listing entry for "carol" should show:
      | avatar_id           | unparseable |
      | owner_has_profile   | false       |
    And the listing entry for "dave" should show:
      | avatar_url          | null        |
      | avatar_id           | none        |
    And the listing summary should be:
      """
      {
        "total": 4,
        "by_status": { "legacy": 3, "displaced": 1 },
        "by_avatar_id": { "parsed": 2, "unparseable": 1, "none": 1 },
        "by_avatar_host": { "avatars.githubusercontent.com": 1, "avatars0.githubusercontent.com": 1, "example.com": 1 }
      }
      """

  @regression @P1
  Scenario: The human-readable listing shows the same facts and suggests the merge
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And the legacy developer "alice" has been displaced
    And a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    When the operator runs "list"
    Then the command should succeed
    And nothing should have been written to the database
    And the output should contain "status             displaced"
    And the output should contain "avatar id          501"
    And the output should contain "owner_has_profile  yes: <alice2> (login alice2) -> merge <alice> --into <alice2>"
    And the output should contain "by status:      legacy 0, displaced 1"
    And the output should contain "by avatar host: avatars.githubusercontent.com 1"

  @regression @P2
  Scenario: Without legacy developers the listing says so
    Given a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    When the operator runs "list"
    Then the command should succeed
    And the output should contain "No legacy developers"
    And nothing should have been written to the database

  # AC-6b: an owned dev's avatar is never evidence: it neither "owns" the id nor duplicates it.
  @edge @regression @P1
  Scenario: A developer with a github_id is never listed, and its avatar is never used as evidence
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/777?v=4"
    And a developer "mallory" owned by GitHub account 888 with avatar "https://avatars.githubusercontent.com/u/777?v=4" already exists
    When the operator lists the legacy developers as JSON
    Then the listing should contain 1 developer
    And the listing entry for "alice" should show:
      | avatar_id           | 777   |
      | owner_has_profile   | false |
      | duplicate_avatar_id | false |
    When the operator runs "assign <alice> --from-avatar --apply"
    Then the command should succeed
    And the developer "alice" should belong to GitHub account 777

  # --- assign (AC-7 to AC-15) ---------------------------------------------------------------------

  @smoke @regression @P1
  Scenario: Assign is a dry run unless --apply
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    When the operator runs "assign <alice> --github-id 501"
    Then the command should succeed
    And nothing should have been written to the database
    And the output should contain "Assign legacy developer <alice> to GitHub account 501"
    And the output should contain "set github_id = 501"
    And the output should contain "Dry run: nothing was written"

  @smoke @regression @P1
  Scenario Outline: Assign with --apply sets the github_id and keeps everything else (<kind>)
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And <displacement>
    When the operator runs "assign <alice> --github-id 501 --apply"
    Then the command should succeed
    And the developer "alice" should belong to GitHub account 501
    And the developer "alice" should be exactly as before the command except github_id 501
    And the output should contain "before: "
    And the output should contain "after:  "
    And the output should contain "No live event was sent"

    Examples:
      | kind      | displacement                                     |
      | legacy    | the developer database is not otherwise touched  |
      | displaced | the legacy developer "alice" has been displaced  |

  @smoke @regression @P1
  Scenario: The owner gets their displaced profile back at their next sign-in (AC-9)
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And a developer "bob" owned by GitHub account 502 already exists with techs "Go"
    # Account 501 renamed itself "alice2" without signing in; 502 (who has a profile) took "alice".
    And I signed in through GitHub as "alice" with GitHub account 502
    And the developer "alice" should be displaced
    When the operator runs "assign <alice> --from-avatar --apply"
    Then the command should succeed
    When I signed in through GitHub as "alice2" with GitHub account 501
    And I request my profile
    Then the response status should be 200
    And the response should be the developer "alice"
    And the response should have techs "Node.js" at latitude -23.5505 and longitude -46.6333
    And the registered developer should be "alice2"
    And the developer of GitHub account 501 should not be marked stale
    And exactly 1 developer should belong to GitHub account 501
    And the database should contain exactly 2 developers

  @regression @P1
  Scenario: Assigning to an account that already has a profile is refused and points to merge (AC-10)
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    When the operator runs "assign <alice> --github-id 501 --apply"
    Then the command should be refused with "GitHub account 501 already has a profile (<alice2>)"
    And the output should contain "merge <alice> --into <alice2>"
    And nothing should have been written to the database

  @regression @P1
  Scenario: A developer that already has a github_id cannot be assigned (AC-11)
    Given a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    When the operator runs "assign <alice2> --github-id 777 --force --apply"
    Then the command should be refused with "already belongs to GitHub account 501"
    And nothing should have been written to the database

  @regression @P1
  Scenario Outline: The avatar id guards assign unless --force (AC-12): <case>
    Given the legacy developer "alice" was stored before sign-in <avatar>
    When the operator runs "assign <alice> --github-id 222 --apply"
    Then the command should be refused with "<refusal>"
    And nothing should have been written to the database
    When the operator runs "assign <alice> --github-id 222 --force --apply"
    Then the command should succeed
    And the output should contain "FORCED"
    And the output should contain "Applied (FORCED)"
    And the developer "alice" should belong to GitHub account 222

    Examples:
      | case                 | avatar                                                              | refusal                    |
      | another account's id | with avatar "https://avatars.githubusercontent.com/u/111?v=4"       | avatar id does not match   |
      | unparseable avatar   | with avatar "https://secure.gravatar.com/avatar/0cc175b9c0f1b6a831c3" | no avatar evidence         |
      | no avatar            | without an avatar                                                   | no avatar evidence         |

  @regression @P1
  Scenario Outline: --from-avatar refuses without avatar evidence (AC-13): <case>
    Given the legacy developer "alice" was stored before sign-in <avatar>
    When the operator runs "assign <alice> --from-avatar --apply"
    Then the command should be refused with "no avatar evidence"
    And nothing should have been written to the database

    Examples:
      | case        | avatar                                                           |
      | unparseable | with avatar "https://avatars.githubusercontent.com/in/123?v=4"   |
      | none        | without an avatar                                                |

  @regression @P2
  Scenario: --force does not combine with --from-avatar
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    When the operator runs "assign <alice> --from-avatar --force --apply"
    Then the command should be rejected as invalid with "--force only applies with --github-id"
    And nothing should have been written to the database

  # AC-14: the API changes the dev between the tool's read and its conditional write.
  @edge @regression @P1
  Scenario Outline: Assign loses a race to the API: changed since read, nothing written (<change>)
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And <setup>
    And GitHub account 502 as "alice" <change> just before the operator's write
    When the operator runs "assign <alice> --github-id 501 --apply"
    Then the race should have happened
    And the command should be refused with "changed since it was read (<reason>)"
    And exactly 0 developers should belong to GitHub account 501

    Examples:
      | change                | setup                                                                                         | reason                                  |
      | updates their profile | the developer database is not otherwise touched                                               | it now belongs to GitHub account 502    |
      | signs in              | a developer "zed" owned by GitHub account 502 with avatar "https://example.com/z.png" already exists | its login changed to _stale_<alice> |
      | deletes their profile | the developer database is not otherwise touched                                               | it was deleted                          |

  @edge @regression @P1
  Scenario: The owner registers between the tool's check and its write: the github_id index refuses it (AC-14)
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And GitHub account 501 as "alice2" registers just before the operator's write
    When the operator runs "assign <alice> --github-id 501 --apply"
    Then the race should have happened
    And the command should be refused with "GitHub account 501 already has a profile"
    And the output should contain "merge <alice> --into"
    And the developer "alice" should still be legacy
    And exactly 1 developer should belong to GitHub account 501

  @edge @regression @P1
  Scenario: Two operators assigning the same developer at once: exactly one wins
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    When two operators run "assign <alice> --github-id 501 --apply" and "assign <alice> --github-id 777 --force --apply" at the same time
    Then exactly one of the two commands should succeed and the other be refused
    And the output should contain "Refused, nothing was written"

  @edge @regression @P1
  Scenario: Without the github_id unique index assign is refused (it could not detect a concurrent registration)
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And the developers collection has lost its unique github_id index
    When the operator runs "assign <alice> --github-id 501 --apply"
    Then the command should be refused with "the github_id_unique index is missing"
    And nothing should have been written to the database

  @regression @P1
  Scenario Outline: Invalid ids are refused before anything is read or written (AC-15): <case>
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    When the operator runs "<command>"
    Then the command should exit with code <code>
    And the output should contain "<message>"
    And nothing should have been written to the database

    Examples:
      | case                   | command                                                     | code | message                                    |
      | zero                   | assign <alice> --github-id 0 --apply                        | 2    | --github-id must be a GitHub account id    |
      | negative               | assign <alice> --github-id -5 --apply                       | 2    | --github-id needs a value                  |
      | not a number           | assign <alice> --github-id abc --apply                      | 2    | --github-id must be a GitHub account id    |
      | fraction               | assign <alice> --github-id 1.5 --apply                      | 2    | --github-id must be a GitHub account id    |
      | leading zero           | assign <alice> --github-id 0501 --apply                     | 2    | --github-id must be a GitHub account id    |
      | above 2^53             | assign <alice> --github-id 9007199254740992 --apply         | 2    | --github-id must be a GitHub account id    |
      | missing id             | assign <alice> --apply                                      | 2    | exactly one of --github-id                       |
      | both ids               | assign <alice> --github-id 501 --from-avatar --apply        | 2    | exactly one of --github-id                       |
      | malformed _id          | assign not-an-id --github-id 501 --apply                    | 2    | must be a developer _id                    |
      | unknown _id            | assign 0123456789abcdef01234567 --github-id 501 --apply     | 1    | no developer has _id 0123456789abcdef01234567 |
      | unknown option         | assign <alice> --github-id 501 --yes                        | 2    | Unknown option for assign                  |
      | option given twice     | assign <alice> --github-id 501 --github-id 502 --apply      | 2    | --github-id was given twice                |
      | unknown command        | adopt <alice> --apply                                       | 2    | Unknown command                            |

  # --- merge (AC-16 to AC-20) ---------------------------------------------------------------------

  @smoke @regression @P1
  Scenario: Merge is a dry run unless --apply
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And the legacy developer "alice" has been displaced
    And a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    When the operator runs "merge <alice> --into <alice2>"
    Then the command should succeed
    And nothing should have been written to the database
    And the output should contain "Merge legacy developer <alice> into <alice2> (GitHub account 501, login alice2)"
    And the output should contain "Dry run: nothing was written"

  @smoke @regression @P1
  Scenario: Merge deletes the displaced developer, keeps the owner's profile byte for byte, and prints the deleted document (AC-17)
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And the legacy developer "alice" has been displaced
    And a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    When the operator runs "merge <alice> --into <alice2> --apply"
    Then the command should succeed
    And the developer "alice" should no longer exist
    And the developer "alice2" should be exactly as before the command
    And the recovery record should be the full deleted document of "alice"
    And the output should contain "No live event was sent"
    Given I am signed in as "alice2" with GitHub account 501
    When I request the list of all developers
    Then the response should not include the developer "alice"
    And the response should include the developer "alice2"
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "Node.js,Go"
    Then the response should not include the developer "alice"
    And the response should include the developer "alice2"

  @regression @P1
  # restore puts a merged dev back, always DISPLACED (login "_stale_<_id>", stale flag, a name that
  # was only the login cleared): a restored dev can never be claimed by login, only assigned.
  Scenario: A merged developer is restored from its recovery record as a displaced developer
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And the legacy developer "alice" has been displaced
    And a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    When the operator runs "merge <alice> --into <alice2> --apply"
    And the operator saves the recovery record to a file
    And the operator runs "restore <file>"
    Then the command should succeed
    And nothing should have been written to the database
    And the output should contain "Restore developer <alice> as displaced"
    When the operator runs "restore <file> --apply"
    Then the command should succeed
    And the developer "alice" should be as before the first operator command, but displaced
    When the operator runs "restore <file> --apply"
    Then the command should be refused with "already exists"

  @edge @regression @P1
  Scenario: A restored legacy developer that still showed a login comes back displaced and cannot be claimed by that login
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    When the operator runs "merge <alice> --into <alice2> --apply"
    And the operator saves the recovery record to a file
    And the operator runs "restore <file> --apply"
    Then the command should succeed
    And the output should contain "original login alice"
    And the developer "alice" should be displaced
    And the developer "alice" should be as before the first operator command, but displaced
    Given I am signed in as "alice" with GitHub account 503
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 404
    And the developer "alice" should still be legacy
    And the developer "alice" should be displaced
    When the operator runs "assign <alice> --github-id 501 --force --apply"
    Then the command should be refused with "GitHub account 501 already has a profile"

  @edge @regression @P2
  Scenario: A recovery record whose login was taken meanwhile is restored displaced, without touching the new holder
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    When the operator runs "merge <alice> --into <alice2> --apply"
    And the operator saves the recovery record to a file
    And a developer "Alice" owned by GitHub account 502 with avatar "https://example.com/a.png" already exists
    And the operator runs "restore <file> --apply"
    Then the command should succeed
    And the developer "Alice" should be exactly as before the command
    And the developer "alice" should be displaced

  @edge @regression @P1
  Scenario Outline: restore refuses a record that is not a developer as merge prints it (<case>)
    Given a recovery record file for a legacy developer whose <field> is '<value>'
    When the operator runs "restore <file> --apply"
    Then the command should be refused with "<refusal>"
    And nothing should have been written to the database

    Examples:
      | case                  | field                   | value                                             | refusal                                         |
      | techs not an array    | techs                   | "Go"                                              | techs must be an array of strings               |
      | a non-string tech     | techs                   | ["Go", {"$numberInt": "1"}]                       | techs must be an array of strings               |
      | an unknown field      | is_admin                | true                                              | unknown field(s) is_admin                       |
      | a login read later    | github_username_seen_at | {"$date": {"$numberLong": "32503680000000"}}      | github_username_seen_at is in the future        |
      | a seen_at string      | github_username_seen_at | "2020-01-01"                                      | github_username_seen_at must be a date          |
      | no login              | github_username         | null                                              | github_username must be a non-empty string      |
      | a numeric name        | name                    | {"$numberInt": "5"}                               | name must be a string or null                   |
      | a stale flag string   | github_username_stale   | "yes"                                             | github_username_stale must be a boolean         |
      | not a Point           | location                | {"type": "Polygon", "coordinates": [1, 2]}         | location must be a GeoJSON Point                |
      | coordinates too far   | location                | {"type": "Point", "coordinates": [{"$numberDouble": "200"}, {"$numberDouble": "0"}]} | location coordinates are out of range |
      | a github_id           | github_id               | {"$numberInt": "777"}                             | the record has a github_id                      |

  @integration @regression @P2
  Scenario: restore checks its file before connecting to the database
    When the operator runs the command line "restore /nonexistent/devradar-record.json --apply" with MONGO_URI "mongodb://127.0.0.1:1/devradar?serverSelectionTimeoutMS=60000"
    Then the command should exit with code 2
    And the output should contain "Cannot read the recovery file"
    And the output should not contain "MongoDB:"
    And the output should not contain "Failed"

  @regression @P3
  Scenario: The listing shows techs that are not an array as what they are
    Given the legacy developer "odd" was stored before sign-in with techs stored as the string "Node.js"
    When the operator lists the legacy developers as JSON
    Then the listing entry for "odd" should show:
      | techs | (not an array: string) |
    When the operator runs "list"
    Then the output should contain "techs              (not an array: string)"

  # AC-18: the conditional delete only removes the dev as it was read.
  @edge @regression @P1
  Scenario Outline: Merge loses a race to the API: nothing is deleted (<change>)
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    And <setup>
    And GitHub account 502 as "alice" <change> just before the operator's write
    When the operator runs "merge <alice> --into <alice2> --apply"
    Then the race should have happened
    And the command should be refused with "changed since it was read (<reason>)"
    And the developer "alice2" should be exactly as before the command
    And <outcome>

    Examples:
      | change                | setup                                                                                              | reason                                | outcome                                              |
      | updates their profile | the developer database is not otherwise touched                                                    | it now belongs to GitHub account 502  | the developer "alice" should belong to GitHub account 502 |
      | signs in              | a developer "zed" owned by GitHub account 502 with avatar "https://example.com/z.png" already exists | its login changed to _stale_<alice> | the developer "alice" should be displaced           |
      | deletes their profile | the developer database is not otherwise touched                                                    | it was deleted                        | the developer "alice" should no longer exist         |

  @regression @P1
  Scenario Outline: Merge refuses a wrong pair (AC-19): <case>
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And the legacy developer "bob" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    When the operator runs "<command>"
    Then the command should be refused with "<refusal>"
    And nothing should have been written to the database

    Examples:
      | case                     | command                                         | refusal                                         |
      | target is legacy         | merge <alice> --into <bob> --force --apply      | has no github_id                                |
      | source has a github_id   | merge <alice2> --into <alice> --force --apply   | belongs to GitHub account 501                   |
      | same developer           | merge <alice> --into <alice> --force --apply    | cannot be merged into itself                    |
      | unknown target           | merge <alice> --into 0123456789abcdef01234567 --apply | no developer has _id 0123456789abcdef01234567 |

  @regression @P1
  Scenario Outline: The avatar id guards merge unless --force (AC-20): <case>
    Given the legacy developer "alice" was stored before sign-in <avatar>
    And a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    When the operator runs "merge <alice> --into <alice2> --apply"
    Then the command should be refused with "<refusal>"
    And nothing should have been written to the database
    When the operator runs "merge <alice> --into <alice2> --force --apply"
    Then the command should succeed
    And the output should contain "Applied (FORCED)"
    And the developer "alice" should no longer exist
    And the developer "alice2" should be exactly as before the command

    Examples:
      | case                 | avatar                                                        | refusal                  |
      | another account's id | with avatar "https://avatars.githubusercontent.com/u/111?v=4" | avatar id does not match |
      | unparseable avatar   | with avatar "https://example.com/avatar.png"                  | no avatar evidence       |
      | no avatar            | without an avatar                                             | no avatar evidence       |

  # --- Duplicates (AC-21) -------------------------------------------------------------------------

  @smoke @regression @P1
  Scenario: Two legacy developers with the same avatar id: flagged, --from-avatar refuses, assign one then merge the other
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And the legacy developer "alice-old" was stored before sign-in with avatar "https://avatars1.githubusercontent.com/u/501?v=3"
    When the operator lists the legacy developers as JSON
    Then the listing entry for "alice" should show:
      | duplicate_avatar_id | true            |
      | duplicate_of        | ["<alice-old>"] |
      | owner_has_profile   | false           |
    And the listing entry for "alice-old" should show:
      | duplicate_avatar_id | true            |
      | duplicate_of        | ["<alice>"]     |
    When the operator runs "assign <alice> --from-avatar --apply"
    Then the command should be refused with "other legacy developers have the same avatar id 501 (<alice-old>)"
    And nothing should have been written to the database
    When the operator runs "assign <alice-old> --from-avatar --apply"
    Then the command should be refused with "other legacy developers have the same avatar id 501 (<alice>)"
    When the operator runs "assign <alice> --github-id 501 --apply"
    Then the command should succeed
    When the operator lists the legacy developers as JSON
    Then the listing should contain 1 developer
    And the listing entry for "alice-old" should show:
      | owner_has_profile   | true     |
      | owner_profile._id   | <alice>  |
      | duplicate_avatar_id | false    |
    When the operator runs "merge <alice-old> --into <alice> --apply"
    Then the command should succeed
    And the developer "alice-old" should no longer exist
    And the developer "alice" should be exactly as before the command

  # --- Live events (AC-22) ------------------------------------------------------------------------

  @integration @regression @P1
  Scenario: The tool sends no live event; the help says clients see changes on their next search
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And the legacy developer "bob" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/502?v=4"
    And a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    And a signed-in client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "Node.js,Go"
    When the operator runs "merge <alice> --into <alice2> --apply"
    Then the command should succeed
    When the operator runs "assign <bob> --from-avatar --apply"
    Then the command should succeed
    And client "watcher" should receive exactly 0 "dev-deleted" events within 1 seconds
    And client "watcher" should receive exactly 0 "dev-updated" events within 1 seconds
    And client "watcher" should receive exactly 0 "new-dev" events within 1 seconds
    When the operator runs "help"
    Then the command should succeed
    And the output should contain "No Socket.io event is ever sent: connected clients see changes on their next search, reload or"

  # --- Security (AC-24, AC-25) --------------------------------------------------------------------

  @smoke @regression @P1
  Scenario: No request or handshake, whatever it carries, attributes, merges or deletes a legacy developer (AC-24)
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And the legacy developer "alice" has been displaced
    And I am signed in as "alice2" with GitHub account 501
    And I remember every stored developer
    When I send a signed-in GET request to "/devs/me" carrying every ownership field of "alice"
    Then the response status should be 404
    When I send a signed-in PUT request to "/devs/me" carrying every ownership field of "alice"
    Then the response status should be 404
    When I send a signed-in DELETE request to "/devs/me" carrying every ownership field of "alice"
    Then the response status should be 404
    When a signed-in client connects via WebSocket carrying every ownership field of "alice"
    And I send a signed-in GET request to "/devs" carrying every ownership field of "alice"
    Then the response status should be 200
    When I send a signed-in POST request to "/devs" carrying every ownership field of "alice"
    Then the response status should be 200
    And the developer "alice" should be exactly as before the command
    And the developer "alice" should still be legacy
    And the database should contain exactly 2 developers
    And the API should have no route for operating on legacy developers

  @integration @regression @P1
  Scenario: The command line reads MONGO_URI from the environment and names the database before writing (AC-25, AC-27)
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And the legacy developer "alice" has been displaced
    And a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    When the operator runs the command line "merge <alice> --into <alice2> --apply"
    Then the command should succeed
    And the output should name the database before anything else
    And the output should name the database before the line starting "Applied"
    And the developer "alice" should no longer exist
    And the developer "alice2" should be exactly as before the command

  @integration @regression @P1
  Scenario: The command line takes no connection string as an option
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    When the operator runs the command line "list --mongo-uri=mongodb://operator:hunter2@db.example.com/devradar"
    Then the command should exit with code 2
    And the output should contain "Unknown option for list"
    And the output should not contain "hunter2"
    And the output should not contain "db.example.com"
    And nothing should have been written to the database

  @integration @regression @P1
  Scenario: The command line never prints the credentials in MONGO_URI, even when it cannot sign in
    When the operator runs the command line "list" with MONGO_URI "mongodb://devradar-operator:S3cr3t-Pa55@127.0.0.1:<mongo-port>/devradar?authSource=admin&tlsCertificateKeyFilePassword=k3y-Pa55"
    Then the command should exit with code 3
    And the output should contain "MongoDB: mongodb://127.0.0.1:"
    And the output should contain "Failed: "
    And the output should not contain "S3cr3t-Pa55"
    And the output should not contain "devradar-operator"
    And the output should not contain "k3y-Pa55"
