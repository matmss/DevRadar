Feature: Cross-origin access is limited to the DevRadar clients (BUG-006)
  As the DevRadar API
  I want only the DevRadar web clients to call me from a browser
  So that arbitrary websites can't read or write developer data through a visitor's browser

  # Default allow-list (no CORS_ORIGINS set): http://localhost:3000 and http://localhost:8081.
  # Since auth slice 4 reads and the socket also need a session token; these scenarios sign in,
  # so they only exercise the origin check. read-auth.feature checks that a 401 still carries
  # the CORS header for an allowed origin.

  Background:
    Given I am signed in as "gaearon"

  @regression @P2
  Scenario: The web app's origin is allowed
    When I request the list of all developers from origin "http://localhost:3000"
    Then the response should allow origin "http://localhost:3000"

  @regression @edge @P2
  Scenario: An unknown origin is not allowed
    When I request the list of all developers from origin "https://evil.example"
    Then the response should not allow any origin

  @regression @edge @P2
  Scenario: A preflight for a registration from an unknown origin is not allowed
    When a browser at origin "https://evil.example" sends a preflight for "POST" "/devs"
    Then the response should not allow any origin

  @regression @P2
  Scenario: Requests without an Origin header (native mobile app) are still served
    When I request the list of all developers
    Then the response status should be 200

  # A valid session token does not get a disallowed origin past allowRequest.
  @integration @regression @edge @P2
  Scenario: A WebSocket handshake from an unknown browser origin is rejected
    When a signed-in browser client at origin "https://evil.example" connects via WebSocket watching techs "ReactJS"
    Then that WebSocket connection should be refused

  @integration @regression @P2
  Scenario: A WebSocket handshake from the web app's origin is accepted
    When a signed-in browser client at origin "http://localhost:3000" connects via WebSocket watching techs "ReactJS"
    Then that WebSocket connection should be accepted
