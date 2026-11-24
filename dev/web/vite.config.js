import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server (`npm start`) and `npm run preview` listen on 127.0.0.1:3000 only. Never `::` or
// 0.0.0.0: on macOS another process can bind 127.0.0.1 on a port a wildcard server holds and
// answer instead of it (BUG-013, qa/docs/05-bug-tracker.md), and the QA web harness dials
// http://127.0.0.1:3000 (qa/web-tests/playwright.config.js). strictPort makes a busy port fail
// the start instead of moving to 3001, an origin the backend's CORS_ORIGINS does not allow.
// Both servers answer unknown paths with index.html (Vite's default `appType: 'spa'`), so the
// GitHub sign-in callback /auth/callback loads the app.
const LOOPBACK_SERVER = { host: '127.0.0.1', port: 3000, strictPort: true, open: false };

export default defineConfig({
  plugins: [react()],
  server: LOOPBACK_SERVER,
  preview: LOOPBACK_SERVER,
  build: {
    // release.yml zips dev/web/build (with public/ copied into it), as with Create React App.
    outDir: 'build',
    // Kept from CRA's production browserslist (">0.2%, not dead, not op_mini all"), which
    // resolved on 2026-11-23 to Chrome 109 at the oldest (last release for Windows 7/8),
    // iOS Safari 16.6, Safari 17.6, Firefox 157 and Edge 154. Vite reads no browserslist for
    // JavaScript, so the floor is pinned here, at or below each of those. Syntax is lowered to
    // it; neither CRA nor Vite adds API polyfills. See dev/docs/00-architecture.md, Web.
    target: ['chrome109', 'edge109', 'firefox115', 'safari16.6', 'ios16.6'],
  },
  test: {
    environment: 'jsdom',
    // describe/it/expect/beforeEach as globals, like Jest, so the tests only swap jest.* for vi.*;
    // it also lets React Testing Library unmount after each test by itself.
    globals: true,
    setupFiles: ['./src/setupTests.js'],
    include: ['src/**/*.test.{js,jsx}'],
  },
});
