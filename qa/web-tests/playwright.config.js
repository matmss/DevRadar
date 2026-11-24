const { defineConfig, devices } = require('@playwright/test');
const { defineBddConfig } = require('playwright-bdd');
const { INTEGRATION_BACKEND_PORT } = require('./features/support/global-setup');

const testDir = defineBddConfig({
  features: 'features/*.feature',
  steps: 'features/step_definitions/*.js',
});

// Assumes this package lives at repo-root/qa/web-tests, i.e. two levels below
// repo-root (qa/ then web-tests/); the app it drives lives at repo-root/dev/web
// (React + Vite; `npm start` is its Vite dev server, configured in dev/web/vite.config.js).
// The dev server is started automatically for local/CI runs; set
// WEB_BASE_URL to point at an already-running instance instead (e.g. staging).
//
// Runs against a REAL backend (real Express routes, real MongoDB via
// mongodb-memory-server; only GitHub's third-party API is stubbed) rather than
// Playwright `page.route` mocks — see features/support/backend-server.js and
// features/support/global-setup.js, which boots it before the web server/browser start.
const backendUrl = `http://127.0.0.1:${INTEGRATION_BACKEND_PORT}`;

module.exports = defineConfig({
  testDir,
  // Every scenario shares the one harness backend and its database (reset/seeded through
  // /__test__), so feature files must not run in parallel workers: one file's reset would
  // wipe another's seed data mid-scenario.
  workers: 1,
  globalSetup: require.resolve('./features/support/global-setup'),
  reporter: [
    ['html', { outputFolder: '../reports/web-html' }],
    ['json', { outputFile: '../reports/web.json' }],
  ],
  use: {
    baseURL: process.env.WEB_BASE_URL || 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  webServer: process.env.WEB_BASE_URL
    ? undefined
    : {
        command: 'npm start',
        cwd: '../../dev/web',
        url: 'http://127.0.0.1:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
        // The Vite dev server listens on 127.0.0.1:3000 only, with strictPort (both set in
        // dev/web/vite.config.js, not here): the address the browser dials (baseURL above), so no
        // other process can take over 127.0.0.1:3000 (another 127.0.0.1 binder fails the start;
        // a wildcard "::" one could only answer localhost/::1, which nothing here dials; see
        // backend-server.js). It opens no browser by itself.
        env: {
          // Read through import.meta.env when the dev server starts (inlined, so a running server
          // would keep its old value: another reason CI never reuses one).
          VITE_API_URL: backendUrl,
        },
      },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // In some sandboxed/offline environments Playwright's expected browser build
        // isn't pre-fetched; point at whatever Chromium build is locally available
        // instead of triggering a download. Safe to remove where `npx playwright
        // install` has already run normally.
        launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
      },
    },
  ],
});
