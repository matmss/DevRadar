// GitHub sign-in for the mobile app (dev/docs/03-auth-spec.md, US-7), using the backend's PKCE
// flow (dev/docs/00-architecture.md, Authentication):
//   1. make a verifier (kept in memory only) and its S256 challenge;
//   2. open <API_URL>/auth/github?redirect=com.matmss.mobile://auth/callback&code_challenge=...
//      in the system auth session (ASWebAuthenticationSession on iOS, Custom Tabs on Android);
//   3. GitHub -> backend -> com.matmss.mobile://auth/callback?code=<one-time code>
//      (or ?error=sign_in_cancelled | sign_in_failed&reason=...);
//   4. exchange { code, code_verifier } at POST /auth/token for the session token.
// The session token never appears in a URL. Expo Go cannot finish sign-in (its exp:// scheme is
// refused by the backend on purpose): use a development build (npm run android / ios).
import * as WebBrowser from 'expo-web-browser';

import api from './api';
import { API_URL, AUTH_REDIRECT_URI } from '../config';
import { createCodeVerifier, createCodeChallenge } from './pkce';
import { SIGN_IN_RESULT } from './authErrors';

// Backend `reason` values for sign_in_failed that get their own message. Only a lookup key,
// never rendered.
const KNOWN_FAILURE_REASONS = ['github_rate_limited', 'github_unavailable'];

/**
 * @param {string} challenge - the PKCE S256 code_challenge
 * @returns {string} the backend URL that starts GitHub sign-in
 */
export function buildSignInUrl(challenge) {
  const query = [
    ['redirect', AUTH_REDIRECT_URI],
    ['code_challenge', challenge],
    ['code_challenge_method', 'S256'],
  ].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  return `${API_URL.replace(/\/+$/, '')}/auth/github?${query}`;
}

/**
 * @param {string} value
 * @returns {string | null} null if the value is not valid percent-encoding
 */
function decodeQueryValue(value) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch (err) {
    console.warn('Ignoring a malformed sign-in callback parameter:', err.name);
    return null;
  }
}

/**
 * Reads the sign-in callback. Only URLs that are exactly our redirect URI plus a query or
 * fragment count (not e.g. ".../callbackX"). Parsed by hand: React Native's URL implementation
 * does not handle custom schemes reliably.
 * @param {unknown} url
 * @returns {{ code: string | null, error: string | null, reason: string | null } | null}
 *   null if `url` is not our callback
 */
export function parseCallbackUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(AUTH_REDIRECT_URI)) return null;
  const rest = url.slice(AUTH_REDIRECT_URI.length);
  if (rest !== '' && rest[0] !== '?' && rest[0] !== '#') return null;

  const params = Object.create(null); // no prototype: "__proto__" etc. are plain keys
  rest.split('#')[0].replace(/^\?/, '').split('&').filter(Boolean).forEach((pair) => {
    const [rawKey, ...rawValue] = pair.split('=');
    const key = decodeQueryValue(rawKey);
    const value = decodeQueryValue(rawValue.join('='));
    if (key !== null && value !== null && !(key in params)) params[key] = value;
  });

  return { code: params.code || null, error: params.error || null, reason: params.reason || null };
}

/**
 * @typedef {{ github_id: number, github_username: string, name: string | null, avatar_url: string | null }} SignedInUser
 * @typedef {{ ok: true, token: string, user: SignedInUser }
 *   | { ok: false, error: string, reason?: string }} SignInResult
 */

/**
 * Runs the whole sign-in. Never throws; failures come back as `{ ok: false }`.
 * @param {{ openAuthSession?: typeof WebBrowser.openAuthSessionAsync }} [deps] - for tests
 * @returns {Promise<SignInResult>}
 */
export async function signInWithGithub({ openAuthSession = WebBrowser.openAuthSessionAsync } = {}) {
  let verifier;
  let result;
  try {
    verifier = createCodeVerifier();
    const challenge = await createCodeChallenge(verifier);
    result = await openAuthSession(buildSignInUrl(challenge), AUTH_REDIRECT_URI);
  } catch (err) {
    console.warn('Could not start sign-in:', err.message);
    return { ok: false, error: SIGN_IN_RESULT.FAILED };
  }

  // "cancel" / "dismiss": the user closed the browser before finishing.
  if (!result || result.type !== 'success') return { ok: false, error: SIGN_IN_RESULT.CANCELLED };

  const callback = parseCallbackUrl(result.url);
  if (callback && callback.error === SIGN_IN_RESULT.CANCELLED) {
    return { ok: false, error: SIGN_IN_RESULT.CANCELLED };
  }
  if (!callback || callback.error || !callback.code) {
    const reason = callback && KNOWN_FAILURE_REASONS.includes(callback.reason) ? callback.reason : undefined;
    return { ok: false, error: SIGN_IN_RESULT.FAILED, reason };
  }

  try {
    const response = await api.post('/auth/token', { code: callback.code, code_verifier: verifier });
    return { ok: true, token: response.data.token, user: response.data.user };
  } catch (err) {
    console.warn('Sign-in code exchange failed:', err.response ? err.response.status : err.message);
    return { ok: false, error: SIGN_IN_RESULT.FAILED };
  }
}

/**
 * Asks the backend who the session token belongs to. A rejected token ends the session through
 * the api interceptor (services/api.js).
 * @returns {Promise<SignedInUser>}
 */
export async function fetchCurrentUser() {
  const response = await api.get('/auth/me');
  return response.data;
}
