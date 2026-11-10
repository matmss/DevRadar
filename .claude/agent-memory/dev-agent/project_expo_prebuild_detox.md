---
name: expo-prebuild-drops-detox-wiring
description: Running expo prebuild in dev/mobile regenerates android/ from scratch and silently drops the hand-added Detox gradle wiring; keep only the manifest diff
metadata:
  type: project
---

`npx expo prebuild --platform android` in `dev/mobile` "clears android code" and regenerates it, even without `--clean`. In auth slice 4 (2026-11-09) that removed the hand-added Detox setup: `testInstrumentationRunner`/`testBuildType` and `androidTestImplementation('com.wix:detox:...')` in `android/app/build.gradle`, and the Detox local maven repo in `android/build.gradle`. It also rewrote `gradlew.bat` line endings. Tracked files under `android/` are force-added (`/android` is in `dev/mobile/.gitignore`), so new generated files would not show in `git status`.

**Why:** the checked-in android project is prebuild output plus manual Detox edits (BUG-009 work); a blind prebuild commit would break the Detox build.

**How to apply:** after a prebuild (e.g. to apply a config plugin or a new `scheme`), keep only the relevant hunks (usually `AndroidManifest.xml`) and `git checkout --` the gradle files and `gradlew.bat`. Alternatively hand-edit the manifest to match what the plugin generates. `dev/tests/mobile/config.test.js` checks the scheme intent filter and secure-store backup rules are present.
