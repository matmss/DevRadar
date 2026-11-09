// GitHub sign-in (US-1) with PKCE between the DevRadar client and the backend (RFC 7636).
// Flow:
//   1. GET /auth/github?redirect=<client url>&code_challenge=<S256>&code_challenge_method=S256
//        -> 302 to GitHub with a single-use `state` (10 min)
//   2. GET /auth/github/callback?code&state
//        -> 302 to <client url>?code=<one-time code> (60 s)
//        -> 302 to <client url>?error=sign_in_cancelled on access_denied
//        -> 302 to <client url>?error=sign_in_failed&reason=<code> on any other failure
//   3. POST /auth/token { code, code_verifier } -> { token, token_type, expires_in, user }
//   4. GET /auth/me (Bearer token) -> { github_username }
// The session token never appears in a URL, the one-time code is only redeemable with the
// verifier of the client that started sign-in, and the GitHub access token is used once to
// read the identity, then dropped (never stored, logged or returned).
//
// JSON error bodies: { error, code, details }. See dev/docs/00-architecture.md for every code.
const { createOneTimeStore } = require('../utils/oneTimeStore');
const { isRedirectAllowed, buildRedirectUrl } = require('../utils/redirectAllowList');
const { signSessionToken } = require('../utils/sessionToken');
const { PKCE_METHOD, isValidCodeChallenge, verifyCodeVerifier } = require('../utils/pkce');
const { isGithubOAuthConfigured } = require('../config/auth');
const {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchAuthenticatedUser,
  safeErrorCode,
} = require('../services/githubOAuth');

const STATE_TTL_MS = 10 * 60 * 1000;
const SIGN_IN_CODE_TTL_MS = 60 * 1000;
const SIGN_IN_CANCELLED = 'sign_in_cancelled';
const SIGN_IN_FAILED = 'sign_in_failed';

// In-memory, per process: see the multi-instance note in utils/oneTimeStore.js.
// stateStore payload:      { redirect, codeChallenge }
// signInCodeStore payload: { user: { github_username, name, avatar_url }, codeChallenge }
const stateStore = createOneTimeStore({ ttlMs: STATE_TTL_MS });
const signInCodeStore = createOneTimeStore({ ttlMs: SIGN_IN_CODE_TTL_MS });

/**
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} error
 * @param {string[]} details
 */
function sendError(res, status, code, error, details) {
  return res.status(status).json({ error, code, details });
}

/**
 * Sends the browser back to the client after a failure that happened once the state (and so
 * the client's redirect) was known. `reason` is a stable code, safe to put in a URL.
 * @param {import('express').Response} res
 * @param {string} redirect - the allow-listed target stored with the state
 * @param {string} reason
 */
function redirectFailure(res, redirect, reason) {
  return res.redirect(302, buildRedirectUrl(redirect, { error: SIGN_IN_FAILED, reason }));
}

/**
 * @param {{ status: number }} failure - from services/githubOAuth
 * @returns {string}
 */
function githubFailureReason(failure) {
  return failure.status === 503 ? 'github_rate_limited' : 'github_unavailable';
}

/** Responses that carry one-time secrets must not be cached or leak via Referer. */
function noStore(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

module.exports = {
  async start(req, res) {
    if (!isGithubOAuthConfigured()) {
      return sendError(res, 503, 'not_configured', 'GitHub sign-in is not configured', [
        'GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set on the backend',
      ]);
    }

    const { redirect, code_challenge: codeChallenge, code_challenge_method: method } = req.query;
    if (!isNonEmptyString(redirect)) {
      return sendError(res, 400, 'redirect_invalid', 'Invalid redirect', ['redirect is required']);
    }
    if (!isRedirectAllowed(redirect)) {
      return sendError(res, 400, 'redirect_invalid', 'Invalid redirect', ['redirect is not an allowed client URL']);
    }
    if (!isValidCodeChallenge(codeChallenge)) {
      return sendError(res, 400, 'code_challenge_invalid', 'Invalid PKCE challenge', [
        'code_challenge is required: BASE64URL(SHA256(code_verifier)), 43-128 characters',
      ]);
    }
    if (method !== PKCE_METHOD) {
      return sendError(res, 400, 'code_challenge_method_invalid', 'Invalid PKCE challenge', [
        `code_challenge_method must be ${PKCE_METHOD}`,
      ]);
    }

    const state = stateStore.issue({ redirect, codeChallenge });
    noStore(res);
    return res.redirect(302, buildAuthorizeUrl(state));
  },

  async callback(req, res) {
    const { state, code, error } = req.query;

    // Until the state is verified the redirect target is unknown, so these answer JSON.
    if (!isNonEmptyString(state)) {
      return sendError(res, 400, 'state_missing', 'Invalid sign-in state', ['state is required']);
    }
    const attempt = stateStore.consume(state);
    if (!attempt) {
      return sendError(res, 400, 'state_invalid', 'Invalid sign-in state', [
        'state is unknown, expired or already used; start the sign-in again',
      ]);
    }

    noStore(res);

    if (error !== undefined) {
      const githubError = safeErrorCode(error);
      if (githubError === 'access_denied') {
        return res.redirect(302, buildRedirectUrl(attempt.redirect, { error: SIGN_IN_CANCELLED }));
      }
      console.error(`GitHub sign-in callback returned an error: ${githubError}`);
      return redirectFailure(res, attempt.redirect, 'github_error');
    }

    if (!isNonEmptyString(code)) {
      return redirectFailure(res, attempt.redirect, 'github_code_missing');
    }

    const exchanged = await exchangeCodeForToken(code);
    if (!exchanged.accessToken) return redirectFailure(res, attempt.redirect, githubFailureReason(exchanged));

    const identity = await fetchAuthenticatedUser(exchanged.accessToken);
    if (!identity.user) return redirectFailure(res, attempt.redirect, githubFailureReason(identity));

    const { login, name, avatar_url } = identity.user;
    const signInCode = signInCodeStore.issue({
      user: { github_username: login, name, avatar_url },
      codeChallenge: attempt.codeChallenge,
    });
    return res.redirect(302, buildRedirectUrl(attempt.redirect, { code: signInCode }));
  },

  async token(req, res) {
    const { code, code_verifier: codeVerifier } = req.body || {};
    res.set('Cache-Control', 'no-store');

    if (!isNonEmptyString(code)) {
      return sendError(res, 400, 'code_missing', 'Invalid sign-in code', ['code is required']);
    }
    // Consumed before the verifier is checked: a wrong or missing verifier burns the code,
    // so it cannot be retried or brute-forced.
    const pending = signInCodeStore.consume(code);
    if (!pending) {
      return sendError(res, 400, 'code_invalid', 'Invalid sign-in code', [
        'code is unknown, expired or already used; sign in again',
      ]);
    }
    if (codeVerifier === undefined || codeVerifier === '') {
      return sendError(res, 400, 'code_verifier_missing', 'Invalid PKCE verifier', [
        'code_verifier is required; the sign-in code is now spent, sign in again',
      ]);
    }
    if (!verifyCodeVerifier(codeVerifier, pending.codeChallenge)) {
      return sendError(res, 400, 'code_verifier_invalid', 'Invalid PKCE verifier', [
        'code_verifier does not match the code_challenge; the sign-in code is now spent, sign in again',
      ]);
    }

    const { token, expiresIn } = signSessionToken(pending.user.github_username);
    return res.json({
      token,
      token_type: 'Bearer',
      expires_in: expiresIn,
      user: pending.user,
    });
  },

  async me(req, res) {
    return res.json({ github_username: req.user.github_username });
  },
};
