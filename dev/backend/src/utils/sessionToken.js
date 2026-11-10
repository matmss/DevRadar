// DevRadar session tokens: HS256-signed JWTs, valid 7 days (Q3, no refresh token). Tokens carry
// no GitHub credentials.
//
// Claims:
//   sub      GitHub's numeric user id, as a decimal string (auth spec Q10). The id is what a
//            DevRadar profile belongs to: unlike the login it is never reassigned, which is exactly
//            what RFC 7519 asks of a subject.
//   login    the GitHub login at sign-in: display data, and how a legacy profile (created before
//            sign-in existed, without an id) is matched case-insensitively (Q5).
//   profile  the public profile captured at sign-in ({ name, avatar_url, bio }, see
//            utils/githubProfile.js). POST /devs creates a new dev from it, PUT /devs/me refreshes
//            the dev from it, and GET /auth/me returns it.
//   login_read_at
//            when GitHub's GET /user said `login` belongs to `sub` (ms since the epoch, at the
//            sign-in callback, up to the one-time code's 60 s before iat). It orders logins: a
//            dev's stored login never changes to one read earlier than its current state
//            (services/devOwnership.js), so an old token cannot set back a rename (QA-AUTH6-3).
//   iss, iat, exp
// All are required. A token without them is token_invalid, so its client signs in again once:
// that includes every token issued before ids were captured (their `sub` is a login and they
// have no `login` claim), and those issued before the profile claim existed.
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/auth');
const { isValidGithubUsername } = require('./githubUsername');
const { isValidGithubId, githubIdToSubject, githubIdFromSubject } = require('./githubId');
const { sanitizeGithubProfile, isSanitizedGithubProfile } = require('./githubProfile');

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ISSUER = 'devradar';
const ALGORITHM = 'HS256';

// Stable codes clients can switch on (also used in 401 bodies, see middleware/auth.js).
const TOKEN_ERROR = {
  MISSING: 'token_missing',
  EXPIRED: 'token_expired',
  INVALID: 'token_invalid',
};

/**
 * The signed-in user (req.user, socket.data.user). `login_read_at` is when GitHub said the login
 * is this account's (ms since the epoch): of two reads, the later one has the newer login, which
 * is how a dev's stored login is never set back by an older session (services/devOwnership.js).
 * @typedef {{ github_id: number, github_username: string,
 *   profile: import('./githubProfile').GithubProfile, login_read_at: number }} SessionUser
 */

/**
 * @param {{ github_id: number, github_username: string, login_read_at?: number,
 *   profile?: { name?: unknown, avatar_url?: unknown, bio?: unknown } }} user - the GitHub account
 *   that signed in (id and login from GET /user, read at `login_read_at`, default now) and its
 *   profile, which is sanitized and length-limited here (missing values become null)
 * @returns {{ token: string, expiresIn: number, loginReadAt: number }}
 * @throws {TypeError} if the id, the login or the read time is not valid (callers validate
 *   GitHub's answer first)
 */
function signSessionToken({ github_id, github_username, profile, login_read_at: readAt = Date.now() }) {
  if (!isValidGithubId(github_id)) throw new TypeError('github_id must be a positive safe integer');
  if (!isValidGithubUsername(github_username)) throw new TypeError('github_username must be a GitHub login');

  const issuedAt = Math.floor(Date.now() / 1000);
  if (!isValidReadTime(readAt, issuedAt)) throw new TypeError('login_read_at must be a time before now');
  const claims = {
    login: github_username,
    login_read_at: readAt,
    profile: sanitizeGithubProfile(profile),
    iat: issuedAt,
  };
  const token = jwt.sign(claims, jwtSecret(), {
    algorithm: ALGORITHM,
    expiresIn: SESSION_TTL_SECONDS,
    issuer: ISSUER,
    subject: githubIdToSubject(github_id),
  });
  return { token, expiresIn: SESSION_TTL_SECONDS, loginReadAt: readAt };
}

/**
 * @param {unknown} readAt - ms since the epoch
 * @param {unknown} issuedAt - the token's iat, seconds
 * @returns {boolean} true for a positive integer time no later than the token's issue (GitHub is
 *   read at the callback, before the code is redeemed)
 */
function isValidReadTime(readAt, issuedAt) {
  return Number.isSafeInteger(readAt) && readAt > 0
    && Number.isSafeInteger(issuedAt) && readAt < (issuedAt + 1) * 1000;
}

/**
 * Verifies a raw session token without throwing. Reusable outside Express (e.g. the Socket.io
 * handshake). The signature is checked before expiry, so only a genuinely signed token can be
 * reported as expired; anything malformed, tampered with or signed with another key is invalid.
 * @param {unknown} token
 * @param {{ nowSeconds?: number }} [options] - override the clock (tests)
 * @returns {{ ok: true, user: SessionUser } | { ok: false, code: string }}
 */
function verifySessionToken(token, { nowSeconds } = {}) {
  if (typeof token !== 'string' || token === '') return { ok: false, code: TOKEN_ERROR.MISSING };

  let claims;
  try {
    claims = jwt.verify(token, jwtSecret(), {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      clockTimestamp: nowSeconds,
    });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) return { ok: false, code: TOKEN_ERROR.EXPIRED };
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.NotBeforeError) {
      return { ok: false, code: TOKEN_ERROR.INVALID };
    }
    throw err;
  }

  const githubId = claims ? githubIdFromSubject(claims.sub) : null;
  if (githubId === null || !isValidGithubUsername(claims.login) || typeof claims.exp !== 'number'
    || !isValidReadTime(claims.login_read_at, claims.iat) || !isSanitizedGithubProfile(claims.profile)) {
    return { ok: false, code: TOKEN_ERROR.INVALID };
  }
  const { name, avatar_url, bio } = claims.profile;
  return {
    ok: true,
    user: {
      github_id: githubId,
      github_username: claims.login,
      profile: { name, avatar_url, bio },
      login_read_at: claims.login_read_at,
    },
  };
}

module.exports = { signSessionToken, verifySessionToken, TOKEN_ERROR, SESSION_TTL_SECONDS, ISSUER };
