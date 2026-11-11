// GitHub sign-in for the web app (dev/docs/03-auth-spec.md, US-6), using the backend's PKCE
// flow (dev/docs/00-architecture.md, Authentication):
//   1. startSignIn(): make a verifier, keep it in sessionStorage, go to
//      <API_URL>/auth/github?redirect=<origin>/auth/callback&code_challenge=...&code_challenge_method=S256
//   2. GitHub -> backend -> back to /auth/callback?code=<one-time code> (or ?error=...&reason=...)
//   3. completeSignIn(): exchange the code + verifier at POST /auth/token for the session token.
// The session token never appears in a URL. Nothing read from the callback URL is used as a
// navigation target: after the callback the app always returns to the fixed HOME_PATH.
import api, { API_URL } from './api';
import { createCodeVerifier, createCodeChallenge, isPkceSupported } from './pkce';

export const CALLBACK_PATH = '/auth/callback';
const HOME_PATH = '/';
const VERIFIER_KEY = 'devradar.pkce_verifier';

// Stable result codes the UI maps to messages (App.js).
export const SIGN_IN_RESULT = {
  CANCELLED: 'sign_in_cancelled',
  FAILED: 'sign_in_failed',
};

// Backend `reason` values for sign_in_failed that get their own message; anything else is shown
// as a generic failure. The reason is only ever used as a lookup key, never rendered.
const KNOWN_FAILURE_REASONS = ['github_rate_limited', 'github_unavailable'];

/** @returns {string} the absolute callback URL the backend redirects back to */
export function callbackUrl() {
  return `${window.location.origin}${CALLBACK_PATH}`;
}

/** @returns {boolean} true if the current page is the sign-in callback */
export function isSignInCallback() {
  return window.location.pathname === CALLBACK_PATH;
}

/**
 * Starts GitHub sign-in by leaving the app for the backend's /auth/github.
 * @returns {Promise<void>}
 */
export async function startSignIn() {
  if (!isPkceSupported()) {
    throw new Error('This browser cannot sign in securely (Web Crypto unavailable; use https)');
  }
  const verifier = createCodeVerifier();
  const challenge = await createCodeChallenge(verifier);
  window.sessionStorage.setItem(VERIFIER_KEY, verifier);

  const url = new URL('/auth/github', API_URL);
  url.searchParams.set('redirect', callbackUrl());
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  window.location.assign(url.toString());
}

/**
 * @typedef {{ github_id: number, github_username: string, name: string | null, avatar_url: string | null }} SignedInUser
 * @typedef {{ ok: true, token: string, user: SignedInUser } | { ok: false, error: string, reason?: string }} SignInResult
 */

/**
 * Finishes sign-in on the callback page. The code and the verifier are single use, so both
 * leave the URL and sessionStorage before the exchange starts (also makes a second call, e.g.
 * a re-run effect, a no-op that reports a failure instead of spending anything).
 * @returns {Promise<SignInResult>}
 */
export async function completeSignIn() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  const reason = params.get('reason');
  const verifier = window.sessionStorage.getItem(VERIFIER_KEY);

  window.history.replaceState(null, '', HOME_PATH);
  window.sessionStorage.removeItem(VERIFIER_KEY);

  if (error === SIGN_IN_RESULT.CANCELLED) {
    return { ok: false, error: SIGN_IN_RESULT.CANCELLED };
  }
  if (error || !code || !verifier) {
    return {
      ok: false,
      error: SIGN_IN_RESULT.FAILED,
      reason: KNOWN_FAILURE_REASONS.includes(reason) ? reason : undefined,
    };
  }

  try {
    const response = await api.post('/auth/token', { code, code_verifier: verifier });
    return { ok: true, token: response.data.token, user: response.data.user };
  } catch (err) {
    console.warn('Sign-in code exchange failed:', err.response ? err.response.status : err.message);
    return { ok: false, error: SIGN_IN_RESULT.FAILED };
  }
}

/**
 * Asks the backend who the stored session token belongs to. A rejected token ends the session
 * through the api interceptor (services/api.js).
 * @returns {Promise<SignedInUser>}
 */
export async function fetchCurrentUser() {
  const response = await api.get('/auth/me');
  return response.data;
}
