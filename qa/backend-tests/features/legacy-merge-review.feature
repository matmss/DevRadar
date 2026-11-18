Feature: QA review of the legacy-devs operator tool (spec 04, option A)
  As QA reviewing the legacy-merge delivery
  I want the operator tool to print stored data safely, count what it lists correctly, and merge
  only into a profile a GitHub account can actually own
  So that an operator acting on its output cannot be misled or retire a profile into a dead end

  # Spec: dev/docs/04-legacy-merge-spec.md section 6. Tool: dev/backend/scripts/legacy-devs.js,
  # commands in scripts/lib/legacyDevs.js. Steps: legacy-merge.steps.js (DEV) and
  # legacy-merge-review.steps.js (this review). The legacy data below can only come from hand
  # edits or seed data (the pre-auth API always stored ObjectId _ids and GitHub's avatar URL),
  # which is exactly the data the spec says the operator must be able to inspect safely.
  #
  # QA-LM-1: the human-readable listing prints a dev's _id (and its owner profile's _id and its
  #   duplicates' _ids) with String(), not show(): a stored _id that is not an ObjectId reaches
  #   the operator's terminal raw (ESC sequences, BEL, bidi overrides). Every other field is
  #   escaped, and the delivery claims "control and bidi characters are escaped".
  # QA-LM-2: the summary counts avatar hosts in a plain object ({}), so a host named like an
  #   Object.prototype member breaks AC-3: "constructor" is counted as
  #   "function Object() { [native code] }1" and "__proto__" is dropped from the counts.
  # QA-LM-3: merge accepts as its target any dev whose github_id is not missing or null, even one
  #   that no GitHub account can ever own (0, -1, false, the string "501"; the github_id_unique
  #   partial index and requireAuth only know positive integers). With --force (which the help
  #   documents as overriding the avatar id check only) the legacy dev is deleted in favor of a
  #   profile nobody can sign in to. AC-19: "Given the target O has no github_id ... refused".

  Background:
    Given the developer database is empty

  @edge @regression @P2
  Scenario: QA-LM-1 The human-readable listing never prints raw control or bidi characters, whatever the stored _id
    Given a legacy developer with the raw _id "evil<ESC>[2J<ESC>]0;pwned<BEL><RLO>" and login "oddid" and avatar "https://avatars.githubusercontent.com/u/990?v=4"
    And a legacy developer with the raw _id "twin<ESC>[31m<RLO>" and login "oddtwin" and avatar "https://avatars.githubusercontent.com/u/990?v=4"
    And a developer with the raw _id "owner<ESC>[5m<RLO>" owned by GitHub account 991 as "owner991"
    And a legacy developer with the raw _id "ghost<BEL><RLO>" and login "oddghost" and avatar "https://avatars.githubusercontent.com/u/991?v=4"
    When the operator runs "list"
    Then the command should succeed
    And the output should mention "pwned"
    And the output should contain no raw control or bidi characters
    # Re-check of the fix (b823d2b): the JSON listing too, and it must still parse.
    When the operator lists the legacy developers as JSON
    Then the output should contain no raw control or bidi characters
    And the listing should contain 3 developers

  @edge @regression @P3
  Scenario: QA-LM-2 The avatar host counts are right for any host name
    Given the legacy developer "alice" was stored before sign-in with avatar "https://constructor/avatar.png"
    And the legacy developer "bob" was stored before sign-in with avatar "https://__proto__/avatar.png"
    And the legacy developer "carol" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    When the operator lists the legacy developers as JSON
    Then the listing summary should be:
      """
      {
        "total": 3,
        "by_status": { "legacy": 3, "displaced": 0 },
        "by_avatar_id": { "parsed": 1, "unparseable": 2, "none": 0 },
        "by_avatar_host": { "constructor": 1, "__proto__": 1, "avatars.githubusercontent.com": 1 }
      }
      """

  @edge @regression @P2
  Scenario Outline: QA-LM-3 Merge refuses a target that no GitHub account can own (github_id <raw>), even with --force
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And the legacy developer "alice" has been displaced
    And a developer "orphan" with the raw github_id <raw> already exists
    When the operator runs "merge <alice> --into <orphan> --force --apply"
    Then the command should be refused
    And nothing should have been written to the database
    And the developer "alice" should still be legacy

    Examples:
      | raw   |
      | 0     |
      | -1    |
      | 1.5   |
      | false |
      | "501" |

  # --- Guards for the delivery's safety claims ------------------------------------------------------
  # These pass on the delivery. Each one fails on a mutant that DEV's suite let through (QA mutation
  # run on 8fcfaca: restore without its legacy check or its index check, merge without the
  # "profile changed meanwhile" warning, assign without the profile check on a dry run, the command
  # line without autoIndex: false).

  @edge @regression @P1
  Scenario: QA-LM guard: restore never inserts a developer that has a github_id
    Given a recovery record file for a developer owned by GitHub account 777 as "intruder"
    When the operator runs "restore <file> --apply"
    Then the command should be refused with "the record has a github_id"
    And nothing should have been written to the database

  @edge @regression @P2
  Scenario: QA-LM guard: restore is refused without the unique login index
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And the legacy developer "alice" has been displaced
    And a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    When the operator runs "merge <alice> --into <alice2> --apply"
    And the operator saves the recovery record to a file
    And the developers collection has lost its unique login index
    And the operator runs "restore <file> --apply"
    Then the command should be refused with "the github_username_unique_ci index is missing"
    And nothing should have been written to the database

  @edge @regression @P1
  Scenario: QA-LM guard: the owner deletes their profile during a merge: the legacy record is still printed, with a warning
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And the legacy developer "alice" has been displaced
    And a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    And GitHub account 501 as "alice2" deletes their profile just before the operator's write
    When the operator runs "merge <alice> --into <alice2> --apply"
    Then the race should have happened
    And the command should succeed
    And the output should contain "Warning: profile <alice2> was deleted or changed owner meanwhile"
    And the recovery record should be the full deleted document of "alice"

  @regression @P2
  Scenario: QA-LM guard: assigning to an account that has a profile is refused already on a dry run (AC-10)
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    When the operator runs "assign <alice> --github-id 501"
    Then the command should be refused with "GitHub account 501 already has a profile (<alice2>)"
    And the output should not contain "Dry run"

  @integration @regression @P1
  Scenario: QA-LM guard: the command line never builds an index, so a missing github_id index still refuses assign
    Given the legacy developer "alice" was stored before sign-in with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And the developers collection has lost its unique github_id index
    When the operator runs the command line "assign <alice> --github-id 501 --apply"
    Then the command should exit with code 1
    And the output should contain "the github_id_unique index is missing"
    And nothing should have been written to the database
    And the github_id_unique index should still be missing

  @edge @regression @P1
  Scenario: QA-LM guard: stored control and bidi characters are escaped in every command's output, and the recovery record restores them (displaced, spec restore decision)
    Given a legacy developer "odd" whose login, name, bio and techs hold control and bidi characters, with avatar "https://avatars.githubusercontent.com/u/501?v=4"
    And a developer "alice2" owned by GitHub account 501 with avatar "https://avatars.githubusercontent.com/u/501?v=4" already exists
    When the operator runs "list"
    Then the command should succeed
    And the output should contain no raw control or bidi characters
    When the operator lists the legacy developers as JSON
    Then the output should contain no raw control or bidi characters
    When the operator runs "assign <odd> --github-id 777 --force"
    Then the command should succeed
    And the output should contain no raw control or bidi characters
    When the operator runs "merge <odd> --into <alice2> --apply"
    Then the command should succeed
    And the output should contain no raw control or bidi characters
    And the recovery record should be the full deleted document of "odd"
    When the operator saves the recovery record to a file
    And the operator runs "restore <file> --apply"
    Then the command should succeed
    And the output should contain no raw control or bidi characters
    And the developer "odd" should be as before the first operator command, but displaced
