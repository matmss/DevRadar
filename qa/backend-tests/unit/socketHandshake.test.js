// Socket.io handshake authentication (auth slice 4, US-5): websocket.js#authenticateHandshake is
// the `io.use` middleware. The end-to-end behavior (connect_error on the client, nothing added to
// `connections`) is in features/realtime-auth.feature; this pins the middleware contract.
const { authenticateHandshake } = require('../../../dev/backend/src/websocket');
const { signSessionToken } = require('../../../dev/backend/src/utils/sessionToken');

const QUERY = { latitude: '-23.5505', longitude: '-46.6333', techs: 'ReactJS, Node.js' };

/** Runs the middleware against a fake socket and returns the socket and what `next` got. */
function run(handshake) {
  const socket = { handshake: { auth: {}, query: {}, headers: {}, ...handshake }, data: {} };
  const next = jest.fn();
  authenticateHandshake(socket, next);
  expect(next).toHaveBeenCalledTimes(1);
  return { socket, err: next.mock.calls[0][0] };
}

describe('authenticateHandshake', () => {
  const original = { secret: process.env.JWT_SECRET, env: process.env.NODE_ENV };
  let errorLog;
  beforeEach(() => {
    process.env.JWT_SECRET = 'unit-test-secret-unit-test-secret';
    delete process.env.NODE_ENV;
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errorLog.mockRestore());
  afterAll(() => {
    if (original.secret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original.secret;
    if (original.env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original.env;
  });

  it('accepts a valid token from handshake.auth and stores the user and subscription', () => {
    const { token } = signSessionToken('gaearon');
    const { socket, err } = run({ auth: { token }, query: QUERY });
    expect(err).toBeUndefined();
    expect(socket.data.user.github_username).toBe('gaearon');
    expect(socket.data.subscription).toEqual({
      coordinates: { latitude: -23.5505, longitude: -46.6333 },
      techs: ['ReactJS', 'Node.js'],
    });
  });

  it.each([
    ['no auth payload', { auth: undefined }],
    ['an empty auth payload', { auth: {} }],
    ['a non-string token', { auth: { token: 42 } }],
    ['a token only in the query string', { query: { ...QUERY, token: 'TOKEN' } }],
    ['a token only in an Authorization header', { headers: { authorization: 'Bearer TOKEN' } }],
  ])('refuses %s as token_missing', (_label, handshake) => {
    const { token } = signSessionToken('gaearon');
    const withToken = JSON.parse(JSON.stringify(handshake).replace('TOKEN', token));
    const { socket, err } = run({ query: QUERY, ...withToken });
    expect(err).toBeInstanceOf(Error);
    expect(err.data).toEqual({ code: 'token_missing', details: expect.any(Array) });
    expect(socket.data.user).toBeUndefined();
  });

  it('refuses a malformed token as token_invalid', () => {
    const { err } = run({ auth: { token: 'not-a-jwt' }, query: QUERY });
    expect(err.data.code).toBe('token_invalid');
  });

  it('refuses an expired token as token_expired', () => {
    const { token } = signSessionToken('gaearon');
    const realNow = Date.now;
    Date.now = () => realNow() + 8 * 24 * 60 * 60 * 1000;
    try {
      const { err } = run({ auth: { token }, query: QUERY });
      expect(err.data.code).toBe('token_expired');
      expect(err.message).toBe('Session expired, sign in again');
    } finally {
      Date.now = realNow;
    }
  });

  it('checks the token before the subscription params', () => {
    const { err } = run({ auth: {}, query: {} });
    expect(err.data.code).toBe('token_missing');
  });

  it('refuses invalid subscription params with a valid token as subscription_invalid', () => {
    const { token } = signSessionToken('gaearon');
    const { socket, err } = run({ auth: { token }, query: { ...QUERY, latitude: 'abc' } });
    expect(err.data.code).toBe('subscription_invalid');
    expect(socket.data.subscription).toBeUndefined();
  });

  it('refuses with internal_error instead of throwing when verification itself fails', () => {
    const { token } = signSessionToken('gaearon');
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET; // jwtSecret() throws in production without a secret
    const { err } = run({ auth: { token }, query: QUERY });
    expect(err.data.code).toBe('internal_error');
    const logged = errorLog.mock.calls.flat().join(' ');
    expect(logged).not.toContain(token);
  });

  it('never puts the token in the refusal', () => {
    const { token } = signSessionToken('gaearon');
    const realNow = Date.now;
    Date.now = () => realNow() + 8 * 24 * 60 * 60 * 1000;
    try {
      const { err } = run({ auth: { token }, query: QUERY });
      expect(JSON.stringify({ message: err.message, data: err.data })).not.toContain(token);
    } finally {
      Date.now = realNow;
    }
  });
});
