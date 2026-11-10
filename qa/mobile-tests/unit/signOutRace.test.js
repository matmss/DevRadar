// QA, auth slice 4 review (US-7 "Sign out"): a search that is still in flight when the user taps
// "Sair" must not open the live subscription afterwards.
//
// pages/Main.js#loadDevs awaits GET /search and then calls setupWebsocket() ->
// connect(latitude, longitude, techs, getToken()). If "Sair" happened while the request was in
// flight, Main is already unmounted (its cleanup closed the socket), getToken() is null, and the
// shared socket is reconnected with `auth: { token: null }`. The backend refuses that handshake
// with token_missing, SessionProvider treats it as an auth failure for the current (null) token,
// and the sign-in screen the user chose to go to now shows MESSAGES.sessionInvalid ("your session
// is no longer valid") as if the session had broken.
//
// Real SessionProvider, Main, api and socket services; mocked at their boundaries (secure store,
// HTTP adapter, socket.io-client transport, location, maps), like dev/tests/mobile/.
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
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64' },
  getRandomBytes: (count) => new Uint8Array(count),
  digestStringAsync: async () => 'AAAA',
}));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: -23.5505, longitude: -46.6333 } })),
}));
jest.mock('react-native-maps', () => {
  const { View } = require('react-native');
  const Stub = ({ children }) => children || null;
  return { __esModule: true, default: View, Marker: Stub, Callout: Stub };
});
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
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
const { fakeSocket } = require('socket.io-client').default;
const { default: api } = require('../../../dev/mobile/src/services/api');
const { SessionProvider, useSession } = require('../../../dev/mobile/src/SessionContext');
const { STATUS } = require('../../../dev/mobile/src/services/sessionState');
const { default: Main } = require('../../../dev/mobile/src/pages/Main');

jest.setTimeout(20000); // the first render loads react-native and the app modules

const TOKEN_KEY = 'devradar.session_token';
const USER = { github_username: 'gaearon', name: 'Dan Abramov', avatar_url: null };

let session;
/** Mirrors src/routes.js: the map is mounted only while signed in. */
function Screens() {
  session = useSession();
  return session.state.status === STATUS.SIGNED_IN ? <Main navigation={{ navigate: jest.fn() }} /> : null;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** What the real backend answers a handshake: token_missing when `auth.token` is not a string. */
function backendAnswersHandshake() {
  const token = fakeSocket.auth && fakeSocket.auth.token;
  if (typeof token === 'string' && token !== '') return;
  fakeSocket.emitLocal('connect_error', Object.assign(new Error('Authentication required'), {
    data: { code: 'token_missing', details: ['Send the session token in the handshake auth payload: { token }'] },
  }));
}

// Control (passes today): without the race, the harness sees the subscription open with the token.
describe('control: a search answered while signed in', () => {
  it('opens the live subscription with the session token in the auth payload', async () => {
    SecureStore.__store.clear();
    SecureStore.__store.set(TOKEN_KEY, 'stored-token');
    jest.clearAllMocks();
    api.defaults.adapter = async (config) => ({
      status: 200, statusText: 'OK', headers: {}, config, data: config.url === '/search' ? { devs: [] } : USER,
    });
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(<SessionProvider><Screens /></SessionProvider>);
    });
    await flush();
    const searchButton = renderer.root.findByProps({ testID: 'search-button' });
    await act(async () => { searchButton.props.onPress(); });
    await flush();
    expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
    expect(fakeSocket.auth).toEqual({ token: 'stored-token' });
    await act(async () => renderer.unmount());
  });
});

describe('@regression @P2 QA-AUTH4-1: "Sair" while GET /search is in flight', () => {
  let renderer;
  let answerSearch;
  let warn;

  beforeEach(async () => {
    SecureStore.__store.clear();
    SecureStore.__store.set(TOKEN_KEY, 'stored-token');
    jest.clearAllMocks();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const searchAnswered = new Promise((resolve) => { answerSearch = resolve; });
    api.defaults.adapter = async (config) => {
      const ok = (data) => ({ status: 200, statusText: 'OK', headers: {}, config, data });
      if (config.url === '/auth/me') return ok(USER);
      if (config.url === '/search') {
        await searchAnswered;
        return ok({ devs: [] });
      }
      throw Object.assign(new Error(`unexpected ${config.url}`), { config });
    };

    await act(async () => {
      renderer = TestRenderer.create(<SessionProvider><Screens /></SessionProvider>);
    });
    await flush();
    expect(session.state.status).toBe(STATUS.SIGNED_IN);

    // Tap search (the request is now in flight), then "Sair" before the answer arrives.
    const searchButton = renderer.root.findByProps({ testID: 'search-button' });
    await act(async () => { searchButton.props.onPress(); });
    await act(async () => session.signOut());
    expect(session.state).toEqual({ status: STATUS.SIGNED_OUT, user: null, notice: null });
    fakeSocket.connect.mockClear();

    // The search answers after the sign-out.
    await act(async () => { answerSearch(); });
    await flush();
  });

  afterEach(async () => {
    if (renderer) await act(async () => renderer.unmount());
    renderer = null;
    warn.mockRestore();
  });

  it('does not open the live subscription after the user signed out', () => {
    expect(fakeSocket.connect).not.toHaveBeenCalled();
  });

  it('keeps the plain signed-out screen, without a "session no longer valid" message', async () => {
    if (fakeSocket.connect.mock.calls.length > 0) {
      await act(async () => backendAnswersHandshake());
      await flush();
    }
    expect(session.state).toEqual({ status: STATUS.SIGNED_OUT, user: null, notice: null });
  });
});
