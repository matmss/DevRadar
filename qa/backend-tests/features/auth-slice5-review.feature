Feature: QA review of GitHub sign-in slice 5, backend (own-profile routes and live events)
  As QA reviewing feat/auth-slice-5-dev
  I want the new live events held to the same "nearby" rule as GET /search
  So that BUG-002 cannot come back through dev-updated or dev-deleted

  # Spec: dev/docs/03-auth-spec.md Q4 ("same isNearby + techs rule as new-dev") and BUG-002
  # (features/radius.feature guards new-dev only). Slice 5 reuses websocket.findConnections for
  # both new events, so these pass today; they fail if either event ever gets its own filter
  # (a hardcoded radius, "<" instead of "<=", another Earth radius) that disagrees with
  # MongoDB's $maxDistance at the 10 km edge. Distances are on MongoDB's 6378.1 km sphere.

  Background:
    Given the developer database is empty
    And I am signed in as "gaearon"
    And a signed-in client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"

  @regression @edge @P2
  Scenario: An update that lands just inside 10 km is both pushed as dev-updated and found by search
    Given a developer already exists with github_username "gaearon" and techs "Elixir"
    When I update my profile with techs "ReactJS" 9.995 km north of latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And client "watcher" should receive a "dev-updated" event within 2 seconds
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    Then the response should include "gaearon"

  @regression @edge @P2
  Scenario: An update that lands just outside 10 km is neither pushed as dev-updated nor found by search
    Given a developer already exists with github_username "gaearon" and techs "ReactJS"
    When I update my profile with techs "ReactJS" 10.005 km north of latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And client "watcher" should not receive a "dev-updated" event within 2 seconds
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    Then the response should not include "gaearon"

  @regression @edge @P2
  Scenario: Deleting a profile just inside 10 km pushes dev-deleted to the subscriber whose search showed it
    Given developer "gaearon" with techs "ReactJS" is registered 9.995 km north of latitude "-23.5505" and longitude "-46.6333"
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    Then the response should include "gaearon"
    When I delete my profile
    Then the response status should be 204
    And client "watcher" should receive a "dev-deleted" event within 2 seconds

  @regression @edge @P2
  Scenario: Deleting a profile just outside 10 km pushes nothing to a subscriber whose search never showed it
    Given developer "gaearon" with techs "ReactJS" is registered 10.005 km north of latitude "-23.5505" and longitude "-46.6333"
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    Then the response should not include "gaearon"
    When I delete my profile
    Then the response status should be 204
    And client "watcher" should not receive a "dev-deleted" event within 2 seconds
