// QA unit tests for the mobile app (auth slice 4 review). They run with dev/mobile's own Jest and
// jest-expo preset (rootDir = dev/mobile), but live here, under qa/, so QA never edits dev/.
// Run: `npm run unit` in qa/mobile-tests.
//
// The test files sit outside dev/mobile, so Node-style resolution from them would find the qa
// workspace's own copies of some packages first (qa/node_modules has axios, socket.io-client, ...).
// A jest.mock() of such a copy would not mock the one the app imports, so these packages are
// pinned to dev/mobile/node_modules for every importer.
const path = require('path');

const MOBILE_DIR = path.resolve(__dirname, '../../../dev/mobile');
const PINNED = ['socket.io-client', 'axios', 'react', 'react-test-renderer'];

const moduleNameMapper = {};
PINNED.forEach((name) => {
  const escaped = name.replace(/[.]/g, '\\.');
  moduleNameMapper[`^${escaped}$`] = path.join(MOBILE_DIR, 'node_modules', name);
  moduleNameMapper[`^${escaped}/(.*)$`] = `${path.join(MOBILE_DIR, 'node_modules', name)}/$1`;
});

module.exports = {
  preset: 'jest-expo',
  rootDir: MOBILE_DIR,
  roots: [__dirname],
  modulePaths: [path.join(MOBILE_DIR, 'node_modules')],
  moduleNameMapper,
};
