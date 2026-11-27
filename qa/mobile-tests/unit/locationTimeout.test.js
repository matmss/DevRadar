// QA, location-settings re-check (DEV fix 04595cb for QA-LS-1): the busy state `location-loading`
// and the LOCATION_TIMEOUT_MS (15 s) bound around getCurrentPositionAsync in pages/Main.js.
//
// The 15 s budget is wall-clock time from the start of the position read, whatever the app is
// doing meanwhile. On Android, getCurrentPositionAsync with location services off first shows
// Google's "turn on location" dialog (expo-location 57: mayShowUserSettingsDialog defaults to true,
// LocationModule.kt resolveUserSettingsForRequest -> startResolutionForResult), which takes the
// app out of 'active'. A user who needs more than 15 s to read and accept it (or who switches to
// another app while the screen is busy) comes back to "Não foi possível obter sua localização.
// Verifique se ela está ativada" although they just turned it on, and the position that then
// arrives is dropped (QA-LS-2).
//
// Real Main; expo-location, AppState, AccessibilityInfo and maps mocked; Jest fake timers.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  // expo-location's LocationAccuracy values (Main asks for Balanced).
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
}));
jest.mock('react-native-maps', () => {
  const { View } = require('react-native');
  const Stub = ({ children }) => children || null;
  return { __esModule: true, default: View, Marker: Stub, Callout: Stub };
});
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('socket.io-client', () => {
  const fakeSocket = { auth: undefined, io: { opts: {} }, on: jest.fn(), off: jest.fn(), connect: jest.fn(), disconnect: jest.fn() };
  const factory = () => fakeSocket;
  factory.fakeSocket = fakeSocket;
  return { __esModule: true, default: factory };
});

const { AccessibilityInfo, AppState } = require('react-native');
const Location = require('expo-location');
const { MESSAGES } = require('../../../dev/mobile/src/services/authErrors');
const { default: Main, LOCATION_TIMEOUT_MS } = require('../../../dev/mobile/src/pages/Main');

jest.setTimeout(20000); // the first render loads react-native and the app modules

const POSITION = { coords: { latitude: -23.5505, longitude: -46.6333 } };
const BLOCKED = { granted: false, status: 'denied', canAskAgain: false };
const GRANTED = { granted: true, status: 'granted', canAskAgain: true };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let renderer;
let appStateListeners;
let originalCurrentState;

/** Lets `ms` of (fake) time pass, running timers and the promises they settle. */
async function advance(ms) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
}

/** The OS moves the app to `state`: AppState.currentState and every registered listener follow. */
async function appState(state) {
  AppState.currentState = state;
  await act(async () => { [...appStateListeners].forEach((fn) => fn(state)); });
  await advance(0);
}

const root = () => renderer.root;
const hasText = (text) => root().findAllByProps({ children: text }).length > 0;
const byTestId = (testID) => root().findAll((node) => node.props.testID === testID && typeof node.type === 'string');
const touchable = (testID) => root().findAll((node) => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
async function press(testID) {
  const node = touchable(testID);
  await act(async () => { node.props.onPress(); });
  await advance(0);
}
const announced = () => AccessibilityInfo.announceForAccessibility.mock.calls.map(([text]) => text);

async function mount() {
  await act(async () => {
    renderer = TestRenderer.create(<Main navigation={{ navigate: jest.fn() }} />);
  });
  await advance(0);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  [
    Location.requestForegroundPermissionsAsync,
    Location.getForegroundPermissionsAsync,
    Location.getCurrentPositionAsync,
  ].forEach((mock) => mock.mockReset());
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  appStateListeners = new Set();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, fn) => {
    if (event === 'change') appStateListeners.add(fn);
    return { remove: () => { appStateListeners.delete(fn); } };
  });
  originalCurrentState = AppState.currentState;
  AppState.currentState = 'active';
});

afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  AppState.currentState = originalCurrentState;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('@regression @P3 QA-LS-2: the 15 s position budget runs out while the app is not in front', () => {
  it('a fix that arrives right after the user accepted Android\'s "turn on location" dialog (or came back to the app) shows the map', async () => {
    expect(LOCATION_TIMEOUT_MS).toBe(15000);
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(GRANTED);
    const fix = deferred();
    Location.getCurrentPositionAsync.mockReturnValueOnce(fix.promise);
    await mount();
    expect(byTestId('location-loading')).toHaveLength(1);

    // getCurrentPositionAsync opened the system "turn on location" dialog (or the user switched
    // apps): the app is not in front for 20 s.
    await appState('background');
    await advance(20000);
    await appState('active');

    // Location is on now and the fix arrives a moment later.
    await act(async () => { fix.resolve(POSITION); });
    await advance(0);

    // Expected: the map (the budget is for a fix the app is waiting on in front, not for time
    // the user spends in a system dialog or another app). Actual: "unavailable" was set at 15 s
    // while the app was in the background, and the position that arrived is dropped.
    expect(hasText(MESSAGES.locationUnavailable)).toBe(false);
    expect(byTestId('map-view').length).toBeGreaterThan(0);
  });
});

// Guards for the fix (pass on 04595cb).
describe('@regression @P2 location busy state and timeout: guards', () => {
  it('after a timeout, "Tentar novamente" starts a fresh 15 s budget; the first read answering late changes nothing', async () => {
    Location.requestForegroundPermissionsAsync.mockResolvedValue(GRANTED);
    const first = deferred();
    const second = deferred();
    Location.getCurrentPositionAsync.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await mount();
    await advance(LOCATION_TIMEOUT_MS);
    expect(hasText(MESSAGES.locationUnavailable)).toBe(true);

    await press('location-retry-button');
    expect(byTestId('location-loading')).toHaveLength(1);
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(2);

    // The first (timed-out) read answers late: no map, the second read is still awaited.
    await act(async () => { first.resolve(POSITION); });
    await advance(0);
    expect(byTestId('map-view')).toHaveLength(0);
    expect(byTestId('location-loading')).toHaveLength(1);

    // No leftover timer from the first read ends the second one early.
    await advance(LOCATION_TIMEOUT_MS - 1);
    expect(byTestId('location-loading')).toHaveLength(1);
    await advance(1);
    expect(hasText(MESSAGES.locationUnavailable)).toBe(true);
    expect(touchable('location-retry-button')).toBeDefined();
  });

  it('a permission read that throws on return to the app releases the check: "unavailable", and the retry works', async () => {
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED).mockResolvedValueOnce(GRANTED);
    Location.getForegroundPermissionsAsync.mockRejectedValueOnce(new Error('No permissions module'));
    Location.getCurrentPositionAsync.mockResolvedValueOnce(POSITION);
    await mount();
    expect(hasText(MESSAGES.locationBlocked)).toBe(true);

    await appState('active');
    expect(hasText(MESSAGES.locationUnavailable)).toBe(true);

    await press('location-retry-button');
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
    expect(byTestId('map-view').length).toBeGreaterThan(0);
  });

  it('unmounted while the permission is asked: a late answer reads no position and announces nothing', async () => {
    const ask = deferred();
    Location.requestForegroundPermissionsAsync.mockReturnValueOnce(ask.promise);
    await mount();
    expect(byTestId('location-loading')).toHaveLength(1);
    const before = announced().length;
    await act(async () => renderer.unmount());
    renderer = null;

    await act(async () => { ask.resolve(GRANTED); });
    await advance(LOCATION_TIMEOUT_MS);
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(announced()).toHaveLength(before);
  });

  it('AppState flaps while still blocked announce nothing new and never show the busy state', async () => {
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
    Location.getForegroundPermissionsAsync.mockResolvedValue(BLOCKED);
    await mount();
    const before = announced();
    for (let i = 0; i < 5; i += 1) {
      await appState('background');
      await appState('active');
      expect(byTestId('location-loading')).toHaveLength(0);
    }
    expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(5);
    expect(announced()).toEqual(before);
  });
});
