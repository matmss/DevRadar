// Test-only sign-in helpers shared by the step definitions. Every route that shows or changes
// devs needs a session token since auth slice 4 (GET /devs, POST /devs, GET /search and the
// Socket.io handshake, dev/docs/03-auth-spec.md Q1).
// Same copy dev/backend uses, so forged tokens are built exactly like real ones.
const jwt = require('../../../../dev/backend/node_modules/jsonwebtoken');
const { signSessionToken } = require('../../../../dev/backend/src/utils/sessionToken');
const { githubUserFixture, githubIdFor } = require('./github-mock');
const { TEST_JWT_SECRET } = require('./auth-config');

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
const OTHER_SECRET = 'some-other-secret-that-is-not-jwt-secret';

/**
 * A session token as POST /auth/token would issue it after GitHub sign-in: signed with the test
 * JWT_SECRET (auth-config.js), for the GitHub account `githubId` (default: the fixture's id for
 * the login, github-mock.js) with login `username` and the fixture's GitHub profile as the
 * sign-in snapshot.
 * @param {string} username
 * @param {number} [githubId]
 * @returns {string}
 */
function testSessionToken(username, githubId = githubIdFor(username)) {
  return signSessionToken({
    github_id: githubId,
    github_username: username,
    profile: githubUserFixture(username),
  }).token;
}

/**
 * The claims of a well-formed session token for `username`, without iat/exp.
 * @param {string} username
 * @returns {{ sub: string, login: string, iss: string, profile: object }}
 */
function wellFormedClaims(username) {
  const { name, avatar_url, bio } = githubUserFixture(username);
  return { sub: String(githubIdFor(username)), login: username, iss: 'devradar', profile: { name, avatar_url, bio } };
}

/**
 * A genuine DevRadar token (right secret and issuer) whose 7 days ended `hours` ago.
 * @param {string} username
 * @param {number} [hours]
 * @param {{ otherSecret?: boolean }} [options] - sign with a secret other than JWT_SECRET
 * @returns {string}
 */
function expiredSessionToken(username, hours = 1, { otherSecret = false } = {}) {
  const exp = Math.floor(Date.now() / 1000) - hours * 3600;
  return jwt.sign(
    { ...wellFormedClaims(username), iat: exp - SEVEN_DAYS_SECONDS, exp },
    otherSecret ? OTHER_SECRET : TEST_JWT_SECRET,
    { algorithm: 'HS256' }
  );
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

/**
 * A token every verifier must reject as token_invalid. `kind`:
 *  - tampered:       subject (account id) and login changed to bob's, original signature kept
 *  - foreign-signed: signed with a secret other than JWT_SECRET
 *  - alg-none:       unsigned token with header alg "none"
 *  - malformed:      not a JWT at all
 *  - profile-less:   correctly signed, no sign-in profile claim (tokens issued by slice 1)
 *  - forged-profile: correctly signed, profile claim not in the shape the backend signs
 *  - id-less:        correctly signed, as issued before auth slice 6: the subject is the login,
 *                    there is no GitHub id and no `login` claim
 *  - login-less:     correctly signed, the subject is an id but there is no `login` claim
 *  - non-canonical-id: correctly signed, the subject is "0810438" (a leading zero)
 * @param {string} kind
 * @returns {string}
 */
function forgedSessionToken(kind) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...wellFormedClaims('gaearon'), iat: now, exp: now + SEVEN_DAYS_SECONDS };
  const sign = (payload) => jwt.sign(payload, TEST_JWT_SECRET, { algorithm: 'HS256' });

  if (kind === 'tampered') {
    const [header, payload, signature] = testSessionToken('gaearon').split('.');
    const forged = { ...decodeJwtPart(payload), sub: String(githubIdFor('bob')), login: 'bob' };
    return [header, base64UrlJson(forged), signature].join('.');
  }
  if (kind === 'foreign-signed') return jwt.sign(claims, OTHER_SECRET, { algorithm: 'HS256' });
  if (kind === 'alg-none') return `${base64UrlJson({ alg: 'none', typ: 'JWT' })}.${base64UrlJson(claims)}.`;
  if (kind === 'malformed') return 'not-a-jwt';
  if (kind === 'profile-less') {
    const { profile, ...rest } = claims;
    return sign(rest);
  }
  if (kind === 'forged-profile') {
    return sign({ ...claims, profile: { name: 'Eve', avatar_url: 'javascript:alert(1)', bio: null } });
  }
  if (kind === 'id-less') {
    const { login, ...rest } = claims;
    return sign({ ...rest, sub: 'gaearon' });
  }
  if (kind === 'login-less') {
    const { login, ...rest } = claims;
    return sign(rest);
  }
  if (kind === 'non-canonical-id') return sign({ ...claims, sub: `0${claims.sub}` });
  throw new Error(`Unknown token kind: ${kind}`);
}

/**
 * Sends `Authorization: Bearer <world.sessionToken>` when a previous step signed in ("I am signed
 * in as", "I signed in through GitHub as", or a forged token from auth.steps.js); otherwise no
 * header, so scenarios can check the 401s.
 * @param {import('supertest').Test} req
 * @param {{ sessionToken?: string }} world
 * @returns {import('supertest').Test}
 */
function withSession(req, world) {
  return world.sessionToken ? req.set('Authorization', `Bearer ${world.sessionToken}`) : req;
}

module.exports = {
  SEVEN_DAYS_SECONDS,
  testSessionToken,
  expiredSessionToken,
  forgedSessionToken,
  decodeJwtPart,
  withSession,
};
