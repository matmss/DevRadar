Feature: Developer registration
  As the DevRadar API
  I want to register a developer with their GitHub profile and location
  So that they become discoverable to nearby developers

  Background:
    Given the developer database is empty

  @smoke @P1
  Scenario: Register a new developer with a valid GitHub username
    Given "gaearon" is a valid GitHub username
    When I submit a registration with github_username "gaearon", techs "ReactJS, Redux", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the response should include the developer's name, avatar_url and bio from GitHub
    And the developer's techs should be "ReactJS,Redux"
    And the developer should be persisted with a GeoJSON location of type "Point"

  @regression @P1
  Scenario: Registering the same GitHub username twice does not duplicate
    Given a developer already exists with github_username "gaearon" and techs "Node.js"
    When I submit a registration with github_username "gaearon", techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And exactly 1 developer with github_username "gaearon" should exist in the database
    And the developer's techs should be "Node.js"

  @regression @P2
  Scenario: Techs string parsing trims whitespace
    Given "gaearon" is a valid GitHub username
    When I submit a registration with github_username "gaearon", techs " ReactJS ,  Node.js,Redux ", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the developer's techs should be "ReactJS,Node.js,Redux"

  @edge @regression @P1
  Scenario: Missing github_username is rejected
    When I submit a registration with github_username "", techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 400
    And no developer should be persisted

  @edge @regression @P1
  Scenario: Non-existent GitHub username is rejected cleanly
    Given "ghost-user-does-not-exist-xyz" is not a valid GitHub username
    When I submit a registration with github_username "ghost-user-does-not-exist-xyz", techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 404
    And no developer with github_username "ghost-user-does-not-exist-xyz" should be persisted

  # BUG-004: GitHub failures other than 404 must not leak as raw axios errors.
  @edge @regression @P1
  Scenario: GitHub rate limit returns 503 and persists nothing
    Given the GitHub API is rate limiting requests for "gaearon"
    When I submit a registration with github_username "gaearon", techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 503
    And no developer with github_username "gaearon" should be persisted

  @edge @regression @P2
  Scenario: GitHub network failure returns 502 and persists nothing
    Given the GitHub API is unreachable for "gaearon"
    When I submit a registration with github_username "gaearon", techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 502
    And no developer with github_username "gaearon" should be persisted

  # BUG-003 / BUG-005: invalid input is rejected with 400 before GitHub is called.
  @edge @regression @P1
  Scenario Outline: Invalid registration input is rejected with 400
    When I submit a registration with github_username "<username>", techs "<techs>", latitude "<latitude>" and longitude "<longitude>"
    Then the response status should be 400
    And no developer should be persisted

    Examples:
      | username   | techs   | latitude     | longitude    |
      | gaearon    | ReactJS | not-a-number | -46.6333     |
      | gaearon    | ReactJS | -23.5505     | not-a-number |
      | gaearon    | ReactJS |              | -46.6333     |
      | gaearon    | ReactJS | 91           | -46.6333     |
      | gaearon    | ReactJS | -23.5505     | 181          |
      | gaearon    |         | -23.5505     | -46.6333     |
      | gaearon    | ,  ,    | -23.5505     | -46.6333     |
      | ../orgs/x  | ReactJS | -23.5505     | -46.6333     |
      | -bad-name- | ReactJS | -23.5505     | -46.6333     |
