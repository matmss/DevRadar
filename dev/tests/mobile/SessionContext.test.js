// src/SessionContext.js: restoring the session at launch, and going back to the sign-in screen on
// an auth failure from the API or the socket (US-7). Services are mocked at their boundaries
// (secure store, HTTP adapter, socket.io-client, system auth session).
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    __store: store,
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => { store.set(key, value); }),
    deleteItemAsync: jest.fn(async (key) => { store.delete(key); }),
  };
});
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-crypto', () => {
  const crypto = require('crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { BASE64: 'base64' },
    getRandomBytes: (count) => new Uint8Array(crypto.randomBytes(count)),
    digestStringAsync: async (algorithm, data, options) => crypto.createHash('sha256').update(data, 'utf8').digest(options.encoding),
  };
});
jest.mock('socket.io-client', () => {
  const listeners = {};
  const fakeSocket = {
    auth: undefined,
    io: { opts: {} },
    on: (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); },
    off: (event, fn) => { listeners[event] = (listeners[event] || []).filter((l) => l !== fn); },
    connect: jest.fn(),
    disconnect: jest.fn(),
    emitLocal: (event, payload) => (listeners[event] || []).forEach((fn) => fn(payload)),
  };
  const factory = () => fakeSocket;
  factory.fakeSocket = fakeSocket;
  return { __esModule: true, default: factory };
});

const SecureStore = require('expo-secure-store');
const WebBrowser = require('expo-web-browser');
const { fakeSocket } = require('socket.io-client').default;
const { default: api } = require('../../mobile/src/services/api');
const socketService = require('../../mobile/src/services/socket');
const { SessionProvider, useSession } = require('../../mobile/src/SessionContext');
const { getToken } = require('../../mobile/src/services/session');
const { AUTH_REDIRECT_URI } = require('../../mobile/src/config');

const TOKEN_KEY = 'devradar.session_token';
const USER = { github_id: 810438, github_username: 'gaearon', name: 'Dan Abramov', avatar_url: null };

let routes; // path -> (config) => [status, data]

/** Fake backend: answers through the real api instance (so its interceptors run). */
function installBackend() {
  api.defaults.adapter = async (config) => {
    const answer = routes[`${config.method.toUpperCase()} ${config.url}`];
    if (!answer) throw Object.assign(new Error(`unexpected ${config.method} ${config.url}`), { config });
    const [status, data] = answer(config);
    const response = { status, data, headers: {}, config, statusText: String(status) };
    if (status === 0) throw Object.assign(new Error('Network Error'), { config });
    if (status >= 400) throw Object.assign(new Error(`status ${status}`), { config, response });
    return response;
  };
}

let session;
function Probe() {
  session = useSession();
  return null;
}

async function launch() {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<SessionProvider><Probe /></SessionProvider>);
  });
  return renderer;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('SessionProvider', () => {
  let warn;
  let renderer;
  beforeEach(() => {
    SecureStore.__store.clear();
    jest.clearAllMocks();
    routes = {};
    installBackend();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(async () => {
    if (renderer) await act(async () => renderer.unmount());
    renderer = null;
    warn.mockRestore();
  });

  it('shows the sign-in screen when nothing is stored', async () => {
    renderer = await launch();
    expect(session.state).toEqual({ status: 'signedOut', user: null, notice: null });
  });

  it('lands on the map with a stored, valid session (relaunch)', async () => {
    SecureStore.__store.set(TOKEN_KEY, 'stored-token');
    routes['GET /auth/me'] = (config) => [config.headers.Authorization === 'Bearer stored-token' ? 200 : 401, USER];
    renderer = await launch();
    expect(session.state).toEqual({ status: 'signedIn', user: USER, notice: null });
  });

  it('goes to the sign-in screen with "Sessão expirada" when the stored token has expired', async () => {
    SecureStore.__store.set(TOKEN_KEY, 'expired-token');
    routes['GET /auth/me'] = () => [401, { error: 'Session expired, sign in again', code: 'token_expired', details: [] }];
    renderer = await launch();
    await flush();
    expect(session.state).toEqual({ status: 'signedOut', user: null, notice: 'Sessão expirada, entre novamente' });
    expect(SecureStore.__store.has(TOKEN_KEY)).toBe(false);
  });

  // Auth slice 6 (Q10): tokens stored by earlier versions (subject = login, no GitHub id) are
  // answered token_invalid. The app goes to the sign-in screen (never an empty map), forgets the
  // token, and signing in again works.
  it('goes to the sign-in screen when the stored token predates GitHub ids, and signing in again works', async () => {
    SecureStore.__store.set(TOKEN_KEY, 'pre-slice-6-token');
    routes['GET /auth/me'] = (config) => (config.headers.Authorization === 'Bearer fresh-token'
      ? [200, USER]
      : [401, { error: 'Invalid session token', code: 'token_invalid', details: [] }]);
    renderer = await launch();
    await flush();
    expect(session.state).toEqual({ status: 'signedOut', user: null, notice: 'Sua sessão não é mais válida, entre novamente' });
    expect(SecureStore.__store.has(TOKEN_KEY)).toBe(false);
    expect(getToken()).toBeNull();

    WebBrowser.openAuthSessionAsync.mockResolvedValue({ type: 'success', url: `${AUTH_REDIRECT_URI}?code=c` });
    routes['POST /auth/token'] = () => [200, { token: 'fresh-token', user: USER }];
    await act(async () => session.signIn());
    expect(session.state).toEqual({ status: 'signedIn', user: USER, notice: null });
    expect(SecureStore.__store.get(TOKEN_KEY)).toBe('fresh-token');
  });

  it('keeps the token and offers a retry when the server is unreachable', async () => {
    SecureStore.__store.set(TOKEN_KEY, 'stored-token');
    routes['GET /auth/me'] = () => [0];
    renderer = await launch();
    expect(session.state.status).toBe('unavailable');
    expect(SecureStore.__store.get(TOKEN_KEY)).toBe('stored-token');

    routes['GET /auth/me'] = () => [200, USER];
    await act(async () => session.retry());
    expect(session.state.status).toBe('signedIn');
  });

  it('returns to the sign-in screen with a message when /search answers 401', async () => {
    SecureStore.__store.set(TOKEN_KEY, 'stored-token');
    routes['GET /auth/me'] = () => [200, USER];
    routes['GET /search'] = () => [401, { error: 'Invalid session token', code: 'token_invalid', details: [] }];
    renderer = await launch();

    await act(async () => {
      await api.get('/search', { params: { latitude: 1, longitude: 2, techs: 'Go' } }).catch(() => {});
    });
    await flush();
    expect(session.state.status).toBe('signedOut');
    expect(session.state.notice).toBe('Sua sessão não é mais válida, entre novamente');
    expect(getToken()).toBeNull();
    expect(fakeSocket.disconnect).toHaveBeenCalled();
  });

  it('returns to the sign-in screen with "Sessão expirada" when the socket handshake is refused as expired', async () => {
    SecureStore.__store.set(TOKEN_KEY, 'stored-token');
    routes['GET /auth/me'] = () => [200, USER];
    renderer = await launch();
    socketService.connect(1, 2, 'Go', getToken());

    await act(async () => {
      fakeSocket.emitLocal('connect_error', Object.assign(new Error('Session expired, sign in again'), {
        data: { code: 'token_expired', details: ['The session token has expired'] },
      }));
    });
    await flush();
    expect(session.state).toEqual({ status: 'signedOut', user: null, notice: 'Sessão expirada, entre novamente' });
    expect(SecureStore.__store.has(TOKEN_KEY)).toBe(false);
  });

  it('returns to the sign-in screen when the socket handshake is refused as invalid (a token without a GitHub id)', async () => {
    SecureStore.__store.set(TOKEN_KEY, 'stored-token');
    routes['GET /auth/me'] = () => [200, USER];
    renderer = await launch();
    socketService.connect(1, 2, 'Go', getToken());

    await act(async () => {
      fakeSocket.emitLocal('connect_error', Object.assign(new Error('Invalid session token'), {
        data: { code: 'token_invalid', details: ['The session token is malformed or its signature is invalid'] },
      }));
    });
    await flush();
    expect(session.state).toEqual({ status: 'signedOut', user: null, notice: 'Sua sessão não é mais válida, entre novamente' });
    expect(SecureStore.__store.has(TOKEN_KEY)).toBe(false);
  });

  it('ignores a late 401 for an older token after signing in again', async () => {
    SecureStore.__store.set(TOKEN_KEY, 'old-token');
    routes['GET /auth/me'] = () => [200, USER];
    renderer = await launch();

    // A search sent with the old token is answered only after the user signed out and back in.
    let answerSearch;
    routes['GET /search'] = () => [401, { code: 'token_expired' }];
    const pending = new Promise((resolve) => { answerSearch = resolve; });
    const realAdapter = api.defaults.adapter;
    api.defaults.adapter = async (config) => {
      if (config.url === '/search') await pending;
      return realAdapter(config);
    };
    let search;
    await act(async () => {
      search = api.get('/search').catch(() => {});
    });

    await act(async () => session.signOut());
    WebBrowser.openAuthSessionAsync.mockResolvedValue({ type: 'success', url: `${AUTH_REDIRECT_URI}?code=c` });
    routes['POST /auth/token'] = () => [200, { token: 'new-token', user: USER }];
    await act(async () => session.signIn());
    expect(session.state.status).toBe('signedIn');

    await act(async () => {
      answerSearch();
      await search;
    });
    await flush();
    expect(session.state.status).toBe('signedIn');
    expect(getToken()).toBe('new-token');
    expect(SecureStore.__store.get(TOKEN_KEY)).toBe('new-token');
  });

  it('signs in through the system auth session and stores the token in secure storage', async () => {
    renderer = await launch();
    WebBrowser.openAuthSessionAsync.mockResolvedValue({ type: 'success', url: `${AUTH_REDIRECT_URI}?code=c` });
    routes['POST /auth/token'] = () => [200, { token: 'fresh-token', user: USER }];
    await act(async () => session.signIn());
    expect(session.state).toEqual({ status: 'signedIn', user: USER, notice: null });
    expect(SecureStore.__store.get(TOKEN_KEY)).toBe('fresh-token');
  });

  it('ignores a socket refusal for a handshake sent without a token after "Sair" (QA-AUTH4-1)', async () => {
    SecureStore.__store.set(TOKEN_KEY, 'stored-token');
    routes['GET /auth/me'] = () => [200, USER];
    renderer = await launch();
    await act(async () => session.signOut());

    // As if a late anonymous handshake still went out and the backend refused it.
    fakeSocket.auth = { token: null };
    await act(async () => {
      fakeSocket.emitLocal('connect_error', Object.assign(new Error('Authentication required'), {
        data: { code: 'token_missing', details: ['x'] },
      }));
    });
    await flush();
    expect(session.state).toEqual({ status: 'signedOut', user: null, notice: null });
  });

  it('ignores a 401 for a request sent without a token while signed out', async () => {
    renderer = await launch();
    routes['GET /search'] = () => [401, { code: 'token_missing' }];
    await act(async () => {
      await api.get('/search').catch(() => {});
    });
    await flush();
    expect(session.state).toEqual({ status: 'signedOut', user: null, notice: null });
  });

  it('runs one sign-in at a time when "Entrar com GitHub" is tapped twice', async () => {
    renderer = await launch();
    let finish;
    WebBrowser.openAuthSessionAsync.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    routes['POST /auth/token'] = () => [200, { token: 'fresh-token', user: USER }];

    let first;
    let second;
    await act(async () => {
      first = session.signIn();
      second = session.signIn();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({ type: 'success', url: `${AUTH_REDIRECT_URI}?code=c` });
      await Promise.all([first, second]);
    });
    expect(session.state.status).toBe('signedIn');

    // The guard is released afterwards: signing in again later works.
    await act(async () => session.signOut());
    WebBrowser.openAuthSessionAsync.mockResolvedValue({ type: 'cancel' });
    await act(async () => session.signIn());
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledTimes(2);
  });

  it('shows "Login cancelado" when the user closes the auth session', async () => {
    renderer = await launch();
    WebBrowser.openAuthSessionAsync.mockResolvedValue({ type: 'cancel' });
    await act(async () => session.signIn());
    expect(session.state).toEqual({ status: 'signedOut', user: null, notice: 'Login cancelado' });
  });

  it('"Sair" clears secure storage and closes the socket', async () => {
    SecureStore.__store.set(TOKEN_KEY, 'stored-token');
    routes['GET /auth/me'] = () => [200, USER];
    renderer = await launch();
    socketService.connect(1, 2, 'Go', getToken());

    await act(async () => session.signOut());
    expect(session.state).toEqual({ status: 'signedOut', user: null, notice: null });
    expect(SecureStore.__store.has(TOKEN_KEY)).toBe(false);
    expect(fakeSocket.disconnect).toHaveBeenCalled();
    expect(fakeSocket.auth).toEqual({});
  });
});
