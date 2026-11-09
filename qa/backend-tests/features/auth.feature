Feature: GitHub sign-in and session tokens (US-1, US-2; BUG-006 auth part)
  As a developer using DevRadar
  I want to sign in with my GitHub account and get a DevRadar session token
  So that the API knows who I am without trusting a username I type

  # Spec: dev/docs/03-auth-spec.md. Slice 1: the auth endpoints exist, only GET /auth/me is
  # protected. GitHub's OAuth endpoints are mocked with nock (features/support/github-mock.js).
  # The backend runs with GITHUB_CLIENT_ID "test-client-id" and the default callback URL
  # (features/support/auth-config.js). Allowed redirects: the CORS origins + "devradar://".

  # --- US-1: Start the flow -----------------------------------------------------------------

  @smoke @P1
  Scenario: Starting sign-in redirects to GitHub with a state and no extra scope
    When I start GitHub sign-in with redirect "http://localhost:3000/"
    Then I should be redirected to GitHub's authorize page
    And the authorize URL should have client_id "test-client-id"
    And the authorize URL should have redirect_uri "http://localhost:3333/auth/github/callback"
    And the authorize URL should carry a random state
    And the authorize URL should not request any scope

  @regression @P1
  Scenario: Every sign-in attempt gets its own state
    When I start GitHub sign-in with redirect "http://localhost:3000/" twice
    Then the two states should be different

  @regression @P2
  Scenario: The mobile app scheme is an allowed redirect
    When I start GitHub sign-in with redirect "devradar://auth"
    Then I should be redirected to GitHub's authorize page

  @edge @regression @P1
  Scenario Outline: A redirect outside the allow-list is rejected
    When I start GitHub sign-in with redirect "<redirect>"
    Then the response status should be 400
    And the response should be an auth error with code "redirect_invalid"
    And I should not be redirected anywhere

    Examples:
      | redirect                              |
      | https://evil.example/                 |
      | http://localhost:3000.evil.example/   |
      | http://localhost:3000@evil.example/   |
      | https://localhost:3000/               |
      | javascript:alert(1)                   |
      | /relative/path                        |

  @edge @regression @P1
  Scenario: Starting sign-in without a redirect is rejected
    When I start GitHub sign-in without a redirect
    Then the response status should be 400
    And the response should be an auth error with code "redirect_invalid"

  # --- US-1: Successful callback ------------------------------------------------------------

  @smoke @P1
  Scenario: Signing in end to end issues a 7-day session token for my GitHub login
    Given GitHub will sign in "gaearon" for authorization code "good-code"
    When I start GitHub sign-in with redirect "http://localhost:3000/"
    And GitHub calls back with code "good-code" and the issued state
    Then I should be redirected to "http://localhost:3000/" with a one-time code
    And the redirect should not contain the session token or the GitHub access token
    When I exchange the one-time code for a session token
    Then the response status should be 200
    And the response should contain a Bearer session token for "gaearon" valid for 7 days
    And the response should not contain the GitHub access token
    And the backend should have called GitHub's token and user endpoints
    And no developer should be persisted
    When I call GET /auth/me with the session token
    Then the response status should be 200
    And the signed-in identity should be "gaearon"

  @regression @P2
  Scenario: The redirect keeps the client's own query parameters
    Given GitHub will sign in "gaearon" for authorization code "good-code"
    When I start GitHub sign-in with redirect "http://localhost:3000/welcome?tab=devs"
    And GitHub calls back with code "good-code" and the issued state
    Then I should be redirected to "http://localhost:3000/welcome?tab=devs" with a one-time code

  # --- US-1: State mismatch, missing, reused or expired -------------------------------------

  @edge @regression @P1
  Scenario: A callback without state is rejected
    When GitHub calls back with code "good-code" and no state
    Then the response status should be 400
    And the response should be an auth error with code "state_missing"
    And no sign-in code should be issued

  @edge @regression @P1
  Scenario: A callback with a state the backend never issued is rejected
    Given GitHub will sign in "gaearon" for authorization code "good-code"
    When I start GitHub sign-in with redirect "http://localhost:3000/"
    And GitHub calls back with code "good-code" and state "forged-state-value"
    Then the response status should be 400
    And the response should be an auth error with code "state_invalid"
    And no sign-in code should be issued

  @edge @regression @P1
  Scenario: A state cannot be used twice
    Given GitHub will sign in "gaearon" for authorization code "good-code"
    When I start GitHub sign-in with redirect "http://localhost:3000/"
    And GitHub calls back with code "good-code" and the issued state
    And GitHub calls back with code "good-code" and the issued state
    Then the response status should be 400
    And the response should be an auth error with code "state_invalid"
    And no sign-in code should be issued

  @edge @regression @P1
  Scenario: A state expires after 10 minutes
    Given GitHub will sign in "gaearon" for authorization code "good-code"
    When I start GitHub sign-in with redirect "http://localhost:3000/"
    And 601 seconds pass
    And GitHub calls back with code "good-code" and the issued state
    Then the response status should be 400
    And the response should be an auth error with code "state_invalid"
    And no sign-in code should be issued

  @edge @regression @P2
  Scenario: A callback with a valid state but no code is rejected
    When I start GitHub sign-in with redirect "http://localhost:3000/"
    And GitHub calls back with no code and the issued state
    Then the response status should be 400
    And the response should be an auth error with code "github_code_missing"
    And no sign-in code should be issued

  # --- US-1: User denies consent ------------------------------------------------------------

  @regression @P1
  Scenario: Denying consent sends the client a "sign-in cancelled" result
    When I start GitHub sign-in with redirect "http://localhost:3000/"
    And GitHub calls back with error "access_denied" and the issued state
    Then I should be redirected to "http://localhost:3000/" with error "sign_in_cancelled"
    And no sign-in code should be issued

  @edge @regression @P2
  Scenario: A consent denial without a valid state is still rejected
    When GitHub calls back with error "access_denied" and state "forged-state-value"
    Then the response status should be 400
    And the response should be an auth error with code "state_invalid"

  @edge @regression @P2
  Scenario: Any other GitHub callback error is reported as a GitHub failure
    When I start GitHub sign-in with redirect "http://localhost:3000/"
    And GitHub calls back with error "redirect_uri_mismatch" and the issued state
    Then the response status should be 502
    And the response should be an auth error with code "github_error"
    And no sign-in code should be issued

  # --- US-1: GitHub failures ----------------------------------------------------------------

  @edge @regression @P1
  Scenario Outline: A failing GitHub token exchange issues no token
    Given GitHub's token exchange will fail with "<failure>"
    When I start GitHub sign-in with redirect "http://localhost:3000/"
    And GitHub calls back with code "good-code" and the issued state
    Then the response status should be <status>
    And the response should be an auth error with code "<code>"
    And no sign-in code should be issued

    Examples:
      | failure      | status | code                |
      | rejected     | 502    | github_unavailable  |
      | server error | 502    | github_unavailable  |
      | unreachable  | 502    | github_unavailable  |
      | rate limited | 503    | github_rate_limited |

  @edge @regression @P2
  Scenario Outline: A failing GitHub user lookup issues no token
    Given GitHub's token exchange succeeds for code "good-code" but the user lookup fails with "<failure>"
    When I start GitHub sign-in with redirect "http://localhost:3000/"
    And GitHub calls back with code "good-code" and the issued state
    Then the response status should be <status>
    And the response should be an auth error with code "<code>"
    And no sign-in code should be issued

    Examples:
      | failure      | status | code                |
      | unauthorized | 502    | github_unavailable  |
      | rate limited | 503    | github_rate_limited |

  # --- One-time sign-in code ----------------------------------------------------------------

  @edge @regression @P1
  Scenario: A one-time code cannot be exchanged twice
    Given I completed GitHub sign-in as "gaearon"
    When I exchange the one-time code for a session token
    And I exchange the one-time code for a session token
    Then the response status should be 400
    And the response should be an auth error with code "code_invalid"
    And the response should not contain a session token

  @edge @regression @P1
  Scenario: A one-time code expires after about a minute
    Given I completed GitHub sign-in as "gaearon"
    When 61 seconds pass
    And I exchange the one-time code for a session token
    Then the response status should be 400
    And the response should be an auth error with code "code_invalid"
    And the response should not contain a session token

  @edge @regression @P2
  Scenario: An unknown one-time code is rejected
    When I exchange the one-time code "made-up-code" for a session token
    Then the response status should be 400
    And the response should be an auth error with code "code_invalid"

  @edge @regression @P2
  Scenario: A token exchange without a code is rejected
    When I exchange an empty body for a session token
    Then the response status should be 400
    And the response should be an auth error with code "code_missing"

  # --- US-2: Protected routes (GET /auth/me) ------------------------------------------------

  @smoke @P1
  Scenario: A valid token identifies me
    Given I have a valid session token for "gaearon"
    When I call GET /auth/me with the session token
    Then the response status should be 200
    And the signed-in identity should be "gaearon"

  @edge @regression @P1
  Scenario: A request without a token gets 401
    When I call GET /auth/me without a token
    Then the response status should be 401
    And the response should be an auth error with code "token_missing"
    And the response should challenge for a Bearer token

  @edge @regression @P2
  Scenario: A non-Bearer Authorization header counts as no token
    When I call GET /auth/me with Authorization header "Basic Z2FlYXJvbjpodW50ZXIy"
    Then the response status should be 401
    And the response should be an auth error with code "token_missing"

  @edge @regression @P1
  Scenario: An expired token gets 401 "expired"
    Given I have a session token for "gaearon" that expired 1 hour ago
    When I call GET /auth/me with the session token
    Then the response status should be 401
    And the response should be an auth error with code "token_expired"

  @edge @regression @P1
  Scenario: A token valid at issue is rejected as expired after 7 days
    Given I have a valid session token for "gaearon"
    When 604801 seconds pass
    And I call GET /auth/me with the session token
    Then the response status should be 401
    And the response should be an auth error with code "token_expired"

  @edge @regression @P1
  Scenario Outline: A malformed or tampered token gets 401 "invalid"
    Given I have a <kind> session token
    When I call GET /auth/me with the session token
    Then the response status should be 401
    And the response should be an auth error with code "token_invalid"

    Examples:
      # tampered: subject changed to "bob", original signature kept
      # foreign-signed: signed with a secret other than JWT_SECRET
      # alg-none: unsigned token with header alg "none"
      | kind           |
      | tampered       |
      | foreign-signed |
      | alg-none       |
      | malformed      |

  @edge @regression @P2
  Scenario: An expired token that was also tampered with is "invalid", not "expired"
    Given I have a session token for "gaearon" that expired 1 hour ago, signed with another secret
    When I call GET /auth/me with the session token
    Then the response status should be 401
    And the response should be an auth error with code "token_invalid"

  # --- Slice 1 scope and non-functional -----------------------------------------------------

  @regression @P1
  Scenario: Existing routes are not protected yet in slice 1
    When I request the list of all developers
    Then the response status should be 200

  @edge @regression @P2
  Scenario: Auth endpoints are rate limited
    Given the auth rate limit is 3 requests per window
    When I call GET /auth/me without a token 4 times
    Then the response status should be 429
    And the response should be an auth error with code "rate_limited"
