// GitHub sign-in (US-1) with PKCE between the DevRadar client and the backend (RFC 7636).
// Flow:
//   1. GET /auth/github?redirect=<client url>&code_challenge=<S256>&code_challenge_method=S256
//        -> 302 to GitHub with a single-use `state` (10 min)
//   2. GET /auth/github/callback?code&state
//        -> 302 to <client url>?code=<one-time code> (60 s)
//        -> 302 to <client url>?error=sign_in_cancelled on access_denied
//        -> 302 to <client url>?error=sign_in_failed&reason=<code> on any other failure
//   3. POST /auth/token { code, code_verifier } -> { token, token_type, expires_in, user }
//   4. GET /auth/me (Bearer token) -> { github_id, github_username, name, avatar_url }
// The session token never appears in a URL, the one-time code is only redeemable with the
// verifier of the client that started sign-in, and the GitHub access token is used once to
// read the identity and public profile, then dropped (never stored, logged or returned). The
// identity is GitHub's numeric account id (auth spec Q10) plus the login; the profile (name,
// avatar_url, bio) is signed into the session token as a snapshot as of sign-in; POST /devs
// registers new devs from it (utils/githubProfile.js). Completing a sign-in also gives the
// account's dev its current login, displacing any other dev that still shows it
// (services/devOwnership.js).
//
// JSON error bodies: { error, code, details }. See dev/docs/00-architecture.md for every code.
const { createOneTimeStore } = require('../utils/oneTimeStore');
const { isRedirectAllowed, buildRedirectUrl } = require('../utils/redirectAllowList');
const { signSessionToken } = require('../utils/sessionToken');
const { PKCE_METHOD, isValidCodeChallenge, verifyCodeVerifier } = require('../utils/pkce');
const { isGithubOAuthConfigured } = require('../config/auth');
const { refreshLoginAtSignIn } = require('../services/devOwnership');
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
// signInCodeStore payload: { githubId, githubUsername, loginReadAt, profile: { name, avatar_url, bio }, codeChallenge }
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
 * @param {{ status: number, reason?: string }} failure - from services/githubOAuth
 * @returns {string}
 */
function githubFailureReason(failure) {
  if (failure.reason) return failure.reason;
  return failure.status === 503 ? 'github_rate_limited' : 'github_unavailable';
}

/** Responses that carry one-time secrets must not be cached or leak via Referer. */
function noStore(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
}

/**
 * The signed-in user as clients see it (POST /auth/token `user`, GET /auth/me).
 * @param {{ github_id: number, github_username: string,
 *   profile: import('../utils/githubProfile').GithubProfile }} user
 * @returns {{ github_id: number, github_username: string, name: string | null, avatar_url: string | null }}
 */
function publicUser({ github_id, github_username, profile }) {
  return { github_id, github_username, name: profile.name, avatar_url: profile.avatar_url };
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

    const { id, login, profile } = identity.user;
    const signInCode = signInCodeStore.issue({
      githubId: id,
      githubUsername: login,
      // When GitHub said this login is this account's: orders login refreshes (QA-AUTH6-3).
      loginReadAt: Date.now(),
      profile,
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

    const user = {
      github_id: pending.githubId,
      github_username: pending.githubUsername,
      profile: pending.profile,
      login_read_at: pending.loginReadAt,
    };
    const { token, expiresIn } = signSessionToken(user);

    // GitHub's fresh answer is authoritative (auth spec Q10): a dev of another account still
    // showing this login is displaced, and this account's dev takes it (a renamed account shows
    // its new login, and frees its old one). Best effort: never fails the sign-in.
    await refreshLoginAtSignIn(user);

    return res.json({
      token,
      token_type: 'Bearer',
      expires_in: expiresIn,
      user: publicUser(user),
    });
  },

  // Answers from the token alone (no database or GitHub call), so clients can show who is signed
  // in after a reload. Values are the sign-in snapshot.
  async me(req, res) {
    return res.json(publicUser(req.user));
  },
};
