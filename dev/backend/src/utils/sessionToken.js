// DevRadar session tokens: HS256-signed JWTs, subject = GitHub login, valid 7 days (Q3, no
// refresh token). Tokens carry no GitHub credentials.
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/auth');
const { isValidGithubUsername } = require('./githubUsername');

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
 * @param {string} githubUsername - the GitHub login the session belongs to
 * @returns {{ token: string, expiresIn: number }}
 */
function signSessionToken(githubUsername) {
  const token = jwt.sign({}, jwtSecret(), {
    algorithm: ALGORITHM,
    expiresIn: SESSION_TTL_SECONDS,
    issuer: ISSUER,
    subject: githubUsername,
  });
  return { token, expiresIn: SESSION_TTL_SECONDS };
}

/**
 * Verifies a raw session token without throwing. Reusable outside Express (e.g. the Socket.io
 * handshake). The signature is checked before expiry, so only a genuinely signed token can be
 * reported as expired; anything malformed, tampered with or signed with another key is invalid.
 * @param {unknown} token
 * @param {{ nowSeconds?: number }} [options] - override the clock (tests)
 * @returns {{ ok: true, user: { github_username: string } } | { ok: false, code: string }}
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

  if (!claims || !isValidGithubUsername(claims.sub) || typeof claims.exp !== 'number') {
    return { ok: false, code: TOKEN_ERROR.INVALID };
  }
  return { ok: true, user: { github_username: claims.sub } };
}

module.exports = { signSessionToken, verifySessionToken, TOKEN_ERROR, SESSION_TTL_SECONDS, ISSUER };
