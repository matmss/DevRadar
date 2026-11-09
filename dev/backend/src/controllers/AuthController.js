// GitHub sign-in (US-1). Flow:
//   1. GET /auth/github?redirect=<client url>  -> 302 to GitHub with a single-use `state`
//   2. GET /auth/github/callback?code&state     -> 302 to <client url>?code=<one-time code>
//                                                  (or ?error=sign_in_cancelled on access_denied)
//   3. POST /auth/token { code }                -> { token, token_type, expires_in, user }
//   4. GET /auth/me (Bearer token)              -> { github_username }
// The session token never appears in a URL, and the GitHub access token is used once to read
// the identity, then dropped (never stored, logged or returned).
//
// Error bodies: { error, code, details }. `code` values: not_configured, redirect_invalid,
// state_missing, state_invalid, github_code_missing, github_error, github_unavailable,
// github_rate_limited, code_missing, code_invalid (plus token_* from middleware/auth.js and
// rate_limited from middleware/rateLimit.js).
const { createOneTimeStore } = require('../utils/oneTimeStore');
const { isRedirectAllowed, buildRedirectUrl } = require('../utils/redirectAllowList');
const { signSessionToken } = require('../utils/sessionToken');
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

// In-memory, per process: see the multi-instance note in utils/oneTimeStore.js.
// stateStore payload: { redirect }. signInCodeStore payload: { github_username, name, avatar_url }.
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
 * @param {import('express').Response} res
 * @param {{ status: number, error: string, details: string[] }} failure - from services/githubOAuth
 */
function sendGithubFailure(res, failure) {
  const code = failure.status === 503 ? 'github_rate_limited' : 'github_unavailable';
  return sendError(res, failure.status, code, failure.error, failure.details);
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

    const { redirect } = req.query;
    if (!isNonEmptyString(redirect)) {
      return sendError(res, 400, 'redirect_invalid', 'Invalid redirect', ['redirect is required']);
    }
    if (!isRedirectAllowed(redirect)) {
      return sendError(res, 400, 'redirect_invalid', 'Invalid redirect', ['redirect is not an allowed client URL']);
    }

    const state = stateStore.issue({ redirect });
    noStore(res);
    return res.redirect(302, buildAuthorizeUrl(state));
  },

  async callback(req, res) {
    const { state, code, error } = req.query;

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
      return sendError(res, 502, 'github_error', 'GitHub sign-in failed', [`GitHub returned ${githubError}`]);
    }

    if (!isNonEmptyString(code)) {
      return sendError(res, 400, 'github_code_missing', 'Missing authorization code', ['code is required']);
    }

    const exchanged = await exchangeCodeForToken(code);
    if (!exchanged.accessToken) return sendGithubFailure(res, exchanged);

    const identity = await fetchAuthenticatedUser(exchanged.accessToken);
    if (!identity.user) return sendGithubFailure(res, identity);

    const { login, name, avatar_url } = identity.user;
    const signInCode = signInCodeStore.issue({ github_username: login, name, avatar_url });
    return res.redirect(302, buildRedirectUrl(attempt.redirect, { code: signInCode }));
  },

  async token(req, res) {
    const { code } = req.body || {};
    res.set('Cache-Control', 'no-store');

    if (!isNonEmptyString(code)) {
      return sendError(res, 400, 'code_missing', 'Invalid sign-in code', ['code is required']);
    }
    const identity = signInCodeStore.consume(code);
    if (!identity) {
      return sendError(res, 400, 'code_invalid', 'Invalid sign-in code', [
        'code is unknown, expired or already used; sign in again',
      ]);
    }

    const { token, expiresIn } = signSessionToken(identity.github_username);
    return res.json({
      token,
      token_type: 'Bearer',
      expires_in: expiresIn,
      user: identity,
    });
  },

  async me(req, res) {
    return res.json({ github_username: req.user.github_username });
  },
};
