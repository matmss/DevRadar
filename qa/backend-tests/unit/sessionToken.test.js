const jwt = require('../../../dev/backend/node_modules/jsonwebtoken');
const {
  signSessionToken,
  verifySessionToken,
  TOKEN_ERROR,
  SESSION_TTL_SECONDS,
} = require('../../../dev/backend/src/utils/sessionToken');

const SECRET = 'unit-test-secret-unit-test-secret';
const PROFILE = {
  name: 'Dan Abramov',
  avatar_url: 'https://avatars.githubusercontent.com/u/810438?v=4',
  bio: 'Working on React',
};
const SEVEN_DAYS = 7 * 24 * 60 * 60;

function decode(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

describe('session tokens', () => {
  const original = { secret: process.env.JWT_SECRET, env: process.env.NODE_ENV };
  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
  });
  afterAll(() => {
    if (original.secret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original.secret;
  });

  it('signs an HS256 JWT whose subject is the GitHub login, valid 7 days', () => {
    const { token, expiresIn } = signSessionToken('gaearon');
    const [header, payload] = token.split('.');

    expect(expiresIn).toBe(SEVEN_DAYS);
    expect(SESSION_TTL_SECONDS).toBe(SEVEN_DAYS);
    expect(decode(header).alg).toBe('HS256');
    const claims = decode(payload);
    expect(claims.sub).toBe('gaearon');
    expect(claims.iss).toBe('devradar');
    expect(claims.exp - claims.iat).toBe(SEVEN_DAYS);
  });

  it('round-trips a valid token to the login and the sign-in profile', () => {
    const { token } = signSessionToken('Gaearon', PROFILE);
    expect(verifySessionToken(token)).toEqual({ ok: true, user: { github_username: 'Gaearon', profile: PROFILE } });
  });

  it('signs the sanitized profile as the `profile` claim, never extra fields', () => {
    const { token } = signSessionToken('gaearon', {
      ...PROFILE,
      bio: 'b'.repeat(1000),
      access_token: 'gho_must_not_be_signed',
      email: 'dan@example.com',
    });
    const claims = decode(token.split('.')[1]);
    expect(Object.keys(claims.profile).sort()).toEqual(['avatar_url', 'bio', 'name']);
    expect(claims.profile.bio).toHaveLength(160);
    expect(token).not.toContain('gho_must_not_be_signed');
    expect(JSON.stringify(claims)).not.toContain('gho_must_not_be_signed');
    expect(JSON.stringify(claims)).not.toContain('dan@example.com');
  });

  // The mobile app (auth slice 4) keeps the token in expo-secure-store, whose values are limited
  // to 2048 bytes. Worst case: the longest login, and every profile field at its byte cap with
  // the most expensive characters (4-byte emoji, JSON-escaped quotes and backslashes).
  it('keeps a worst-case token well under the 2048-byte secure-store limit', () => {
    const SECURE_STORE_LIMIT = 2048;
    const emoji = String.fromCodePoint(0x1f600);
    const longestLogin = `a${'-b'.repeat(19)}`; // 39 characters, GitHub's maximum
    const avatar = `https://avatars.githubusercontent.com/u/1?v=4&p=${'x'.repeat(240)}`;
    const fillers = [emoji, '"', '\\', 'a', `${emoji}"`];
    const sizes = [];
    fillers.forEach((nameFill) => fillers.forEach((bioFill) => {
      const { token } = signSessionToken(longestLogin, {
        name: nameFill.repeat(2000),
        bio: bioFill.repeat(2000),
        avatar_url: avatar,
      });
      expect(verifySessionToken(token).ok).toBe(true);
      sizes.push(Buffer.byteLength(token, 'utf8'));
    }));
    expect(longestLogin).toHaveLength(39);
    expect(verifySessionToken(signSessionToken(longestLogin, { avatar_url: avatar }).token).user.profile.avatar_url)
      .toBe(avatar);
    expect(Math.max(...sizes)).toBeLessThan(1600);
    expect(Math.max(...sizes)).toBeLessThan(SECURE_STORE_LIMIT);
  });

  it('signs an all-null profile when none is given', () => {
    const { token } = signSessionToken('gaearon');
    expect(verifySessionToken(token).user.profile).toEqual({ name: null, avatar_url: null, bio: null });
  });

  it('rejects a correctly signed token without a well-formed profile claim as invalid', () => {
    const now = Math.floor(Date.now() / 1000);
    const base = { sub: 'gaearon', iss: 'devradar', exp: now + 60 };
    [
      undefined,
      null,
      'Dan Abramov',
      [],
      { name: 'Dan' },
      { ...PROFILE, extra: 'x' },
      { ...PROFILE, avatar_url: 'javascript:alert(1)' },
      { ...PROFILE, name: ' padded ' },
      { ...PROFILE, bio: 'b'.repeat(301) },
      { ...PROFILE, name: 42 },
    ].forEach((profile) => {
      const token = jwt.sign(profile === undefined ? base : { ...base, profile }, SECRET);
      expect(verifySessionToken(token)).toEqual({ ok: false, code: TOKEN_ERROR.INVALID });
    });
  });

  it('is still valid just before 7 days, expired just after', () => {
    const { token } = signSessionToken('gaearon');
    const { iat } = decode(token.split('.')[1]);
    expect(verifySessionToken(token, { nowSeconds: iat + SEVEN_DAYS - 1 }).ok).toBe(true);
    expect(verifySessionToken(token, { nowSeconds: iat + SEVEN_DAYS })).toEqual({ ok: false, code: TOKEN_ERROR.EXPIRED });
  });

  it.each([undefined, null, '', 123])('reports a missing token for %p', (token) => {
    expect(verifySessionToken(token)).toEqual({ ok: false, code: TOKEN_ERROR.MISSING });
  });

  it('rejects a token whose payload was changed as invalid', () => {
    const [header, payload, signature] = signSessionToken('gaearon').token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...decode(payload), sub: 'bob' })).toString('base64url');
    expect(verifySessionToken([header, forged, signature].join('.'))).toEqual({ ok: false, code: TOKEN_ERROR.INVALID });
  });

  it('rejects a token signed with another secret as invalid, even when expired', () => {
    const now = Math.floor(Date.now() / 1000);
    const foreign = jwt.sign({ sub: 'gaearon', iss: 'devradar', exp: now + 60 }, 'other-secret');
    const foreignExpired = jwt.sign({ sub: 'gaearon', iss: 'devradar', exp: now - 60 }, 'other-secret');
    expect(verifySessionToken(foreign).code).toBe(TOKEN_ERROR.INVALID);
    expect(verifySessionToken(foreignExpired).code).toBe(TOKEN_ERROR.INVALID);
  });

  it('rejects alg "none" and other algorithms', () => {
    const now = Math.floor(Date.now() / 1000);
    const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const claims = { sub: 'gaearon', iss: 'devradar', iat: now, exp: now + 60 };
    expect(verifySessionToken(`${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`).code).toBe(TOKEN_ERROR.INVALID);
    expect(verifySessionToken(jwt.sign(claims, SECRET, { algorithm: 'HS512' })).code).toBe(TOKEN_ERROR.INVALID);
  });

  it('rejects tokens with the wrong issuer, no expiry, or a non-username subject', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifySessionToken(jwt.sign({ sub: 'gaearon', iss: 'someone-else', exp: now + 60 }, SECRET)).code)
      .toBe(TOKEN_ERROR.INVALID);
    expect(verifySessionToken(jwt.sign({ sub: 'gaearon', iss: 'devradar' }, SECRET)).code).toBe(TOKEN_ERROR.INVALID);
    expect(verifySessionToken(jwt.sign({ sub: '../admin', iss: 'devradar', exp: now + 60 }, SECRET)).code)
      .toBe(TOKEN_ERROR.INVALID);
  });

  it('rejects garbage as invalid', () => {
    expect(verifySessionToken('not-a-jwt').code).toBe(TOKEN_ERROR.INVALID);
    expect(verifySessionToken('a.b.c').code).toBe(TOKEN_ERROR.INVALID);
  });

  it('tokens stop verifying when the secret rotates', () => {
    const { token } = signSessionToken('gaearon');
    process.env.JWT_SECRET = 'rotated-secret-rotated-secret-rotated';
    expect(verifySessionToken(token).code).toBe(TOKEN_ERROR.INVALID);
  });
});
