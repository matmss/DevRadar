Feature: Reading developers requires sign-in (US-2 applied to the reads, Q1)
  As the DevRadar API
  I want GET /devs and GET /search to answer only signed-in users
  So that nobody can browse developers' locations anonymously

  # Spec: dev/docs/03-auth-spec.md, Q1 and the access matrix (auth slice 4). Same requireAuth
  # middleware and 401 body as POST /devs and GET /auth/me: { error, code, details } with
  # code token_missing | token_expired | token_invalid, plus a WWW-Authenticate challenge.
  # The socket handshake is covered by realtime-auth.feature.

  Background:
    Given the developer database is empty
    And the following developers exist:
      | github_username | techs   | latitude | longitude |
      | near-match      | ReactJS | -23.5505 | -46.6333  |

  @smoke @P1
  Scenario Outline: Reading without a session token is rejected
    When I call GET "<path>"
    Then the response status should be 401
    And the response should be an auth error with code "token_missing"
    And the response should challenge for a Bearer token
    And the response should not reveal any developer

    Examples:
      | path                                                       |
      | /devs                                                      |
      | /search?latitude=-23.5505&longitude=-46.6333&techs=ReactJS |

  @edge @regression @P1
  Scenario Outline: Reading with an expired session token is rejected as expired
    Given I have a session token for "gaearon" that expired 1 hour ago
    When I call GET "<path>"
    Then the response status should be 401
    And the response should be an auth error with code "token_expired"
    And the response should not reveal any developer

    Examples:
      | path                                                       |
      | /devs                                                      |
      | /search?latitude=-23.5505&longitude=-46.6333&techs=ReactJS |

  @edge @regression @P1
  Scenario Outline: Reading with an invalid session token is rejected as invalid
    Given I have a <kind> session token
    When I call GET "<path>"
    Then the response status should be 401
    And the response should be an auth error with code "token_invalid"
    And the response should not reveal any developer

    Examples:
      # Kinds: see forgedSessionToken in features/support/session.js.
      | kind           | path                                                       |
      | tampered       | /devs                                                      |
      | tampered       | /search?latitude=-23.5505&longitude=-46.6333&techs=ReactJS |
      | foreign-signed | /devs                                                      |
      | foreign-signed | /search?latitude=-23.5505&longitude=-46.6333&techs=ReactJS |
      | alg-none       | /devs                                                      |
      | alg-none       | /search?latitude=-23.5505&longitude=-46.6333&techs=ReactJS |
      | malformed      | /devs                                                      |
      | malformed      | /search?latitude=-23.5505&longitude=-46.6333&techs=ReactJS |
      | profile-less   | /devs                                                      |
      | profile-less   | /search?latitude=-23.5505&longitude=-46.6333&techs=ReactJS |
      | forged-profile | /devs                                                      |
      | forged-profile | /search?latitude=-23.5505&longitude=-46.6333&techs=ReactJS |

  @edge @regression @P2
  Scenario: An expired token that was also tampered with is "invalid", not "expired"
    Given I have a session token for "gaearon" that expired 1 hour ago, signed with another secret
    When I call GET "/devs"
    Then the response status should be 401
    And the response should be an auth error with code "token_invalid"

  # Authentication comes first: an anonymous caller learns nothing from parameter validation.
  @edge @regression @P2
  Scenario: Search checks the session token before its parameters
    When I call GET "/search"
    Then the response status should be 401
    And the response should be an auth error with code "token_missing"

  # Tokens never go in URLs (they would end up in access logs): only the header counts.
  @edge @regression @P2
  Scenario Outline: A session token in the query string is not accepted
    Given I have a valid session token for "gaearon"
    When I call GET "<path>" with the session token in the query string
    Then the response status should be 401
    And the response should be an auth error with code "token_missing"

    Examples:
      | path                                                       |
      | /devs                                                      |
      | /search?latitude=-23.5505&longitude=-46.6333&techs=ReactJS |

  # The web app must be able to read the 401's code (expired vs invalid) cross-origin.
  @regression @P2
  Scenario: A 401 to the web app's origin still carries the CORS header
    When I request the list of all developers from origin "http://localhost:3000"
    Then the response status should be 401
    And the response should allow origin "http://localhost:3000"

  @smoke @P1
  Scenario: A signed-in developer can list and search developers
    Given I am signed in as "gaearon"
    When I call GET "/devs"
    Then the response status should be 200
    And the response should contain 1 developers
    When I call GET "/search?latitude=-23.5505&longitude=-46.6333&techs=ReactJS"
    Then the response status should be 200
    And the response should include "near-match"

  @regression @P1
  Scenario: A session from the real GitHub sign-in can read developers
    Given I signed in through GitHub as "alice"
    When I call GET "/devs"
    Then the response status should be 200
    And the response should contain 1 developers
