Feature: List all developers

  # GET /devs requires a session token (auth slice 4); its 401s are in read-auth.feature.

  Background:
    Given the developer database is empty
    And I am signed in as "gaearon"

  @smoke @P2
  Scenario: Listing developers returns everyone regardless of location
    Given the following developers exist:
      | github_username | techs    | latitude  | longitude  |
      | dev-a            | ReactJS  | -23.5505  | -46.6333   |
      | dev-b             | Python   | 40.7128   | -74.0060   |
      | dev-c             | Go       | 51.5074   | -0.1278    |
    When I request the list of all developers
    Then the response status should be 200
    And the response should contain 3 developers
