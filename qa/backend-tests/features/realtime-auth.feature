Feature: The live subscription requires sign-in (US-5, Q6)
  As the DevRadar API
  I want only signed-in clients to subscribe to new-dev pushes
  So that nobody can watch developers appear on the map anonymously

  # Spec: dev/docs/03-auth-spec.md, US-5 and Q6 (auth slice 4). The client sends its session
  # token in the Socket.io handshake `auth` payload ({ token }); nothing else counts (not the
  # query string, not an Authorization header). A refused handshake is a Socket.io middleware
  # error: the client gets connect_error with data { code, details }, using the HTTP 401 codes
  # (token_missing, token_expired, token_invalid) or subscription_invalid. The token is checked
  # on connect only (Q6). See dev/backend/src/websocket.js.
  #
  # Each refused client asks for a distinct spot (latitude 1.x) so "0 live subscriptions" there
  # proves it was never added to the server's `connections`.

  Background:
    Given the developer database is empty
    And I am signed in as "gaearon"

  @smoke @P1
  Scenario: A client with a valid session token is subscribed and receives new-dev
    Given a signed-in client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    Then there should be 1 live subscription near latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    When I submit a registration with techs "ReactJS", latitude "-23.5510" and longitude "-46.6330"
    Then client "watcher" should receive a "new-dev" event within 2 seconds
    And the event payload for "watcher" should contain github_username "gaearon"

  @smoke @P1
  Scenario: A handshake without a session token is refused and never subscribed
    When client "anonymous" tries to connect via WebSocket without a session token at latitude "1.1", longitude "2.1" watching techs "Elixir"
    Then client "anonymous" should be refused with code "token_missing"
    And client "anonymous" should not be connected
    And there should be 0 live subscriptions near latitude "1.1", longitude "2.1" for techs "Elixir"

  @edge @regression @P1
  Scenario: A handshake with an expired session token is refused as expired
    When client "expired" tries to connect via WebSocket with an expired session token at latitude "1.2", longitude "2.2" watching techs "Elixir"
    Then client "expired" should be refused with code "token_expired"
    And client "expired" should not be connected
    And there should be 0 live subscriptions near latitude "1.2", longitude "2.2" for techs "Elixir"
    And the refusal sent to client "expired" should not contain a session token

  @edge @regression @P1
  Scenario Outline: A handshake with an invalid session token is refused as invalid
    When client "forged" tries to connect via WebSocket with a <kind> session token at latitude "1.3", longitude "2.3" watching techs "Elixir"
    Then client "forged" should be refused with code "token_invalid"
    And client "forged" should not be connected
    And there should be 0 live subscriptions near latitude "1.3", longitude "2.3" for techs "Elixir"

    Examples:
      # Kinds: see forgedSessionToken in features/support/session.js.
      | kind           |
      | tampered       |
      | foreign-signed |
      | alg-none       |
      | malformed      |
      | profile-less   |
      | forged-profile |

  # Tokens never travel in URLs (access logs), and there is one place to send it.
  @edge @regression @P2
  Scenario Outline: A session token outside the handshake auth payload is not accepted
    When client "misplaced" tries to connect via WebSocket with a valid session token in <where> at latitude "1.4", longitude "2.4" watching techs "Elixir"
    Then client "misplaced" should be refused with code "token_missing"
    And there should be 0 live subscriptions near latitude "1.4", longitude "2.4" for techs "Elixir"

    Examples:
      | where                   |
      | the query string        |
      | an Authorization header |

  # The token is checked first: an anonymous client learns nothing about validation.
  @edge @regression @P2
  Scenario: Authentication is checked before the subscription params
    When client "anonymous" tries to connect via WebSocket without a session token and without subscription params
    Then client "anonymous" should be refused with code "token_missing"

  # BUG-011 style: refused handshakes must not crash the process or leak into `connections`.
  @edge @regression @P1
  Scenario: Refused clients get no pushes, and the server keeps serving signed-in clients
    When client "anonymous" tries to connect via WebSocket without a session token at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    And 20 clients try to connect via WebSocket with a malformed session token
    And a signed-in client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    Then there should be 1 live subscription near latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then client "watcher" should receive a "new-dev" event within 2 seconds
    And client "anonymous" should receive exactly 0 "new-dev" events within 1 seconds

  # Q6: no forced disconnect at expiry. The clock is moved forward 8 days (past the 7-day token).
  @edge @regression @P1
  Scenario: An open socket survives the expiry of its session token, a reconnect does not
    Given a signed-in client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    When 8 days pass
    And I am signed in as "gaearon"
    And I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then client "watcher" should receive a "new-dev" event within 2 seconds
    And client "watcher" should still be connected
    When client "watcher-again" tries to connect via WebSocket with the session token of client "watcher" at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    Then client "watcher-again" should be refused with code "token_expired"
    And there should be 1 live subscription near latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
