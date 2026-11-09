const { requireAuth, readBearerToken, verifyToken } = require('../../../dev/backend/src/middleware/auth');
const { signSessionToken, verifySessionToken } = require('../../../dev/backend/src/utils/sessionToken');

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.set = (name, value) => { res.headers[name.toLowerCase()] = value; return res; };
  return res;
}

function run(authorization) {
  const req = { headers: authorization === undefined ? {} : { authorization } };
  const res = fakeRes();
  const next = jest.fn();
  requireAuth(req, res, next);
  return { req, res, next };
}

describe('requireAuth', () => {
  const originalSecret = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret';
  });
  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  it('sets req.user and continues for a valid token', () => {
    const { token } = signSessionToken('gaearon');
    const { req, res, next } = run(`Bearer ${token}`);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({ github_username: 'gaearon' });
    expect(res.body).toBeUndefined();
  });

  it('accepts the scheme case-insensitively', () => {
    const { token } = signSessionToken('gaearon');
    expect(run(`bearer ${token}`).next).toHaveBeenCalled();
  });

  it.each([undefined, '', 'Bearer', 'Bearer ', 'Basic Z2FlYXJvbjpodW50ZXIy', 'Token abc'])(
    'answers 401 token_missing for Authorization %p',
    (header) => {
      const { req, res, next } = run(header);
      expect(next).not.toHaveBeenCalled();
      expect(req.user).toBeUndefined();
      expect(res.statusCode).toBe(401);
      expect(res.body).toMatchObject({ code: 'token_missing', error: expect.any(String), details: expect.any(Array) });
      expect(res.headers['www-authenticate']).toBe('Bearer realm="devradar"');
    }
  );

  it('answers 401 token_invalid for a bad token, without echoing it', () => {
    const { res, next } = run('Bearer not-a-jwt');
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('token_invalid');
    expect(JSON.stringify(res.body)).not.toContain('not-a-jwt');
    expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  it('answers 401 token_expired for an expired token', () => {
    const realNow = Date.now;
    const { token } = signSessionToken('gaearon');
    try {
      Date.now = () => realNow() + 8 * 24 * 60 * 60 * 1000;
      const { res, next } = run(`Bearer ${token}`);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res.body.code).toBe('token_expired');
    } finally {
      Date.now = realNow;
    }
  });

  it('rejects a header with more than one token', () => {
    const { token } = signSessionToken('gaearon');
    expect(run(`Bearer ${token} ${token}`).res.body.code).toBe('token_missing');
  });

  it('exports the raw verifier for the socket handshake (slice 4)', () => {
    expect(verifyToken).toBe(verifySessionToken);
    expect(readBearerToken('Bearer abc')).toBe('abc');
    expect(readBearerToken(undefined)).toBeNull();
  });
});
