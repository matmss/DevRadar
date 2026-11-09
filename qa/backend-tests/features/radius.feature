Feature: One "nearby" radius for search and real-time pushes (BUG-002 / TC-010)
  As a developer using DevRadar
  I want the live map updates and the search to agree on who is nearby
  So that a developer never appears in one and not the other

  # Distances are great-circle km on MongoDB's 2dsphere sphere (radius 6378.1 km).
  # Before BUG-002 was fixed, the websocket used strict "< 10" on a 6371 km sphere, so a
  # developer ~10.005 km away was pushed live but excluded from GET /search.

  Background:
    Given the developer database is empty
    And I am signed in as "gaearon"
    And a signed-in client "watcher" is connected via WebSocket at latitude "-23.5505", longitude "-46.6333" watching techs "ReactJS"

  @regression @edge @P2
  Scenario: A developer just inside 10 km is both pushed live and found by search
    When I register with techs "ReactJS" 9.995 km north of latitude "-23.5505" and longitude "-46.6333"
    Then client "watcher" should receive a "new-dev" event within 2 seconds
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    Then the response should include "gaearon"

  @regression @edge @P2
  Scenario: A developer just outside 10 km is neither pushed live nor found by search
    When I register with techs "ReactJS" 10.005 km north of latitude "-23.5505" and longitude "-46.6333"
    Then client "watcher" should not receive a "new-dev" event within 2 seconds
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    Then the response should not include "gaearon"
