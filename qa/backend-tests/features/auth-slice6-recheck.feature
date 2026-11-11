Feature: QA re-check of GitHub sign-in slice 6 fixes, backend (displacement and the 409 rule)
  As QA re-checking feat/auth-slice-6-dev after the QA-AUTH6-1..3 fixes
  I want the current holder of a login, whose GitHub read is the newest, never to be refused it
  So that a profile never shows a login GitHub has given to someone else for longer than one write

  # Spec: dev/docs/03-auth-spec.md Q10 (as amended for QA-AUTH6-1):
  #   "Logins stay unique across all profiles ... Logins are ordered by when GitHub was read ...
  #    POST /devs answers 409 github_username_conflict only while the other profile's login is
  #    confirmed by a newer read than the session's."
  #
  # QA-AUTH6-4: a sign-in only records its GitHub read on the signer's own profile. When the signer
  # has no profile yet, nothing remembers that GitHub gave them the login. A write from another
  # account with an OLDER read (a token from before that account renamed away, valid up to 7 days)
  # can then create, or claim, a profile showing the login. The signer's POST /devs answers 409
  # even though the other profile's read is older than the signer's, and until the signer signs
  # in again that profile shows (and links to) the signer's login.

  Background:
    Given the developer database is empty

  # Account 501 held "alice" until two days ago (its token from then is still valid) and has no
  # profile. GitHub gave "alice" to account 502, which just signed in and has no profile yet.
  @regression @edge @P2 @QA-AUTH6-4
  Scenario: The newest holder of a login registers after an older session of its previous holder registered it
    Given I signed in through GitHub as "alice" with GitHub account 502
    And I keep this session as "new holder"
    And I am signed in as "alice" with GitHub account 501, in a session that began 2 days ago
    And I submit a registration with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    And the response status should be 200
    When I use the session kept as "new holder"
    And I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the stored developer "alice" should belong to GitHub account 502
    And the developer of GitHub account 501 should be displaced

  # Same with a legacy profile "alice": 502's sign-in does not displace it (502 owns no profile,
  # so it is 502's to claim), but 501's two-day-old session claims it first.
  @regression @edge @P2 @QA-AUTH6-4
  Scenario: The newest holder of a login registers after an older session of its previous holder claimed the legacy profile
    Given a developer already exists with github_username "alice" and techs "Node.js"
    And I signed in through GitHub as "alice" with GitHub account 502
    And I keep this session as "new holder"
    And I am signed in as "alice" with GitHub account 501, in a session that began 2 days ago
    And I update my profile with techs "Go", latitude "-23.5505" and longitude "-46.6333"
    And the response status should be 200
    When I use the session kept as "new holder"
    And I submit a registration with techs "ReactJS", latitude "-23.5505" and longitude "-46.6333"
    Then the response status should be 200
    And the stored developer "alice" should belong to GitHub account 502

  # QA-AUTH6-5: the GitHub read time is taken at the callback (Date.now()) and must be earlier than
  # the token's iat, taken at POST /auth/token. signSessionToken throws when it is not, so a server
  # clock that steps back across a second boundary between the two (an NTP step, a VM or laptop
  # resuming) turns a valid sign-in into a 500 and burns the one-time code.
  @regression @edge @P3 @QA-AUTH6-5
  Scenario: A server clock that steps back between the callback and the token exchange does not break sign-in
    Given a developer "alice" owned by GitHub account 501 already exists with techs "Node.js"
    And another device of GitHub account 501 reached the sign-in callback as "alice" and holds its one-time code
    When the server clock steps back by 1500 ms
    And the other device redeems its one-time code
    Then the other device's sign-in should succeed
