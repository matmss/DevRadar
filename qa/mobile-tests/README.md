# DevRadar Mobile QA scaffold

## Prerequisite: this app's Expo SDK is very old (36, from 2019)

Detox targets current React Native/Expo toolchains. Before `detox build` will work against
`dev/mobile/`, one of the following is required (see BUG-007 in `docs/05-bug-tracker.md`):

1. **Recommended:** upgrade `dev/mobile/` to a current Expo SDK (50+) and a Detox-compatible dev
   client. This is a real app change, tracked as its own ticket — not something a test
   scaffold should do silently.
2. **Interim, no app changes needed:** use the Maestro flows in `maestro/*.yaml` instead.
   Maestro drives the app black-box (via Expo Go or any installed build) and matches by
   visible text, so it works today without touching `dev/mobile/`'s dependencies or adding
   `testID`s.

## Prerequisite: add `testID`s to mobile source (for the Detox suite only)

Detox's `by.id(...)` selectors need `testID` props that don't currently exist in
`dev/mobile/src/pages/Main.js` / `Profile.js`. Suggested minimal additions (not applied to the
app automatically by this scaffold — a developer should add these alongside the Expo
upgrade):

```diff
- <TextInput style={styles.searchInput} ... />
+ <TextInput testID="search-input" style={styles.searchInput} ... />

- <TouchableOpacity onPress={loadDevs} style={styles.loadButton}>
+ <TouchableOpacity testID="search-button" onPress={loadDevs} style={styles.loadButton}>

- <MapView onRegionChangeComplete={...} initialRegion={currentRegion} style={styles.map}>
+ <MapView testID="map-view" onRegionChangeComplete={...} initialRegion={currentRegion} style={styles.map}>

- <Marker key={dev._id} coordinate={...}>
+ <Marker testID={`marker-${dev._id}`} key={dev._id} coordinate={...}>
```

The `.feature`/step files below are written against these `testID`s so they're ready to run
once both prerequisites land.

## Running

```bash
# Detox (after prerequisites above are met)
npm run build:android && npm run test:android

# Maestro (works today, no app changes)
brew install maestro   # or: curl -Ls "https://get.maestro.mobile.dev" | bash
npm run maestro

# QA unit tests (Jest, no device; needs `npm ci` in dev/mobile first)
npm run unit
```

`unit/` holds QA-owned Jest tests for the mobile app (e.g. race conditions found in review). They
run with dev/mobile's own Jest and `jest-expo` preset through `unit/jest.config.js`, which also
pins `axios`, `socket.io-client`, `react` and `react-test-renderer` to dev/mobile's copies (the qa
workspace has its own `axios`/`socket.io-client`, and a `jest.mock` of the wrong copy would not
mock the app's). DEV's own mobile unit tests are in `dev/tests/mobile/` (`npm test` in dev/mobile).

## Sign-in (auth slice 4)

The app shows "Entrar com GitHub" instead of the map until the user signs in (US-7), so:

- `maestro/00-signed-out-screen.yaml` and `04-sign-in-cancelled.yaml` need only the installed
  app (a development build, not Expo Go).
- `01`, `02`, `03` and `05` sign in first through `maestro/subflows/sign-in-with-github.yaml`,
  which uses the **real** GitHub sign-in page in the system auth session. They need the backend
  running with a GitHub OAuth App configured and `MOBILE_APP_SCHEME=com.matmss.mobile`
  (the default), reachable from the device at the app's `EXPO_PUBLIC_API_URL`, and a GitHub test
  account without 2FA:
  `maestro test -e GITHUB_TEST_LOGIN=... -e GITHUB_TEST_PASSWORD=... maestro/`
- Not automated: an expired session (needs a token older than 7 days, or restart the backend
  with another `JWT_SECRET` to see "Sua sessão não é mais válida, entre novamente" on the next
  launch or search).
- The Detox scenarios (`e2e/`) do not sign in yet; they are blocked by BUG-009 anyway.

## Live marker updates (auth slice 5)

`dev-updated` and `dev-deleted` (US-7 "Live profile update") are covered by Jest in
`dev/tests/mobile` (`pages/Main.test.js`, `services/devList.test.js`, `services/socket.test.js`).
On a device it is a manual check, since it needs a second account changing its profile from the
web app while the map is open:

1. Sign in on the device, search for a tech near a second account's registered location.
2. From the web app, signed in as that second account, change its location (still within 10 km)
   and click "Atualizar": the marker moves and its callout shows the new techs, without tapping
   search.
3. Click "Excluir meu perfil" and confirm: the marker disappears.
4. Moving the second account more than 10 km away leaves its old marker on the device until the
   next search (expected: `dev-updated` only goes to maps matching the new position, Q4).
