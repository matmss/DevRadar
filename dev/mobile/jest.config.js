// Unit tests for the mobile app live in dev/tests/mobile/, mirroring src/ (dev/docs/01-conventions.md,
// "Tests mirror /src"). Run with `npm test` here. jest-expo is pinned to 57.0.4: later 57.0.x
// require @react-native/jest-preset ^0.86.3, which conflicts with react-native 0.86.2.
module.exports = {
  preset: 'jest-expo',
  rootDir: __dirname,
  roots: ['<rootDir>/../tests/mobile'],
  // The tests sit outside this package, so resolve their imports from its node_modules.
  modulePaths: ['<rootDir>/node_modules'],
};
