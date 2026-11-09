// src/services/socket.js: the session token goes in the handshake `auth` payload, never in the
// query string, and a refused handshake is reported as an auth failure.
jest.mock('socket.io-client', () => {
  const listeners = {};
  const fakeSocket = {
    auth: undefined,
    connected: false,
    io: { opts: {} },
    on: jest.fn((event, fn) => { (listeners[event] = listeners[event] || []).push(fn); }),
    off: jest.fn((event, fn) => { listeners[event] = (listeners[event] || []).filter((l) => l !== fn); }),
    connect: jest.fn(() => { fakeSocket.connected = true; }),
    disconnect: jest.fn(() => { fakeSocket.connected = false; }),
    emitLocal: (event, payload) => (listeners[event] || []).forEach((fn) => fn(payload)),
    listenerCount: (event) => (listeners[event] || []).length,
  };
  const factory = jest.fn(() => fakeSocket);
  factory.fakeSocket = fakeSocket;
  return { __esModule: true, default: factory };
});

const socketio = require('socket.io-client').default;
const socketService = require('../../../mobile/src/services/socket');
const { API_URL } = require('../../../mobile/src/config');

const fake = socketio.fakeSocket;
const createdWith = socketio.mock.calls.slice(); // before beforeEach clears the mocks

/** @param {string} code */
function refusal(code) {
  return Object.assign(new Error('refused'), { data: { code, details: ['x'] } });
}

describe('socket service', () => {
  let warn;
  beforeEach(() => {
    jest.clearAllMocks();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('is created for the backend URL and does not connect by itself', () => {
    expect(createdWith).toEqual([[API_URL, { autoConnect: false }]]);
  });

  it('sends the token in the handshake auth payload and the subscription in the query', () => {
    socketService.connect(-23.5, -46.6, 'ReactJS, Node.js', 'token-1');
    expect(fake.auth).toEqual({ token: 'token-1' });
    expect(fake.io.opts.query).toEqual({ latitude: -23.5, longitude: -46.6, techs: 'ReactJS, Node.js' });
    expect(JSON.stringify(fake.io.opts.query)).not.toContain('token-1');
    expect(fake.io.opts.extraHeaders).toBeUndefined();
    expect(fake.connect).toHaveBeenCalledTimes(1);
  });

  it('replaces the previous subscription when connecting again', () => {
    socketService.connect(1, 2, 'Go', 'token-1');
    socketService.connect(3, 4, 'Rust', 'token-2');
    expect(fake.disconnect).toHaveBeenCalled();
    expect(fake.auth).toEqual({ token: 'token-2' });
    expect(fake.io.opts.query).toEqual({ latitude: 3, longitude: 4, techs: 'Rust' });
  });

  it('closes the socket and forgets the token on disconnect (sign-out)', () => {
    socketService.connect(1, 2, 'Go', 'token-1');
    socketService.disconnect();
    expect(fake.disconnect).toHaveBeenCalled();
    expect(fake.connected).toBe(false);
    expect(fake.auth).toEqual({});
  });

  it.each(['token_missing', 'token_expired', 'token_invalid'])(
    'reports a handshake refused with %s, with the token it was sent',
    (code) => {
      const listener = jest.fn();
      const unsubscribe = socketService.subscribeToAuthErrors(listener);
      socketService.connect(1, 2, 'Go', 'token-1');
      fake.emitLocal('connect_error', refusal(code));
      expect(listener).toHaveBeenCalledWith(code, 'token-1');
      unsubscribe();
    }
  );

  it('does not report other refusals or transport errors as auth failures', () => {
    const listener = jest.fn();
    const unsubscribe = socketService.subscribeToAuthErrors(listener);
    fake.emitLocal('connect_error', refusal('subscription_invalid'));
    fake.emitLocal('connect_error', new Error('xhr poll error'));
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('removes its listeners on unsubscribe', () => {
    const before = { auth: fake.listenerCount('connect_error'), devs: fake.listenerCount('new-dev') };
    const stopAuth = socketService.subscribeToAuthErrors(jest.fn());
    const stopDevs = socketService.subscribeToNewDevs(jest.fn());
    expect(fake.listenerCount('connect_error')).toBe(before.auth + 1);
    expect(fake.listenerCount('new-dev')).toBe(before.devs + 1);
    stopAuth();
    stopDevs();
    expect(fake.listenerCount('connect_error')).toBe(before.auth);
    expect(fake.listenerCount('new-dev')).toBe(before.devs);
  });

  it('delivers new-dev pushes to the subscriber', () => {
    const listener = jest.fn();
    const stop = socketService.subscribeToNewDevs(listener);
    fake.emitLocal('new-dev', { _id: '1', github_username: 'gaearon' });
    expect(listener).toHaveBeenCalledWith({ _id: '1', github_username: 'gaearon' });
    stop();
  });
});
