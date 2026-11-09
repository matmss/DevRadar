Feature: Real-time propagation of new developers via WebSocket
  As a connected client
  I want to be notified when a matching developer registers nearby
  So that I see updates without manually re-searching

  Background:
    Given the developer database is empty

  @integration @smoke @P1
  Scenario: Registration triggers a real-time notification to a matching nearby listener
    Given I am signed in as "gaearon"
    And a client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    When I submit a registration with techs "ReactJS", latitude "-23.5510" and longitude "-46.6330"
    Then client "watcher" should receive a "new-dev" event within 2 seconds
    And the event payload for "watcher" should contain github_username "gaearon"

  @integration @regression @P1
  Scenario: Registration does not notify a listener outside the 10km radius
    Given I am signed in as "gaearon"
    And a client "far-watcher" is connected via WebSocket at latitude "-22.9068", longitude "-43.1729" watching techs "ReactJS"
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then client "far-watcher" should not receive a "new-dev" event within 2 seconds

  @integration @regression @P1
  Scenario: Registration does not notify a listener whose techs do not match
    Given I am signed in as "gaearon"
    And a client "mismatched-watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "Python"
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then client "mismatched-watcher" should not receive a "new-dev" event within 2 seconds

  # BUG-010: closed sockets must leave the in-memory subscription list.
  @integration @regression @P2
  Scenario: A disconnected client is removed from live subscriptions
    Given a client "leaver" is connected via WebSocket at latitude "1.2345", longitude "2.3456" watching techs "Elixir"
    Then there should be 1 live subscription near latitude "1.2345", longitude "2.3456" for techs "Elixir"
    When client "leaver" disconnects
    Then there should be 0 live subscriptions near latitude "1.2345", longitude "2.3456" for techs "Elixir"

  # BUG-011: a handshake without query params used to throw inside the connection
  # listener and crash the whole backend process.
  @integration @regression @edge @P1
  Scenario: A client connecting without subscription params is rejected and the server keeps running
    Given I am signed in as "gaearon"
    When a client connects via WebSocket without query params
    Then that client should be disconnected by the server
    And a client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then client "watcher" should receive a "new-dev" event within 2 seconds


  # QA-AUTH2-1: only the request that actually creates the developer announces it.
  @integration @regression @edge @P1
  Scenario: Concurrent registrations by the same user push new-dev once
    Given I am signed in as "gaearon"
    And a client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    When I submit 5 registrations at the same time with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then client "watcher" should receive exactly 1 "new-dev" event within 1 seconds

  @integration @regression @P2
  Scenario: Registering again as an existing developer pushes nothing
    Given a developer already exists with github_username "gaearon" and techs "ReactJS"
    And I am signed in as "gaearon"
    And a client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"
    When I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And client "watcher" should receive exactly 0 "new-dev" events within 1 seconds
