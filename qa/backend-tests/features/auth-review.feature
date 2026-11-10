Feature: QA review of GitHub sign-in slice 1 (defects and coverage gaps)
  As QA reviewing feat/auth-slice-1
  I want the defects found in review reproduced as scenarios
  So that the fixes can be proven and do not regress

  # Spec: dev/docs/03-auth-spec.md, US-1 and "Security and non-functional criteria".
  # Reuses the harness from auth.feature (features/support/auth-config.js, github-mock.js).

  # --- QA-AUTH-1: the one-time code is not bound to the client that started sign-in ----------
  # The spec asks for "PKCE for mobile", and US-1 says a state that "does not match" must be
  # rejected. Today any holder of a one-time code (or of a callback URL with a valid state) can
  # redeem it. That allows login CSRF on web: the attacker completes sign-in as themselves and
  # sends the victim the link, so the victim registers their location on the attacker's account.
  # On mobile, any app that claims the devradar:// scheme can intercept and redeem the code.
  # These scenarios use the RFC 7636 parameter names (code_challenge / code_verifier).

  @edge @regression @P1
  Scenario Outline: A one-time code cannot be redeemed without the PKCE verifier of the client that started sign-in
    Given GitHub will sign in "gaearon" for authorization code "good-code"
    When I start GitHub sign-in with redirect "devradar://auth" and a PKCE challenge for verifier "<real verifier>"
    And GitHub calls back with code "good-code" and the issued state
    And I exchange the one-time code with PKCE verifier "<sent verifier>"
    Then the response status should be 400
    And the response should not contain a session token

    Examples:
      | real verifier                                       | sent verifier                                       |
      | dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk-legit-0 |                                                     |
      | dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk-legit-0 | attacker-guess-attacker-guess-attacker-guess-000001 |

  @regression @P1
  Scenario: The client that started sign-in redeems its code with its own PKCE verifier
    Given GitHub will sign in "gaearon" for authorization code "good-code"
    When I start GitHub sign-in with redirect "devradar://auth" and a PKCE challenge for verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk-legit-0"
    And GitHub calls back with code "good-code" and the issued state
    And I exchange the one-time code with PKCE verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk-legit-0"
    Then the response status should be 200
    And the response should contain a Bearer session token for "gaearon" valid for 7 days

  # --- QA-AUTH-2: malformed token requests get Express's default error page -----------------
  # Spec: "All errors use { error, details }; no stack traces or token values", and secrets are
  # never logged. Express 5's default handler answers HTML with a stack trace (outside
  # production), and logs the parse error with console.error(err); body-parser puts the raw
  # request body on that error, so the one-time code ends up in the server log.

  @edge @regression @P2
  Scenario Outline: A malformed token request gets a JSON error without a stack trace
    When I send the raw token request body <body>
    Then the response status should be <status>
    And the response should be a JSON error with details and no stack trace

    Examples:
      | body                      | status |
      | '{"code":'                | 400    |
      | '{"code":"abc",}'         | 400    |
      | an oversized JSON payload | 413    |

  @edge @regression @P2
  Scenario: A malformed token request does not write the one-time code to the server log
    Given I completed GitHub sign-in as "gaearon"
    When I send a malformed token request containing the one-time code
    Then the server log should not contain the one-time code

  # --- Coverage gaps in auth.feature (these pass today; they pin behaviour DEV claims) -------
  # auth.feature only proves that a state is rejected after 601 s and a code after 61 s, so a
  # state TTL of 2 minutes or a code TTL of 5 seconds would pass it unnoticed.

  @edge @regression @P2
  Scenario: A state is still accepted just before its 10-minute lifetime ends
    Given GitHub will sign in "gaearon" for authorization code "good-code"
    When I start GitHub sign-in with redirect "http://localhost:3000/"
    And 590 seconds pass
    And GitHub calls back with code "good-code" and the issued state
    Then I should be redirected to "http://localhost:3000/" with a one-time code

  @edge @regression @P2
  Scenario: A one-time code is still accepted just before its 60-second lifetime ends
    Given I completed GitHub sign-in as "gaearon"
    When 55 seconds pass
    And I exchange the one-time code for a session token
    Then the response status should be 200

  # Since the re-check of a953bea there are two limiters (sign-in and session checks); both are
  # exhausted here so the scenario keeps its intent for each of them.
  @edge @regression @P2
  Scenario: Exhausting the auth rate limits does not affect the existing routes
    Given the auth rate limit is 2 requests per window
    And I am signed in as "gaearon"
    When I start GitHub sign-in 3 times
    Then the response status should be 429
    When I call GET /auth/me without a token 3 times
    Then the response status should be 429
    When I request the list of all developers
    Then the response status should be 200

  # --- QA-AUTH-4 (re-check of a953bea): unknown routes still get Express's HTML 404 ----------
  # BUG-012's errors.feature says "Every route answers errors as JSON", but the error middleware
  # only sees errors; a request no route matches falls through to Express's default
  # "Cannot GET /x" HTML page. The spec asks that all errors use { error, details }.

  @edge @regression @P3
  Scenario Outline: A request to an unknown route gets a JSON 404
    When I send a <method> request to "<path>"
    Then the response status should be 404
    And the response should be a JSON error with details and no stack trace

    Examples:
      | method | path              |
      | GET    | /nope             |
      | POST   | /auth/tokens      |
      | GET    | /auth/%E0%A4%A    |
