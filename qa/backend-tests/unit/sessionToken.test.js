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
const GAEARON = { github_id: 810438, github_username: 'gaearon' };

function decode(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

/** Claims of a well-formed token (auth slice 6), valid for another minute. */
function claimsFor(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: '810438',
    login: 'gaearon',
    login_read_at: now * 1000 - 5000,
    iss: 'devradar',
    iat: now,
    exp: now + 60,
    profile: { name: null, avatar_url: null, bio: null },
    ...overrides,
  };
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

  it('signs an HS256 JWT whose subject is the GitHub id, with the login as a claim, valid 7 days', () => {
    const readAt = Date.now() - 30000;
    const { token, expiresIn, loginReadAt } = signSessionToken({ ...GAEARON, login_read_at: readAt });
    const [header, payload] = token.split('.');

    expect(expiresIn).toBe(SEVEN_DAYS);
    expect(SESSION_TTL_SECONDS).toBe(SEVEN_DAYS);
    expect(loginReadAt).toBe(readAt);
    expect(decode(header).alg).toBe('HS256');
    const claims = decode(payload);
    expect(claims.sub).toBe('810438');
    expect(claims.login).toBe('gaearon');
    expect(claims.login_read_at).toBe(readAt);
    expect(claims.iss).toBe('devradar');
    expect(claims.exp - claims.iat).toBe(SEVEN_DAYS);
  });

  it('round-trips a valid token to the GitHub id, the login, the sign-in profile and the GitHub read time', () => {
    const readAt = Date.now() - 1000;
    const { token } = signSessionToken({ github_id: 810438, github_username: 'Gaearon', profile: PROFILE, login_read_at: readAt });
    expect(verifySessionToken(token)).toEqual({
      ok: true,
      user: { github_id: 810438, github_username: 'Gaearon', profile: PROFILE, login_read_at: readAt },
    });
  });

  // QA-AUTH6-3: logins are ordered by when GitHub was read, which happens before the code is
  // redeemed (iat), never after.
  it.each([0, -1, 1.5, '1', null])('refuses to sign GitHub read time %p', (readAt) => {
    expect(() => signSessionToken({ ...GAEARON, login_read_at: readAt })).toThrow(TypeError);
  });

  it('refuses to sign a GitHub read time after the token is issued', () => {
    expect(() => signSessionToken({ ...GAEARON, login_read_at: Date.now() + 5000 })).toThrow(TypeError);
  });

  it('keeps the largest GitHub ids exact', () => {
    const { token } = signSessionToken({ ...GAEARON, github_id: Number.MAX_SAFE_INTEGER });
    expect(decode(token.split('.')[1]).sub).toBe('9007199254740991');
    expect(verifySessionToken(token).user.github_id).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([undefined, null, 0, -1, 1.5, '810438', Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
    'refuses to sign GitHub id %p',
    (githubId) => {
      expect(() => signSessionToken({ ...GAEARON, github_id: githubId })).toThrow(TypeError);
    }
  );

  it.each([undefined, '', '-bad-', '../admin', 'a'.repeat(40)])('refuses to sign login %p', (login) => {
    expect(() => signSessionToken({ ...GAEARON, github_username: login })).toThrow(TypeError);
  });

  it('signs the sanitized profile as the `profile` claim, never extra fields', () => {
    const { token } = signSessionToken({
      ...GAEARON,
      profile: {
        ...PROFILE,
        bio: 'b'.repeat(1000),
        access_token: 'gho_must_not_be_signed',
        email: 'dan@example.com',
      },
    });
    const claims = decode(token.split('.')[1]);
    expect(Object.keys(claims.profile).sort()).toEqual(['avatar_url', 'bio', 'name']);
    expect(claims.profile.bio).toHaveLength(160);
    expect(token).not.toContain('gho_must_not_be_signed');
    expect(JSON.stringify(claims)).not.toContain('gho_must_not_be_signed');
    expect(JSON.stringify(claims)).not.toContain('dan@example.com');
  });

  // The mobile app (auth slice 4) keeps the token in expo-secure-store, whose values are limited
  // to 2048 bytes. Worst case: the largest GitHub id, the longest login, and every profile field
  // at its byte cap with the most expensive characters (4-byte emoji, JSON-escaped quotes and
  // backslashes).
  it('keeps a worst-case token well under the 2048-byte secure-store limit', () => {
    const SECURE_STORE_LIMIT = 2048;
    const emoji = String.fromCodePoint(0x1f600);
    const longestLogin = `a${'-b'.repeat(19)}`; // 39 characters, GitHub's maximum
    const largestId = Number.MAX_SAFE_INTEGER; // 16 digits
    const avatar = `https://avatars.githubusercontent.com/u/1?v=4&p=${'x'.repeat(240)}`;
    const fillers = [emoji, '"', '\\', 'a', `${emoji}"`];
    const sizes = [];
    fillers.forEach((nameFill) => fillers.forEach((bioFill) => {
      const { token } = signSessionToken({
        github_id: largestId,
        github_username: longestLogin,
        profile: { name: nameFill.repeat(2000), bio: bioFill.repeat(2000), avatar_url: avatar },
      });
      expect(verifySessionToken(token).ok).toBe(true);
      sizes.push(Buffer.byteLength(token, 'utf8'));
    }));
    expect(longestLogin).toHaveLength(39);
    const plain = signSessionToken({ github_id: largestId, github_username: longestLogin, profile: { avatar_url: avatar } });
    expect(verifySessionToken(plain.token).user.profile.avatar_url).toBe(avatar);
    expect(Math.max(...sizes)).toBeLessThan(1600);
    expect(Math.max(...sizes)).toBeLessThan(SECURE_STORE_LIMIT);
  });

  it('signs an all-null profile when none is given', () => {
    const { token } = signSessionToken(GAEARON);
    expect(verifySessionToken(token).user.profile).toEqual({ name: null, avatar_url: null, bio: null });
  });

  it('rejects a correctly signed token without a well-formed profile claim as invalid', () => {
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
      const claims = claimsFor({ profile });
      if (profile === undefined) delete claims.profile;
      expect(verifySessionToken(jwt.sign(claims, SECRET))).toEqual({ ok: false, code: TOKEN_ERROR.INVALID });
    });
  });

  // Auth slice 6 (Q10): slices 1-5 signed `sub` = the login, with no id and no `login` claim.
  // Those tokens are invalid now, so their clients sign in again once.
  it('rejects a token issued before GitHub ids were captured as invalid', () => {
    const legacy = claimsFor({ sub: 'gaearon', profile: PROFILE });
    delete legacy.login;
    expect(verifySessionToken(jwt.sign(legacy, SECRET))).toEqual({ ok: false, code: TOKEN_ERROR.INVALID });
  });

  it.each([
    ['a login as subject', { sub: 'gaearon' }],
    ['a numeric (not string) subject', { sub: 810438 }],
    ['a zero subject', { sub: '0' }],
    ['a negative subject', { sub: '-810438' }],
    ['a leading zero', { sub: '0810438' }],
    ['an exponent', { sub: '8e5' }],
    ['a decimal subject', { sub: '810438.5' }],
    ['a subject above the safe integer range', { sub: '9007199254740993' }],
    ['padding', { sub: ' 810438' }],
    ['no login claim', { login: undefined }],
    ['a login claim that is not a GitHub login', { login: '../admin' }],
    ['no iat', { iat: undefined }],
    ['no login_read_at', { login_read_at: undefined }],
    ['a login_read_at in seconds as a string', { login_read_at: '1762780000' }],
    ['a login_read_at after the token was issued', { login_read_at: Date.now() + 60000 }],
    ['a fractional login_read_at', { login_read_at: 1.5 }],
  ])('rejects a correctly signed token with %s as invalid', (_label, overrides) => {
    const claims = claimsFor(overrides);
    Object.keys(claims).forEach((key) => claims[key] === undefined && delete claims[key]);
    expect(verifySessionToken(jwt.sign(claims, SECRET, { noTimestamp: true }))).toEqual({ ok: false, code: TOKEN_ERROR.INVALID });
  });

  it('is still valid just before 7 days, expired just after', () => {
    const { token } = signSessionToken(GAEARON);
    const { iat } = decode(token.split('.')[1]);
    expect(verifySessionToken(token, { nowSeconds: iat + SEVEN_DAYS - 1 }).ok).toBe(true);
    expect(verifySessionToken(token, { nowSeconds: iat + SEVEN_DAYS })).toEqual({ ok: false, code: TOKEN_ERROR.EXPIRED });
  });

  it.each([undefined, null, '', 123])('reports a missing token for %p', (token) => {
    expect(verifySessionToken(token)).toEqual({ ok: false, code: TOKEN_ERROR.MISSING });
  });

  it('rejects a token whose payload was changed as invalid', () => {
    const [header, payload, signature] = signSessionToken(GAEARON).token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...decode(payload), sub: '1', login: 'bob' })).toString('base64url');
    expect(verifySessionToken([header, forged, signature].join('.'))).toEqual({ ok: false, code: TOKEN_ERROR.INVALID });
  });

  it('rejects a token signed with another secret as invalid, even when expired', () => {
    const now = Math.floor(Date.now() / 1000);
    const foreign = jwt.sign(claimsFor(), 'other-secret');
    const foreignExpired = jwt.sign(claimsFor({ exp: now - 60 }), 'other-secret');
    expect(verifySessionToken(foreign).code).toBe(TOKEN_ERROR.INVALID);
    expect(verifySessionToken(foreignExpired).code).toBe(TOKEN_ERROR.INVALID);
  });

  it('rejects alg "none" and other algorithms', () => {
    const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const claims = claimsFor();
    expect(verifySessionToken(`${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`).code).toBe(TOKEN_ERROR.INVALID);
    expect(verifySessionToken(jwt.sign(claims, SECRET, { algorithm: 'HS512' })).code).toBe(TOKEN_ERROR.INVALID);
  });

  it('rejects tokens with the wrong issuer or no expiry', () => {
    expect(verifySessionToken(jwt.sign(claimsFor({ iss: 'someone-else' }), SECRET)).code).toBe(TOKEN_ERROR.INVALID);
    const noExpiry = claimsFor();
    delete noExpiry.exp;
    expect(verifySessionToken(jwt.sign(noExpiry, SECRET)).code).toBe(TOKEN_ERROR.INVALID);
  });

  it('accepts exactly the claims it signs', () => {
    expect(verifySessionToken(jwt.sign(claimsFor(), SECRET)).ok).toBe(true);
  });

  it('rejects garbage as invalid', () => {
    expect(verifySessionToken('not-a-jwt').code).toBe(TOKEN_ERROR.INVALID);
    expect(verifySessionToken('a.b.c').code).toBe(TOKEN_ERROR.INVALID);
  });

  it('tokens stop verifying when the secret rotates', () => {
    const { token } = signSessionToken(GAEARON);
    process.env.JWT_SECRET = 'rotated-secret-rotated-secret-rotated';
    expect(verifySessionToken(token).code).toBe(TOKEN_ERROR.INVALID);
  });
});
