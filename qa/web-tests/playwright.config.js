const { defineConfig, devices } = require('@playwright/test');
const { defineBddConfig } = require('playwright-bdd');
const { INTEGRATION_BACKEND_PORT } = require('./features/support/global-setup');

const testDir = defineBddConfig({
  features: 'features/*.feature',
  steps: 'features/step_definitions/*.js',
});

// Assumes this package lives at repo-root/qa/web-tests, i.e. two levels below
// repo-root (qa/ then web-tests/); the app it drives lives at repo-root/dev/web
// (Create React App).
// The dev server is started automatically for local/CI runs; set
// WEB_BASE_URL to point at an already-running instance instead (e.g. staging).
//
// Runs against a REAL backend (real Express routes, real MongoDB via
// mongodb-memory-server; only GitHub's third-party API is stubbed) rather than
// Playwright `page.route` mocks — see features/support/backend-server.js and
// features/support/global-setup.js, which boots it before the web server/browser start.
const backendUrl = `http://localhost:${INTEGRATION_BACKEND_PORT}`;

module.exports = defineConfig({
  testDir,
  globalSetup: require.resolve('./features/support/global-setup'),
  reporter: [
    ['html', { outputFolder: '../reports/web-html' }],
    ['json', { outputFile: '../reports/web.json' }],
  ],
  use: {
    baseURL: process.env.WEB_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  webServer: process.env.WEB_BASE_URL
    ? undefined
    : {
        command: 'npm start',
        cwd: '../../dev/web',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
        env: {
          BROWSER: 'none',
          REACT_APP_API_URL: backendUrl,
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
