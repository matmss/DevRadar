Feature: QA review of GitHub sign-in slice 6, backend (profiles owned by GitHub id, login refresh)
  As QA reviewing feat/auth-slice-6-dev
  I want a renamed GitHub account's profile to follow its new login, and an older session never to set it back
  So that a profile never shows (or links to) a login its account no longer holds, and the login's new holder can register

  # Spec: dev/docs/03-auth-spec.md Q10 and US-8 "A renamed login does not hand over a profile":
  #   "The login stays as display data, refreshed from GitHub on every sign-in"
  #   "When A signs in as alice2, Then the profile is still A's, now showing alice2, and B can
  #    register as alice"
  # dev/docs/00-architecture.md "Login refresh": a session that began earlier never changes the
  # login ("a 7-day-old token from before a rename cannot put the old login back and block its
  # new holder").
  #
  # QA-AUTH6-1: the login refresh (services/devOwnership.js refreshLogin) gives up whenever another
  #   dev holds the new login (duplicate key on github_username_unique_ci) and never retries. When
  #   that other dev's owner has ALSO signed in (a swap of logins), or the other dev is a legacy
  #   profile nobody can ever claim (its login's holder already owns a dev), it never resolves:
  #   the profile keeps showing a login GitHub now gives to someone else, and that person is
  #   answered 409 github_username_conflict forever.
  # QA-AUTH6-2: a claimed legacy profile has no github_username_seen_at (the claim does not set
  #   it, and refreshLogin only sets it when the login changes), so the old-session guard lets
  #   ANY older session of the account set the login back.
  # QA-AUTH6-3: the guard orders sessions by the token's iat, which is taken at POST /auth/token,
  #   but the login in the token was read from GitHub at the callback, up to 60 s earlier (the
  #   one-time code's lifetime). A sign-in that read GitHub before a rename but redeemed its code
  #   after a newer sign-in sets the old login back.

  Background:
    Given the developer database is empty

  # --- QA-AUTH6-1 ---------------------------------------------------------------------------------

  # Accounts 501 ("alice") and 503 ("carol") swapped logins on GitHub (through a temporary name).
  # Both then sign in. Each refresh is refused because the other dev still holds the login, in
  # either order, so neither profile ever shows its account's login again: 501's profile shows
  # "alice", which GitHub now gives to 503 (the web list and the mobile Profile screen link to
  # github.com/alice, i.e. to the other person).
  @regression @edge @P2 @QA-AUTH6-1
  Scenario: Two accounts that swapped logins both sign in: each profile shows its account's current login
    Given a developer "alice" owned by GitHub account 501 already exists with techs "Node.js"
    And a developer "carol" owned by GitHub account 503 already exists with techs "Go"
    When I signed in through GitHub as "carol" with GitHub account 501
    And I signed in through GitHub as "alice" with GitHub account 503
    And I signed in through GitHub as "carol" with GitHub account 501
    Then the developer of GitHub account 501 should show github_username "carol"
    And the developer of GitHub account 503 should show github_username "alice"

  # The spec's own scenario ("When A signs in as alice2, then ... B can register as alice"), with
  # one extra precondition: a legacy profile already shows "alice2" (registered before sign-in
  # existed, by the login's previous holder). Account 501 now holds "alice2" but already owns a
  # dev, so it never claims that legacy profile (rule 1 wins), nobody else can claim it, and 501's
  # refresh to "alice2" is refused every time: "alice" is never freed.
  @regression @edge @P2 @QA-AUTH6-1
  Scenario: The previous owner signs in under a new login that a legacy profile shows: the old login is still freed
    Given a developer "alice" owned by GitHub account 501 already exists with techs "Node.js"
    And a developer already exists with github_username "alice2" and techs "Go"
    When I signed in through GitHub as "alice2" with GitHub account 501
    And I am signed in as "alice" with GitHub account 502
    And I submit a registration with techs "Go", latitude "-22.9068" and longitude "-43.1729"
    Then the response status should be 200
    And the stored developer "alice" should belong to GitHub account 502
    And the developer of GitHub account 501 should show github_username "alice2"

  # --- QA-AUTH6-2 ---------------------------------------------------------------------------------

  # Account 501 was "alice" two days ago (that session's token is still valid on another device),
  # then became "alice2". It claims the legacy "alice2" profile with its new session (no rename,
  # so no github_username_seen_at is stored), then the old session saves.
  @regression @edge @P2 @QA-AUTH6-2
  Scenario: An older session does not set back the login of a claimed legacy profile
    Given a developer already exists with github_username "alice2" and techs "Node.js"
    And I signed in through GitHub as "alice2" with GitHub account 501
    When I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the stored developer "alice2" should belong to GitHub account 501
    Given I am signed in as "alice" with GitHub account 501, in a session that began 2 days ago
    When I update my profile with techs "Elixir", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the registered developer should be "alice2"
    And the developer of GitHub account 501 should show github_username "alice2"
    And no developer with github_username "alice" should be persisted

  # Same with a registration (POST /devs claims too).
  @regression @edge @P2 @QA-AUTH6-2
  Scenario: An older session's registration does not set back the login of a claimed legacy profile
    Given a developer already exists with github_username "alice2" and techs "Node.js"
    And I signed in through GitHub as "alice2" with GitHub account 501
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    Given I am signed in as "alice" with GitHub account 501, in a session that began 2 days ago
    When I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the developer of GitHub account 501 should show github_username "alice2"

  # --- QA-AUTH6-3 ---------------------------------------------------------------------------------

  # Two sign-ins of account 501, e.g. two devices. Device 1 reached the callback while the account
  # was still "alice" (GitHub GET /user answered "alice"); the account was then renamed, device 2
  # signed in as "alice2" and redeemed its code at once; device 1 redeemed its one-time code
  # 30 s later (still within its 60 s lifetime). Device 1's token is newer by iat, but its login is
  # the older one.
  @regression @edge @P3 @QA-AUTH6-3
  Scenario: A sign-in that read GitHub before a rename, redeemed after a newer sign-in, does not set the old login back
    Given a developer "alice" owned by GitHub account 501 already exists with techs "Node.js"
    And another device of GitHub account 501 reached the sign-in callback as "alice" and holds its one-time code
    When I signed in through GitHub as "alice2" with GitHub account 501
    Then the developer of GitHub account 501 should show github_username "alice2"
    When 30 seconds pass
    And the other device redeems its one-time code
    Then the other device's sign-in should succeed
    And the developer of GitHub account 501 should show github_username "alice2"
    And no developer with github_username "alice" should be persisted
