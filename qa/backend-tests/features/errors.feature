Feature: Every route answers errors as JSON (BUG-012)
  As a DevRadar client
  I want failed requests to return { error, code, details } instead of an HTML stack trace
  So that I can show a useful message and no server internals or request data leak

  # The global error middleware (dev/backend/src/middleware/errorHandler.js) is registered last
  # by dev/backend/src/app.js, so it covers the existing routes, not only /auth/*.

  @edge @regression @P2
  Scenario Outline: A malformed registration body gets a JSON error
    When I send the raw registration body <body>
    Then the response status should be <status>
    And the response should be a JSON error with code "<code>"
    And the response should be a JSON error with details and no stack trace
    And no developer should be persisted

    Examples:
      | body                                  | status | code           |
      | '{"github_username":'                 | 400    | body_invalid   |
      | '{"github_username":"gaearon",}'      | 400    | body_invalid   |
      | an oversized JSON payload             | 413    | body_too_large |

  @edge @regression @P2
  Scenario: An unexpected server error gets a generic JSON 500 without a stack trace
    Given the database fails when listing developers
    When I request the list of all developers
    Then the response status should be 500
    And the response should be a JSON error with code "internal_error"
    And the response should be a JSON error with details and no stack trace
    And the response should not mention "simulated database failure"
