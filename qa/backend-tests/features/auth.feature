Feature: GitHub sign-in and session tokens (US-1, US-2; BUG-006 auth part)
  As a developer using DevRadar
  I want to sign in with my GitHub account and get a DevRadar session token
  So that the API knows who I am without trusting a username I type

  # Spec: dev/docs/03-auth-spec.md. GET /auth/me and POST /devs (registration.feature) require
  # a session token; the reads follow in slice 4. The token carries the GitHub profile read at
  # sign-in. GitHub's OAuth endpoints are mocked with nock (features/support/github-mock.js).
  # The backend runs with GITHUB_CLIENT_ID "test-client-id" and the default callback URL
  # (features/support/auth-config.js). Allowed redirects: the CORS origins + "devradar://".
  # Every sign-in uses PKCE (RFC 7636, S256): "I start GitHub sign-in" sends the challenge of a
  # fresh random verifier, and "I exchange the one-time code" sends that verifier.

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

  # --- QA-AUTH-1: PKCE is required to start sign-in -----------------------------------------

  @edge @regression @P1
  Scenario: Starting sign-in without a PKCE challenge is rejected
    When I start GitHub sign-in with redirect "http://localhost:3000/" without a PKCE challenge
    Then the response status should be 400
    And the response should be an auth error with code "code_challenge_invalid"
    And I should not be redirected anywhere

  @edge @regression @P1
  Scenario Outline: A malformed PKCE challenge is rejected
    When I start GitHub sign-in with redirect "http://localhost:3000/" and code_challenge "<challenge>"
    Then the response status should be 400
    And the response should be an auth error with code "code_challenge_invalid"
    And I should not be redirected anywhere

    Examples:
      | challenge                                    |
      |                                              |
      | too-short                                    |
      | E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-c+  |
      | E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM= |

  @edge @regression @P1
  Scenario Outline: Only the S256 PKCE method is accepted
    When I start GitHub sign-in with redirect "http://localhost:3000/" and code_challenge_method "<method>"
    Then the response status should be 400
    And the response should be an auth error with code "code_challenge_method_invalid"
    And I should not be redirected anywhere

    Examples:
      | method |
      |        |
      | plain  |
      | s256   |

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
    And the session token should carry "gaearon"'s GitHub profile from sign-in
    And no developer should be persisted
    When I call GET /auth/me with the session token
    Then the response status should be 200
    And the signed-in identity should be "gaearon"
    And the signed-in user should have the name and avatar_url of "gaearon"'s GitHub profile

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

  # Once the state is verified, the client's redirect is known: every later failure sends the
  # browser back to the client with ?error=sign_in_failed&reason=<code> instead of a JSON page.

  @edge @regression @P2
  Scenario: A callback with a valid state but no code sends the client a "sign-in failed" result
    When I start GitHub sign-in with redirect "http://localhost:3000/"
    And GitHub calls back with no code and the issued state
    Then I should be redirected to "http://localhost:3000/" with error "sign_in_failed" and reason "github_code_missing"
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
  Scenario: Any other GitHub callback error sends the client a "sign-in failed" result
    When I start GitHub sign-in with redirect "http://localhost:3000/"
    And GitHub calls back with error "redirect_uri_mismatch" and the issued state
    Then I should be redirected to "http://localhost:3000/" with error "sign_in_failed" and reason "github_error"
    And no sign-in code should be issued

  @edge @regression @P2
  Scenario: A failure redirect goes to the mobile app too
    When I start GitHub sign-in with redirect "devradar://auth"
    And GitHub calls back with error "redirect_uri_mismatch" and the issued state
    Then I should be redirected to "devradar://auth" with error "sign_in_failed" and reason "github_error"

  # --- US-1: GitHub failures ----------------------------------------------------------------

  @edge @regression @P1
  Scenario Outline: A failing GitHub token exchange issues no token and sends the client back
    Given GitHub's token exchange will fail with "<failure>"
    When I start GitHub sign-in with redirect "http://localhost:3000/"
    And GitHub calls back with code "good-code" and the issued state
    Then I should be redirected to "http://localhost:3000/" with error "sign_in_failed" and reason "<reason>"
    And no sign-in code should be issued

    Examples:
      | failure      | reason              |
      | rejected     | github_unavailable  |
      | server error | github_unavailable  |
      | unreachable  | github_unavailable  |
      | rate limited | github_rate_limited |

  @edge @regression @P2
  Scenario Outline: A failing GitHub user lookup issues no token and sends the client back
    Given GitHub's token exchange succeeds for code "good-code" but the user lookup fails with "<failure>"
    When I start GitHub sign-in with redirect "http://localhost:3000/"
    And GitHub calls back with code "good-code" and the issued state
    Then I should be redirected to "http://localhost:3000/" with error "sign_in_failed" and reason "<reason>"
    And no sign-in code should be issued

    Examples:
      | failure      | reason              |
      | unauthorized | github_unavailable  |
      | rate limited | github_rate_limited |

  # --- One-time sign-in code ----------------------------------------------------------------

  @edge @regression @P1
  Scenario: A one-time code cannot be exchanged twice
    Given I completed GitHub sign-in as "gaearon"
    When I exchange the one-time code for a session token
    And I exchange the one-time code for a session token
    Then the response status should be 400
    And the response should be an auth error with code "code_invalid"
    And the response should not contain a session token

  # --- QA-AUTH-1: the one-time code only works with the client's own PKCE verifier ---------

  @edge @regression @P1
  Scenario: A one-time code without a PKCE verifier is rejected and spent
    Given I completed GitHub sign-in as "gaearon"
    When I exchange the one-time code without a PKCE verifier
    Then the response status should be 400
    And the response should be an auth error with code "code_verifier_missing"
    When I exchange the one-time code for a session token
    Then the response status should be 400
    And the response should be an auth error with code "code_invalid"

  @edge @regression @P1
  Scenario Outline: A wrong PKCE verifier is rejected and spends the code
    Given I completed GitHub sign-in as "gaearon"
    When I exchange the one-time code with a <kind> PKCE verifier
    Then the response status should be 400
    And the response should be an auth error with code "code_verifier_invalid"
    And the response should not contain a session token
    When I exchange the one-time code for a session token
    Then the response status should be 400
    And the response should be an auth error with code "code_invalid"

    Examples:
      | kind      |
      | wrong     |
      | malformed |

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
      # profile-less: correctly signed, no sign-in profile claim (tokens issued by slice 1)
      # forged-profile: correctly signed, profile claim not in the shape the backend signs
      | kind           |
      | tampered       |
      | foreign-signed |
      | alg-none       |
      | malformed      |
      | profile-less   |
      | forged-profile |

  @regression @P1
  Scenario: GET /auth/me returns the name and avatar captured at sign-in, without calling GitHub
    Given I have a valid session token for "gaearon"
    When I call GET /auth/me with the session token
    Then the response status should be 200
    And the signed-in user should have the name and avatar_url of "gaearon"'s GitHub profile
    And no call should have been made to GitHub's public users API

  @edge @regression @P2
  Scenario: An expired token that was also tampered with is "invalid", not "expired"
    Given I have a session token for "gaearon" that expired 1 hour ago, signed with another secret
    When I call GET /auth/me with the session token
    Then the response status should be 401
    And the response should be an auth error with code "token_invalid"

  # --- Slice 1 scope and non-functional -----------------------------------------------------

  # Slice 2 protects POST /devs (registration.feature); the reads follow in slice 4.
  @regression @P1
  Scenario: Reads are not protected yet
    When I request the list of all developers
    Then the response status should be 200
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    Then the response status should be 200

  # Two limiters per IP per 15 min: sign-in (AUTH_RATE_LIMIT_MAX, default 60) for
  # /auth/github, the callback and /auth/token; session checks (AUTH_SESSION_RATE_LIMIT_MAX,
  # default 600) for GET /auth/me, which clients call on every load.

  @edge @regression @P2
  Scenario: Sign-in endpoints are rate limited
    Given the sign-in rate limit is 3 requests per window
    When I start GitHub sign-in 4 times
    Then the response status should be 429
    And the response should be an auth error with code "rate_limited"

  @edge @regression @P2
  Scenario: Session checks are rate limited separately
    Given the session check rate limit is 3 requests per window
    When I call GET /auth/me without a token 4 times
    Then the response status should be 429
    And the response should be an auth error with code "rate_limited"

  @regression @P2
  Scenario: Exhausting the sign-in limit does not block session checks
    Given the sign-in rate limit is 2 requests per window
    And I have a valid session token for "gaearon"
    When I start GitHub sign-in 3 times
    Then the response status should be 429
    When I call GET /auth/me with the session token
    Then the response status should be 200

  # TRUST_PROXY decides whether the rate-limit key (req.ip) comes from X-Forwarded-For. Off by
  # default, so a client cannot dodge the limit by sending a different X-Forwarded-For.
  @edge @regression @P2
  Scenario Outline: The rate-limit key follows X-Forwarded-For only when trust proxy is enabled
    Given the backend runs with TRUST_PROXY "<trust proxy>"
    And the sign-in rate limit is 2 requests per window
    When I start GitHub sign-in 2 times from forwarded address "203.0.113.1"
    And I start GitHub sign-in 1 times from forwarded address "203.0.113.2"
    Then the response status should be <status>

    Examples:
      | trust proxy | status |
      |             | 429    |
      | false       | 429    |
      | true        | 302    |
      | 1           | 302    |
      | loopback    | 302    |
