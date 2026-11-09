// PKCE (RFC 7636) between DevRadar clients and the backend (QA-AUTH-1). Each sign-in is bound
// to the client that started it: GET /auth/github takes a `code_challenge`, and POST
// /auth/token only redeems the one-time code with the matching `code_verifier`. A forwarded
// callback URL or an intercepted devradar:// redirect is useless without the verifier.
// Only S256 is accepted ("plain" offers no protection if the challenge leaks).
const crypto = require('crypto');

const PKCE_METHOD = 'S256';

// RFC 7636 4.2: a base64url S256 challenge. 43-128 chars, base64url alphabet, no padding.
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
// RFC 7636 4.1: code_verifier = 43*128 unreserved chars.
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidCodeChallenge(value) {
  return typeof value === 'string' && CODE_CHALLENGE_PATTERN.test(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidCodeVerifier(value) {
  return typeof value === 'string' && CODE_VERIFIER_PATTERN.test(value);
}

/**
 * @param {string} verifier
 * @returns {string} BASE64URL(SHA256(ASCII(verifier)))
 */
function s256Challenge(verifier) {
  return crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/**
 * Checks a code_verifier against the stored S256 challenge in constant time. Both sides are
 * hashed again first so the comparison runs on equal-length buffers whatever the inputs.
 * @param {unknown} verifier - from the token request
 * @param {string} challenge - stored when sign-in started
 * @returns {boolean}
 */
function verifyCodeVerifier(verifier, challenge) {
  if (!isValidCodeVerifier(verifier) || !isValidCodeChallenge(challenge)) return false;
  const digest = (value) => crypto.createHash('sha256').update(value, 'utf8').digest();
  return crypto.timingSafeEqual(digest(s256Challenge(verifier)), digest(challenge));
}

module.exports = {
  PKCE_METHOD,
  isValidCodeChallenge,
  isValidCodeVerifier,
  s256Challenge,
  verifyCodeVerifier,
};
