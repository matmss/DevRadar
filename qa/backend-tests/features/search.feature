Feature: Search developers by location and tech
  As a developer using DevRadar
  I want to find nearby developers who know specific technologies
  So that I can network with them

  # GET /search requires a session token (auth slice 4); its 401s are in read-auth.feature.

  Background:
    Given the developer database is empty
    And I am signed in as "gaearon"
    And the following developers exist:
      | github_username | techs             | latitude  | longitude  |
      | near-match       | ReactJS,Node.js   | -23.5505  | -46.6333   |
      | near-no-tech     | Python            | -23.5506  | -46.6334   |
      | far-match        | ReactJS           | -22.9068  | -43.1729   |

  @smoke @P1
  Scenario: Search returns only nearby developers with a matching tech
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "ReactJS"
    Then the response should contain exactly 1 developer
    And the response should include "near-match"
    And the response should not include "far-match"
    And the response should not include "near-no-tech"

  @regression @P3
  Scenario: Search with a tech nobody has returns an empty list
    When I search at latitude "-23.5505", longitude "-46.6333" for techs "COBOL"
    Then the response should contain exactly 0 developers

  # BUG-011 (search side): missing/invalid params used to surface as a raw 500.
  @regression @edge @P2
  Scenario Outline: Search with missing or invalid params is rejected with 400
    When I search at latitude "<latitude>", longitude "<longitude>" for techs "<techs>"
    Then the response status should be 400

    Examples:
      | latitude | longitude | techs   |
      | -23.5505 | -46.6333  |         |
      |          | -46.6333  | ReactJS |
      | abc      | -46.6333  | ReactJS |
      | -23.5505 | 200       | ReactJS |

