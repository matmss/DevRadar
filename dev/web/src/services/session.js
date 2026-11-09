// The DevRadar session token (a 7-day JWT from POST /auth/token), kept in localStorage so the
// session survives reloads and new tabs.
//
// Trade-off (XSS): any script running on this origin can read localStorage, so an XSS bug would
// let an attacker copy the token and act as the user until it expires (7 days, no server-side
// revocation). An httpOnly cookie would hide it from scripts, but the API is Bearer-token based
// (no cookies, so no CSRF surface) and the same API serves the mobile app. Mitigations: React
// escapes everything it renders, the app has no dangerouslySetInnerHTML and no third-party
// scripts, and the token carries no GitHub credentials (only the login and public profile).
// Serving the production build with a strict Content-Security-Policy is recommended.
const TOKEN_KEY = 'devradar.session_token';

/** @returns {string | null} */
export function getToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch (err) {
    // Storage can be disabled (privacy mode, blocked cookies): behave as signed out.
    console.warn('Session storage unavailable:', err.message);
    return null;
  }
}

/** @param {string} token */
export function saveToken(token) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch (err) {
    console.warn('Session storage unavailable:', err.message);
  }
}

export const SESSION_TOKEN_KEY = TOKEN_KEY;
