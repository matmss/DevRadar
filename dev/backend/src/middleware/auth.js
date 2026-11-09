// Bearer-token authentication (US-2). Applied to POST /devs and GET /auth/me; GET /devs,
// GET /search and the socket follow in slice 4 (dev/docs/03-auth-spec.md "Delivery order").
//
// 401 body: { error, code, details }. `code` is stable and lets clients tell the cases apart:
//   token_missing  no `Authorization: Bearer <token>` header
//   token_expired  a genuine DevRadar token past its 7-day expiry -> "Session expired, sign in again"
//   token_invalid  malformed, tampered with, or signed with another key
const { verifySessionToken, TOKEN_ERROR } = require('../utils/sessionToken');

const BEARER_PATTERN = /^Bearer[ ]+(\S+)[ ]*$/i;

const UNAUTHORIZED = {
  [TOKEN_ERROR.MISSING]: {
    error: 'Authentication required',
    details: ['Send an Authorization: Bearer <token> header'],
    challenge: 'Bearer realm="devradar"',
  },
  [TOKEN_ERROR.EXPIRED]: {
    error: 'Session expired, sign in again',
    details: ['The session token has expired'],
    challenge: 'Bearer realm="devradar", error="invalid_token", error_description="token expired"',
  },
  [TOKEN_ERROR.INVALID]: {
    error: 'Invalid session token',
    details: ['The session token is malformed or its signature is invalid'],
    challenge: 'Bearer realm="devradar", error="invalid_token", error_description="token invalid"',
  },
};

/**
 * Extracts the token from an `Authorization: Bearer <token>` header value.
 * @param {unknown} header
 * @returns {string | null}
 */
function readBearerToken(header) {
  if (typeof header !== 'string') return null;
  const match = BEARER_PATTERN.exec(header);
  return match ? match[1] : null;
}

/**
 * Express middleware: rejects the request with 401 unless it carries a valid session token,
 * otherwise sets `req.user = { github_username, profile: { name, avatar_url, bio } }` (the
 * sign-in snapshot from the token) and continues.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function requireAuth(req, res, next) {
  const token = readBearerToken(req.headers.authorization);
  const result = token === null ? { ok: false, code: TOKEN_ERROR.MISSING } : verifySessionToken(token);

  if (!result.ok) {
    const { error, details, challenge } = UNAUTHORIZED[result.code];
    res.set('WWW-Authenticate', challenge);
    res.status(401).json({ error, code: result.code, details });
    return;
  }

  req.user = result.user;
  next();
}

module.exports = { requireAuth, readBearerToken, verifyToken: verifySessionToken, TOKEN_ERROR };
