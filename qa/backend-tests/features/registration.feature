Feature: Developer registration as the signed-in GitHub user (US-3)
  As a developer signed in with GitHub
  I want to register my location and techs
  So that I become discoverable to nearby developers, and nobody can register as me

  # Spec: dev/docs/03-auth-spec.md, US-3, US-8 and Q9. POST /devs requires a session token. The
  # dev is the token's GitHub login; name, avatar_url and bio come from the profile captured at
  # sign-in (the token's `profile` claim, a snapshot as of sign-in). Registration makes no call
  # to GitHub's public users API: hooks.js records any call to api.github.com/users/* and fails
  # the scenario. "I am signed in as" is a test-only sign-in (registration.steps.js) that signs a
  # token with the test JWT_SECRET and the fixture profile (support/github-mock.js FIXTURES);
  # "I signed in through GitHub as" runs the real OAuth + PKCE flow against mocked GitHub.

  Background:
    Given the developer database is empty

  # --- Authentication required (US-2 applied to POST /devs) -----------------------------------

  @smoke @P1
  Scenario: Registering without a session token is rejected
    When I submit a registration with github_username "gaearon", techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 401
    And the response should be an auth error with code "token_missing"
    And the response should challenge for a Bearer token
    And no developer should be persisted

  @edge @regression @P1
  Scenario: Registering with an expired session token is rejected as expired
    Given I have a session token for "gaearon" that expired 1 hour ago
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 401
    And the response should be an auth error with code "token_expired"
    And no developer should be persisted

  @edge @regression @P1
  Scenario Outline: Registering with an invalid session token is rejected as invalid
    Given I have a <kind> session token
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 401
    And the response should be an auth error with code "token_invalid"
    And no developer should be persisted

    Examples:
      # profile-less: correctly signed but without the sign-in profile claim (slice 1 format)
      # forged-profile: correctly signed, but with a profile claim the backend never produces
      | kind           |
      | tampered       |
      | foreign-signed |
      | alg-none       |
      | malformed      |
      | profile-less   |
      | forged-profile |

  # --- Username from identity (Q9) ------------------------------------------------------------

  @smoke @P1
  Scenario: Register as the signed-in user with the profile captured at sign-in
    Given I am signed in as "gaearon"
    When I submit a registration with techs "ReactJS, Redux", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the registered developer should be "gaearon"
    And the response should include the name, avatar_url and bio of "gaearon"'s GitHub profile
    And the stored developer "gaearon" should have the name, avatar_url and bio of "gaearon"'s GitHub profile
    And the developer's techs should be "ReactJS,Redux"
    And the developer should be persisted with a GeoJSON location of type "Point"
    And no call should have been made to GitHub's public users API

  @smoke @P1
  Scenario: Sign in through GitHub, then register: the stored profile is the one GitHub returned at sign-in
    Given I signed in through GitHub as "gaearon"
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the registered developer should be "gaearon"
    And the stored developer "gaearon" should have the name, avatar_url and bio of "gaearon"'s GitHub profile
    And no call should have been made to GitHub's public users API

  @edge @regression @P1
  Scenario Outline: A github_username in the body is ignored
    Given I am signed in as "alice"
    When I submit a registration with github_username "<body username>", techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the registered developer should be "alice"
    And the stored developer "alice" should have the name, avatar_url and bio of "alice"'s GitHub profile
    And the database should contain exactly 1 developer
    And no call should have been made to GitHub's public users API

    Examples:
      | body username |
      | bob           |
      | gaearon       |
      |               |
      | ../orgs/x     |
      | -bad-name-    |

  @edge @regression @P1
  Scenario: A body github_username cannot take over someone else's profile
    Given a developer already exists with github_username "bob" and techs "Elixir"
    And I am signed in as "alice"
    When I submit a registration with github_username "bob", techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the registered developer should be "alice"
    And the database should contain exactly 2 developers
    And the stored developer "bob" should have techs "Elixir"

  # --- Existing developers and legacy profiles (US-8) -----------------------------------------

  @regression @P1
  Scenario: Registering again returns the existing profile unchanged
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    And I am signed in as "gaearon"
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And exactly 1 developer with github_username "gaearon" should exist in the database
    And the developer's techs should be "Node.js"

  @regression @P1
  Scenario Outline: A legacy profile created before sign-in is returned to its owner signing in with different letter case
    Given a developer already exists with github_username "<legacy username>" and techs "Node.js"
    And I signed in through GitHub as "<github login>"
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the registered developer should be "<legacy username>"
    And the database should contain exactly 1 developer
    And the developer's techs should be "Node.js"
    And no call should have been made to GitHub's public users API

    Examples:
      | legacy username | github login |
      | gaearon         | Gaearon      |
      | GAEARON         | gaearon      |

  # QA-AUTH2-1: the losing insert of a race is answered with the existing dev, not a 500.
  @edge @regression @P1
  Scenario: A registration that loses a race to the same user returns the winner
    Given I am signed in as "gaearon"
    And another request registers "gaearon" with techs "Elixir" just before my upsert
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the registered developer should be "gaearon"
    And the developer's techs should be "Elixir"
    And the database should contain exactly 1 developer

  # --- Sign-in profile handling ---------------------------------------------------------------

  @regression @P2
  Scenario: A GitHub profile with a null name falls back to the login
    Given I signed in through GitHub as "octo-null" whose GitHub name is "<null>"
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the developer's name should be "octo-null"
    And the stored developer "octo-null" should have name "octo-null"

  @edge @regression @P2
  Scenario: A long GitHub bio is truncated at sign-in
    Given I signed in through GitHub as "gaearon" whose GitHub bio is 5000 characters long
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the stored developer "gaearon" should have a bio of 160 characters

  @edge @regression @P2
  Scenario Outline: A GitHub avatar_url that is not a plain https URL is not stored
    Given I signed in through GitHub as "gaearon" whose GitHub avatar_url is "<avatar_url>"
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the stored developer "gaearon" should have avatar_url "<none>"

    Examples:
      | avatar_url                             |
      | javascript:alert(1)                    |
      | http://avatars.example.com/u/1         |
      | https://user:pass@avatars.example.com/ |
      | not a url                              |

  @edge @regression @P2
  Scenario: Control and bidi-override characters in the GitHub name are replaced
    Given I signed in through GitHub as "gaearon" whose GitHub name is "Dan\u0007 \u202eAbramov"
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the stored developer "gaearon" should have name "Dan   Abramov"

  # --- Validation unchanged (BUG-003 / BUG-005), minus the username -------------------------

  @regression @P2
  Scenario: Techs string parsing trims whitespace
    Given I am signed in as "gaearon"
    When I submit a registration with techs " ReactJS ,  Node.js,Redux ", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the developer's techs should be "ReactJS,Node.js,Redux"

  @regression @P2
  Scenario: Empty entries in the techs list are dropped
    Given I am signed in as "gaearon"
    When I submit a registration with techs "ReactJS,, ,Redux,", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the developer's techs should be "ReactJS,Redux"

  @edge @regression @P1
  Scenario Outline: Invalid registration input is rejected with 400
    Given I am signed in as "gaearon"
    When I submit a registration with techs "<techs>", latitude "<latitude>" and longitude "<longitude>"
    Then the response status should be 400
    And the response should be an error with details
    And no developer should be persisted

    Examples:
      | techs   | latitude     | longitude    |
      | ReactJS | not-a-number | -46.6333     |
      | ReactJS | -23.5505     | not-a-number |
      | ReactJS |              | -46.6333     |
      | ReactJS | 91           | -46.6333     |
      | ReactJS | 0x10         | -46.6333     |
      | ReactJS | -23.5505     | 1e1          |
      | ReactJS | -23.5505     | 181          |
      |         | -23.5505     | -46.6333     |
      | ,  ,    | -23.5505     | -46.6333     |

  @edge @regression @P2
  Scenario: The authentication check comes before validation
    When I submit a registration with techs "", latitude "not-a-number" and longitude "-46.6333"
    Then the response status should be 401
    And the response should be an auth error with code "token_missing"
