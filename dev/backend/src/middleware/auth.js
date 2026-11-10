// Bearer-token authentication (US-2). Applied to GET /devs, POST /devs, GET/PUT/DELETE /devs/me,
// GET /search and GET /auth/me (routes.js). The Socket.io handshake uses the same verifySessionToken and codes
// (websocket.js), with the token in the handshake `auth` payload instead of a header.
//
// 401 body: { error, code, details }. `code` is stable and lets clients tell the cases apart:
//   token_missing  no `Authorization: Bearer <token>` header
//   token_expired  a genuine DevRadar token past its 7-day expiry -> "Session expired, sign in again"
//   token_invalid  malformed, tampered with, signed with another key, or missing a required claim
//                  (e.g. issued before GitHub ids were captured: those clients sign in again once)
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
 * otherwise sets `req.user = { github_id, github_username, profile: { name, avatar_url, bio },
 * issued_at }` (GitHub's numeric account id, then the login and profile as of sign-in, and when
 * that sign-in happened) and continues.
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
