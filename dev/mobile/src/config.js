// App-wide constants. EXPO_PUBLIC_API_URL is inlined at build time (restart the bundler after
// changing it); nothing secret belongs here.

/** Backend base URL. */
export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3333';

/**
 * The app's custom URL scheme: its own applicationId / bundle identifier, reverse-domain as RFC
 * 8252 7.1 recommends for native OAuth redirects. Must equal "scheme" in app.json, the intent
 * filter in android/app/src/main/AndroidManifest.xml and the backend's MOBILE_APP_SCHEME
 * (dev/tests/mobile/config.test.js checks the first two).
 */
export const APP_SCHEME = 'com.matmss.mobile';

/** Where the backend sends the system auth session back to after GitHub sign-in. */
export const AUTH_REDIRECT_URI = `${APP_SCHEME}://auth/callback`;

/** Requests that take longer fail as "server unreachable" instead of spinning forever. */
export const REQUEST_TIMEOUT_MS = 15000;
