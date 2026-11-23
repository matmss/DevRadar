// QA, location-settings review (backlog "mobile location-denied message should point to system
// settings", FR-6.1, TC-021). DEV's own tests are in dev/tests/mobile/pages/Main.test.js; these
// cover what they don't: the window after a return-to-app check has read "granted" while the
// position is still being read, and the session (sign-out / sign-in again) during a check.
//
// pages/Main.js#loadInitialPosition({ ask: false }) keeps the denied/blocked message on screen
// "until the answer" and drops every other check while one runs (`checkingLocation`). The answer
// it waits for is the whole check: permission read AND getCurrentPositionAsync({
// enableHighAccuracy: true }), which can take seconds (cold GPS fix after the user just enabled
// it) and has no timeout of its own in the app. Meanwhile the screen still says the location is
// blocked and to enable it in the settings, which the user has just done, and "Tentar novamente"
// is shown and enabled but does nothing.
//
// Real Main, SessionProvider, api and session services; mocked at their boundaries (secure store,
// HTTP adapter, socket.io-client transport, expo-location, AppState, Linking, maps).
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
  requestForegroundPermissionsAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock('react-native-maps', () => {
  const { View } = require('react-native');
  const Stub = ({ children }) => children || null;
  return { __esModule: true, default: View, Marker: Stub, Callout: Stub };
});
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('socket.io-client', () => {
  const fakeSocket = {
    auth: undefined,
    io: { opts: {} },
    on: jest.fn(),
    off: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  };
  const factory = () => fakeSocket;
  factory.fakeSocket = fakeSocket;
  return { __esModule: true, default: factory };
});

const { AppState, Linking } = require('react-native');
const Location = require('expo-location');
const SecureStore = require('expo-secure-store');
const { fakeSocket } = require('socket.io-client').default;
const { default: api } = require('../../../dev/mobile/src/services/api');
const { MESSAGES } = require('../../../dev/mobile/src/services/authErrors');
const { SessionProvider, useSession } = require('../../../dev/mobile/src/SessionContext');
const { STATUS } = require('../../../dev/mobile/src/services/sessionState');
const { default: Main } = require('../../../dev/mobile/src/pages/Main');

jest.setTimeout(20000); // the first render loads react-native and the app modules

const TOKEN_KEY = 'devradar.session_token';
const USER = { github_username: 'gaearon', name: 'Dan Abramov', avatar_url: null };
const POSITION = { coords: { latitude: -23.5505, longitude: -46.6333 } };
const BLOCKED = { granted: false, status: 'denied', canAskAgain: false };
const GRANTED = { granted: true, status: 'granted', canAskAgain: true };

/** A promise that never settles: a position fix that does not come. */
const never = () => new Promise(() => {});

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

let appStateListeners;
let renderer;
let warn;

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

/** The app comes back to the foreground (e.g. from the device settings). */
async function appState(state) {
  await act(async () => { [...appStateListeners].forEach((fn) => fn(state)); });
}

const root = () => renderer.root;
const hasText = (text) => root().findAllByProps({ children: text }).length > 0;
const touchable = (testID) => root().findAll((node) => node.props.testID === testID && typeof node.props.onPress === 'function')[0];

async function press(testID) {
  const node = touchable(testID);
  await act(async () => { node.props.onPress(); });
}

/** Every location attempt the screen started so far (a prompt, a read, a position). */
const attempts = () => Location.requestForegroundPermissionsAsync.mock.calls.length
  + Location.getForegroundPermissionsAsync.mock.calls.length
  + Location.getCurrentPositionAsync.mock.calls.length;

beforeEach(() => {
  jest.clearAllMocks();
  [
    Location.requestForegroundPermissionsAsync,
    Location.getForegroundPermissionsAsync,
    Location.getCurrentPositionAsync,
  ].forEach((mock) => mock.mockReset());
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  appStateListeners = new Set();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, fn) => {
    if (event === 'change') appStateListeners.add(fn);
    return { remove: () => { appStateListeners.delete(fn); } };
  });
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  SecureStore.__store.clear();
  api.defaults.adapter = async (config) => ({
    status: 200, statusText: 'OK', headers: {}, config, data: config.url === '/search' ? { devs: [] } : USER,
  });
});

afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  jest.restoreAllMocks();
});

/** Blocked at launch, then the user enables location in the settings and comes back. */
async function blockedThenAllowedInSettings(position) {
  Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
  await act(async () => {
    renderer = TestRenderer.create(<Main navigation={{ navigate: jest.fn() }} />);
  });
  await flush();
  expect(hasText(MESSAGES.locationBlocked)).toBe(true);
  await press('open-settings');
  expect(Linking.openSettings).toHaveBeenCalledTimes(1);

  Location.getForegroundPermissionsAsync.mockResolvedValueOnce(GRANTED);
  Location.getCurrentPositionAsync.mockImplementationOnce(position);
  await appState('background');
  await appState('active');
  await flush();
  // The permission was read (no prompt) and said granted; the position is being read now.
  expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
}

describe('@regression @P2 QA-LS-1: back from the settings with location allowed, while the position is read', () => {
  it('no longer tells the user the location is blocked once the permission reads granted', async () => {
    const fix = deferred();
    await blockedThenAllowedInSettings(() => fix.promise);

    // Expected: the screen stops saying "bloqueada ... Ative-a nas configurações" (and stops
    // offering "Abrir configurações") as soon as the permission is known to be granted.
    // Actual: both stay until getCurrentPositionAsync answers (seconds for a cold GPS fix).
    expect(hasText(MESSAGES.locationBlocked)).toBe(false);
    expect(touchable('open-settings')).toBeUndefined();

    await act(async () => { fix.resolve(POSITION); });
    await flush();
  });

  it('"Tentar novamente" is not a silent no-op: if the fix never comes, the screen is a dead end', async () => {
    await blockedThenAllowedInSettings(never);

    // A shown, enabled "Tentar novamente" must do something; otherwise it must not be offered
    // (or be disabled, with a busy state). Actual: shown, enabled, every tap dropped by the
    // `checkingLocation` guard, and every later return to the app is dropped too.
    const retry = touchable('location-retry-button');
    const offered = Boolean(retry)
      && retry.props.disabled !== true
      && !(retry.props.accessibilityState && retry.props.accessibilityState.disabled);
    const before = attempts();
    if (retry) await press('location-retry-button');
    await appState('background');
    await appState('active');
    await flush();
    const startedAnything = attempts() > before;

    expect({ offered, startedAnything }).not.toEqual({ offered: true, startedAnything: false });
  });
});

// Session interaction (QA-AUTH4-1 style): these pass on 01d06fb; they guard the per-screen
// `mounted` / `checkingLocation` refs against becoming shared (module-level) state.
let session;
function Screens() {
  session = useSession();
  return session.state.status === STATUS.SIGNED_IN ? <Main navigation={{ navigate: jest.fn() }} /> : null;
}

describe('@regression @P2 location check vs the session', () => {
  it('"Sair" while a return-to-app check is in flight: nothing after, and the next sign-in asks for location afresh', async () => {
    SecureStore.__store.set(TOKEN_KEY, 'token-1');
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
    await act(async () => {
      renderer = TestRenderer.create(<SessionProvider><Screens /></SessionProvider>);
    });
    await flush();
    expect(session.state.status).toBe(STATUS.SIGNED_IN);
    expect(hasText(MESSAGES.locationBlocked)).toBe(true);

    const read = deferred();
    Location.getForegroundPermissionsAsync.mockReturnValueOnce(read.promise);
    await appState('active');
    expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);

    await act(async () => session.signOut());
    expect(session.state.status).toBe(STATUS.SIGNED_OUT);
    expect(appStateListeners.size).toBe(0);

    // The old screen's read answers "granted" after the sign-out: no position, no socket.
    await act(async () => { read.resolve(GRANTED); });
    await flush();
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(fakeSocket.connect).not.toHaveBeenCalled();
    expect(session.state).toEqual({ status: STATUS.SIGNED_OUT, user: null, notice: null });

    // A session again (restored from secure store, as at launch) mounts a new map screen, whose own
    // first check is not blocked by the old one's.
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(GRANTED);
    Location.getCurrentPositionAsync.mockResolvedValueOnce(POSITION);
    SecureStore.__store.set(TOKEN_KEY, 'token-2');
    await act(async () => session.retry());
    await flush();
    expect(session.state.status).toBe(STATUS.SIGNED_IN);
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
    expect(root().findAll((node) => node.props.testID === 'map-view').length).toBeGreaterThan(0);
  });

  it('"Sair" while the position is read after a return-to-app check: the late position changes nothing', async () => {
    SecureStore.__store.set(TOKEN_KEY, 'token-1');
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
    await act(async () => {
      renderer = TestRenderer.create(<SessionProvider><Screens /></SessionProvider>);
    });
    await flush();

    const fix = deferred();
    Location.getForegroundPermissionsAsync.mockResolvedValueOnce(GRANTED);
    Location.getCurrentPositionAsync.mockReturnValueOnce(fix.promise);
    await appState('active');
    await flush();
    await act(async () => session.signOut());

    await act(async () => { fix.resolve(POSITION); });
    await flush();
    expect(fakeSocket.connect).not.toHaveBeenCalled();
    expect(session.state).toEqual({ status: STATUS.SIGNED_OUT, user: null, notice: null });
    expect(root().findAll((node) => node.props.testID === 'map-view')).toHaveLength(0);
  });
});
