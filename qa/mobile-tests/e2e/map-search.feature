Feature: Search and view developers on the map

  # Since auth slice 4 (dev/docs/03-auth-spec.md, US-7) the map is only shown with a session:
  # a fresh install shows the "Entrar com GitHub" screen, and GET /search, POST /devs and the
  # socket need a session token. These scenarios therefore need a signed-in app first; the
  # Detox steps do not sign in yet (Detox is blocked by BUG-009). The Maestro flows sign in
  # through maestro/subflows/sign-in-with-github.yaml.

  @smoke @P2
  Scenario: App centers the map on the current device location
    Given location permission is granted
    When the app launches
    Then the map should be centered on the device's current coordinates

  @smoke @P1
  Scenario: Searching by tech shows matching nearby developers as markers
    Given developers matching "ReactJS" exist within 10km
    When I enter "ReactJS" in the search field and tap search
    Then markers for the matching developers should appear on the map

  @P2
  Scenario: Tapping a marker shows the developer's callout details
    Given a developer marker is visible on the map
    When I tap the marker
    Then a callout should display the developer's name, bio and techs

  @P2
  Scenario: Tapping the callout opens the GitHub profile
    Given a developer's callout is open
    When I tap the callout
    Then the app should navigate to the Profile screen
    And the Profile screen should load the developer's GitHub profile in a WebView

  @integration @P1
  Scenario: A live "new-dev" event adds a marker without re-searching
    Given I have an active search for techs "ReactJS" centered on my region
    When a new developer matching "ReactJS" registers within 10km
    Then a new marker should appear on the map without me tapping search again

  @edge @P2
  Scenario: Location permission denied
    Given location permission is denied
    When the app launches
    Then the app should not crash
