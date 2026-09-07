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
```
