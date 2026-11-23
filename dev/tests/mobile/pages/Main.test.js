// src/pages/Main.js: location failures show a message instead of crashing, and a search answered
// for another session (or after the screen is gone) never opens the live subscription.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

// A cold Jest cache on a loaded machine has pushed the first render past Jest's 5 s default.
jest.setTimeout(30000);

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
jest.mock('../../../mobile/src/services/session', () => ({ getToken: jest.fn() }));

const Location = require('expo-location');
// Jest mocks from the react-native preset (AppState.addEventListener, Linking.openSettings,
// AccessibilityInfo.announceForAccessibility).
const { AccessibilityInfo, AppState, Linking } = require('react-native');
const { fakeSocket } = require('socket.io-client').default;
const { getToken } = require('../../../mobile/src/services/session');
const { default: api } = require('../../../mobile/src/services/api');
const { MESSAGES } = require('../../../mobile/src/services/authErrors');
const { default: Main, LOCATION_TIMEOUT_MS } = require('../../../mobile/src/pages/Main');

const POSITION = { coords: { latitude: -23.5505, longitude: -46.6333 } };

// Test isolation. Jest does not stop a test that times out: its remaining steps keep running
// during the next tests. With one shared `renderer` variable, such a leftover test used or
// replaced the next test's renderer, so one timeout failed every following test ("Can't access
// .root on unmounted test renderer"). Now every renderer belongs to the test that mounted it,
// afterEach unmounts that test's renderers, and a leftover step of an ended test throws instead
// of touching anything (whatever it mounts late is unmounted at once).
let currentTest = null;

function assertRunning(test) {
  if (test.ended) throw new Error('This test already ended (timed out); its leftover steps are stopped.');
}

async function unmountOnce(test, renderer) {
  if (test.unmounted.has(renderer)) return;
  test.unmounted.add(renderer);
  await act(async () => renderer.unmount());
}

/** The handlers Main registered for `event` (the fake socket records every `on`). */
const handlersFor = (event) => fakeSocket.on.mock.calls.filter(([name]) => name === event).map(([, fn]) => fn);

// True while the running test uses Jest's fake timers (useFakeTimers below).
let fakeTimers = false;

function useFakeTimers() {
  jest.useFakeTimers();
  fakeTimers = true;
}

/** Lets pending promises and zero-delay timers run, with real or fake timers. */
async function settle() {
  if (fakeTimers) await jest.advanceTimersByTimeAsync(0);
  else await new Promise((resolve) => setTimeout(resolve, 0));
}

// AppState 'change' listeners that are still registered (each test starts with none).
let appStateListeners = new Set();

/** Every AppState 'change' handler ever registered, removed or not. */
const allAppStateHandlers = () => AppState.addEventListener.mock.calls.filter(([event]) => event === 'change').map(([, fn]) => fn);

/** A promise the test settles itself, to hold a check in flight. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const DENIED = { granted: false, status: 'denied', canAskAgain: true };
const BLOCKED = { granted: false, status: 'denied', canAskAgain: false };
const GRANTED = { granted: true, status: 'granted', canAskAgain: true };

/** Mounts Main for the running test; every helper on the result belongs to that test. */
async function mount() {
  const test = currentTest; // read before the first await: the test that called mount()
  assertRunning(test);
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<Main navigation={{ navigate: jest.fn() }} />);
  });
  test.renderers.push(renderer);
  if (test.ended) {
    await unmountOnce(test, renderer);
    assertRunning(test);
  }

  const view = {
    navigate: renderer.root.props.navigation.navigate,
    root: () => {
      assertRunning(test);
      return renderer.root;
    },
    async flush() {
      assertRunning(test);
      await act(async () => { await settle(); });
    },
    /** With fake timers: lets `ms` pass (and the promises that settles). */
    async advance(ms) {
      assertRunning(test);
      await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
    },
    /** Presses the touchable with this testID (the composite element carries onPress). */
    async press(testID) {
      const [touchable] = view.root().findAll((node) => node.props.testID === testID && typeof node.props.onPress === 'function');
      await act(async () => { touchable.props.onPress(); });
    },
    /** Delivers a push the way socket.io-client would, to every registered handler. */
    async push(event, payload) {
      assertRunning(test);
      await act(async () => { handlersFor(event).forEach(fn => fn(payload)); });
    },
    async unmount() {
      assertRunning(test);
      await unmountOnce(test, renderer);
    },
    /** The app changes state (e.g. 'active' back from the settings): the registered listeners hear it. */
    async appState(state) {
      assertRunning(test);
      await act(async () => { [...appStateListeners].forEach(fn => fn(state)); });
    },
    hasText: (text) => view.root().findAllByProps({ children: text }).length > 0,
    byTestId: (testID) => view.root().findAll((node) => node.props.testID === testID && typeof node.type === 'string'),
    /** The markers on the map, in order: id and coordinate. */
    markers: () => view.root()
      .findAll(node => typeof node.type !== 'string' && typeof node.props.testID === 'string' && node.props.testID.startsWith('marker-'))
      .map(node => ({ id: node.props.testID.slice('marker-'.length), coordinate: node.props.coordinate })),
    calloutText: (testID) => view.byTestId(testID).map(node => node.props.children),
  };

  await view.flush();
  return view;
}

describe('Main', () => {
  let warn;
  beforeEach(() => {
    currentTest = { renderers: [], unmounted: new Set(), ended: false };
    jest.clearAllMocks();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    getToken.mockReturnValue('token-1');
    // clearAllMocks keeps unused mock*Once values: a test that ends before using one would hand
    // it to the next test. Reset the mocks whose answers the tests queue.
    [
      Location.requestForegroundPermissionsAsync,
      Location.getForegroundPermissionsAsync,
      Location.getCurrentPositionAsync,
      AppState.addEventListener,
      Linking.openSettings,
      AccessibilityInfo.announceForAccessibility,
    ].forEach(mock => mock.mockReset());
    Location.requestForegroundPermissionsAsync.mockResolvedValue({ granted: true });
    Location.getForegroundPermissionsAsync.mockResolvedValue(GRANTED);
    Location.getCurrentPositionAsync.mockResolvedValue(POSITION);
    appStateListeners = new Set();
    AppState.addEventListener.mockImplementation((event, fn) => {
      if (event === 'change') appStateListeners.add(fn);
      return { remove: jest.fn(() => { appStateListeners.delete(fn); }) };
    });
    Linking.openSettings.mockResolvedValue(undefined);
  });
  afterEach(async () => {
    const test = currentTest;
    test.ended = true;
    for (const renderer of test.renderers) await unmountOnce(test, renderer);
    warn.mockRestore();
    if (fakeTimers) {
      jest.useRealTimers();
      fakeTimers = false;
    }
  });

  describe('location', () => {
    it('shows a message and a retry when the location cannot be read (e.g. services off)', async () => {
      Location.getCurrentPositionAsync.mockRejectedValueOnce(new Error('Location services are disabled'));
      const view = await mount();
      expect(view.byTestId('location-error')).toHaveLength(1);
      expect(view.root().findAllByProps({ children: MESSAGES.locationUnavailable }).length).toBeGreaterThan(0);
      expect(view.byTestId('map-view')).toHaveLength(0);

      await view.press('location-retry-button');
      await view.flush();
      expect(view.byTestId('location-error')).toHaveLength(0);
      expect(view.byTestId('map-view')).toHaveLength(1);
    });

    it('shows a message when the permission request itself fails', async () => {
      Location.requestForegroundPermissionsAsync.mockRejectedValueOnce(new Error('no activity'));
      const view = await mount();
      expect(view.root().findAllByProps({ children: MESSAGES.locationUnavailable }).length).toBeGreaterThan(0);
    });

    it('asks for the permission when it is denied (a response without canAskAgain counts as "can ask")', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: false });
      const view = await mount();
      expect(view.root().findAllByProps({ children: MESSAGES.locationDenied }).length).toBeGreaterThan(0);
      expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    });

    it('does not check the location again on returning to the app when it could not be read (services off)', async () => {
      Location.getCurrentPositionAsync.mockRejectedValueOnce(new Error('Location services are disabled'));
      const view = await mount();
      await view.appState('active');
      await view.flush();
      expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(view.hasText(MESSAGES.locationUnavailable)).toBe(true);
      expect(view.byTestId('open-settings')).toHaveLength(0);
    });
  });

  // Backlog "location-denied message points to system settings": once the system will not ask
  // any more (canAskAgain false), "Tentar novamente" alone was a dead end.
  describe('location permission', () => {
    it('denied but the system can still ask: the "allow" message and a retry that asks again', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(DENIED);
      const view = await mount();
      expect(view.byTestId('location-error')).toHaveLength(1);
      expect(view.hasText(MESSAGES.locationDenied)).toBe(true);
      expect(view.hasText(MESSAGES.locationBlocked)).toBe(false);
      expect(view.byTestId('open-settings')).toHaveLength(0);

      await view.press('location-retry-button');
      await view.flush();
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
      expect(view.byTestId('map-view')).toHaveLength(1);
    });

    it('blocked (the system will not ask again): says to enable it in the settings, with "Abrir configurações" and "Tentar novamente"', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
      const view = await mount();
      expect(view.byTestId('location-error')).toHaveLength(1);
      expect(view.hasText(MESSAGES.locationBlocked)).toBe(true);
      expect(view.hasText(MESSAGES.locationDenied)).toBe(false);
      expect(MESSAGES.locationBlocked).toBe('A localização está bloqueada para o DevRadar. Ative-a nas configurações do aparelho para ver os devs perto de você.');

      const [settings] = view.byTestId('open-settings');
      expect(settings.props.accessibilityRole).toBe('button');
      expect(settings.props.accessibilityLabel).toBe('Abrir configurações');
      expect(view.hasText('Abrir configurações')).toBe(true);
      const [retry] = view.byTestId('location-retry-button');
      expect(retry.props.accessibilityRole).toBe('button');
      expect(retry.props.accessibilityLabel).toBe('Tentar novamente');
      expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
      expect(Linking.openSettings).not.toHaveBeenCalled();
    });

    it('"Abrir configurações" opens the device settings and keeps the screen', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
      const view = await mount();
      await view.press('open-settings');
      await view.flush();
      expect(Linking.openSettings).toHaveBeenCalledTimes(1);
      expect(view.hasText(MESSAGES.locationBlocked)).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    });

    it.each([
      ['rejects', () => Promise.reject(new Error('Unable to open settings'))],
      ['throws', () => { throw new Error('Unable to open settings'); }],
    ])('if opening the settings %s: a warning, the screen stays, no unhandled rejection', async (_label, impl) => {
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);
      try {
        Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
        Linking.openSettings.mockImplementation(impl);
        const view = await mount();
        await view.press('open-settings');
        await view.flush();
        await view.flush();
        expect(Linking.openSettings).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith('Could not open the device settings:', 'Unable to open settings');
        expect(view.byTestId('location-error')).toHaveLength(1);
        expect(view.byTestId('open-settings')).toHaveLength(1);
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });

    it('"Tentar novamente" while blocked checks the permission again and shows the map once it is allowed', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED).mockResolvedValueOnce(BLOCKED);
      const view = await mount();
      await view.press('location-retry-button');
      await view.flush();
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
      expect(view.hasText(MESSAGES.locationBlocked)).toBe(true);

      await view.press('location-retry-button');
      await view.flush();
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(3);
      expect(view.byTestId('map-view')).toHaveLength(1);
    });

    it('back in the app after allowing it in the settings: checks without a prompt and shows the map', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
      const view = await mount();
      await view.press('open-settings');
      Location.getForegroundPermissionsAsync.mockResolvedValueOnce(GRANTED);

      await view.appState('background');
      await view.flush();
      expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();

      await view.appState('active');
      await view.flush();
      expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1); // never asked again
      expect(view.byTestId('location-error')).toHaveLength(0);
      expect(view.byTestId('map-view')).toHaveLength(1);
      // The map is shown: no more checks on later returns.
      expect(appStateListeners.size).toBe(0);
      await view.appState('active');
      await view.flush();
      expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    });

    it('back in the app still blocked: keeps the message on screen while checking, and after', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
      const view = await mount();
      const check = deferred();
      Location.getForegroundPermissionsAsync.mockReturnValueOnce(check.promise);

      await view.appState('active');
      expect(view.hasText(MESSAGES.locationBlocked)).toBe(true); // no blank screen meanwhile
      await act(async () => { check.resolve(BLOCKED); });
      await view.flush();
      expect(view.hasText(MESSAGES.locationBlocked)).toBe(true);
      expect(view.byTestId('open-settings')).toHaveLength(1);
      expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    });

    it('back in the app while denied but askable: reads the permission, never prompts', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(DENIED);
      const view = await mount();
      Location.getForegroundPermissionsAsync.mockResolvedValue(DENIED);

      await view.appState('active');
      await view.flush();
      await view.appState('active');
      await view.flush();
      expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(view.hasText(MESSAGES.locationDenied)).toBe(true);
    });

    it('back in the app, now blocked (the user chose "don\'t ask again" elsewhere): switches to the settings message', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(DENIED);
      const view = await mount();
      Location.getForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
      await view.appState('active');
      await view.flush();
      expect(view.hasText(MESSAGES.locationBlocked)).toBe(true);
      expect(view.byTestId('open-settings')).toHaveLength(1);
    });

    it('back in the app, allowed, but no position: the "unavailable" message, and no more checks on return', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
      const view = await mount();
      Location.getCurrentPositionAsync.mockRejectedValueOnce(new Error('Location services are disabled'));
      await view.appState('active');
      await view.flush();
      expect(view.hasText(MESSAGES.locationUnavailable)).toBe(true);
      expect(view.byTestId('open-settings')).toHaveLength(0);

      await view.appState('active');
      await view.flush();
      expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    });

    it('never checks on returning to the app when there is no error (map shown)', async () => {
      const view = await mount();
      expect(view.byTestId('map-view')).toHaveLength(1);
      await view.appState('active');
      await view.flush();
      expect(AppState.addEventListener).not.toHaveBeenCalled();
      expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    });

    it('one check at a time: repeated returns and a retry tap during a check do not start another', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
      const view = await mount();
      const check = deferred();
      Location.getForegroundPermissionsAsync.mockReturnValueOnce(check.promise);

      await view.appState('active');
      await view.appState('active');
      await view.appState('active');
      await view.press('location-retry-button');
      expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);

      await act(async () => { check.resolve(GRANTED); });
      await view.flush();
      expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
      expect(view.byTestId('map-view')).toHaveLength(1);
    });

    it('the system prompt taking the app out of "active" and back checks nothing (no prompt storm)', async () => {
      const request = deferred();
      Location.requestForegroundPermissionsAsync.mockReturnValueOnce(request.promise);
      const view = await mount();
      await view.appState('inactive');
      await view.appState('active');
      expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
      await act(async () => { request.resolve(BLOCKED); });
      await view.flush();
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(view.hasText(MESSAGES.locationBlocked)).toBe(true);
    });

    it('removes the AppState listener on unmount, and a late event checks nothing', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
      const view = await mount();
      expect(appStateListeners.size).toBe(1);
      const [handler] = allAppStateHandlers();
      await view.unmount();
      expect(appStateListeners.size).toBe(0);

      await act(async () => { handler('active'); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    });

    it('a check still in flight at unmount reads no position and changes nothing', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
      const view = await mount();
      const check = deferred();
      Location.getForegroundPermissionsAsync.mockReturnValueOnce(check.promise);
      await view.appState('active');
      await view.unmount();

      await act(async () => { check.resolve(GRANTED); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    });
  });

  // QA-LS-1: while the position is read the screen is busy (never blank, never "allow it", never
  // a retry that does nothing), and a fix that never comes ends after LOCATION_TIMEOUT_MS.
  describe('reading the position', () => {
    /** The busy state is shown, and nothing else: no message, no buttons. */
    function expectBusy(view) {
      const [busy] = view.byTestId('location-loading');
      expect(busy).toBeDefined();
      expect(busy.props.accessibilityState).toEqual({ busy: true });
      expect(busy.props.accessibilityLabel).toBe(MESSAGES.locating);
      expect(view.hasText(MESSAGES.locating)).toBe(true);
      expect(view.byTestId('location-error')).toHaveLength(0);
      expect(view.byTestId('open-settings')).toHaveLength(0);
      expect(view.byTestId('location-retry-button')).toHaveLength(0);
      expect(view.byTestId('map-view')).toHaveLength(0);
    }

    it('first launch: busy while the permission is asked and while the position is read, then the map', async () => {
      const request = deferred();
      const fix = deferred();
      Location.requestForegroundPermissionsAsync.mockReturnValueOnce(request.promise);
      Location.getCurrentPositionAsync.mockReturnValueOnce(fix.promise);
      const view = await mount();
      expectBusy(view);
      await act(async () => { request.resolve(GRANTED); });
      await view.flush();
      expectBusy(view);
      await act(async () => { fix.resolve(POSITION); });
      await view.flush();
      expect(view.byTestId('location-loading')).toHaveLength(0);
      expect(view.byTestId('map-view')).toHaveLength(1);
    });

    it('"Tentar novamente": busy at once instead of a blank screen', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
      const view = await mount();
      const request = deferred();
      Location.requestForegroundPermissionsAsync.mockReturnValueOnce(request.promise);
      await view.press('location-retry-button');
      expectBusy(view);
      await act(async () => { request.resolve(BLOCKED); });
      await view.flush();
      expect(view.hasText(MESSAGES.locationBlocked)).toBe(true);
    });

    it('back in the app with the permission now allowed: the blocked message gives way to the busy state at once', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
      const view = await mount();
      const fix = deferred();
      Location.getCurrentPositionAsync.mockReturnValueOnce(fix.promise);
      await view.appState('active');
      await view.flush();
      expectBusy(view);
      await act(async () => { fix.resolve(POSITION); });
      await view.flush();
      expect(view.byTestId('map-view')).toHaveLength(1);
    });

    it(`a fix that never comes: "unavailable" after ${LOCATION_TIMEOUT_MS} ms, and "Tentar novamente" works again`, async () => {
      expect(LOCATION_TIMEOUT_MS).toBe(15000);
      useFakeTimers();
      Location.getCurrentPositionAsync.mockReturnValueOnce(new Promise(() => {}));
      const view = await mount();
      expectBusy(view);

      await view.advance(LOCATION_TIMEOUT_MS - 1);
      expectBusy(view);
      await view.advance(1);
      expect(view.hasText(MESSAGES.locationUnavailable)).toBe(true);
      expect(view.byTestId('location-loading')).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith('Could not get the current location:', `No position within ${LOCATION_TIMEOUT_MS} ms`);

      // The check is over (lock released): the retry asks and reads again.
      await view.press('location-retry-button');
      await view.flush();
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(2);
      expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(2);
      expect(view.byTestId('map-view')).toHaveLength(1);
      expect(jest.getTimerCount()).toBe(0); // the answered read's timer is cleared
    });

    it('after a return from the settings too: the fix times out, then the retry works', async () => {
      useFakeTimers();
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
      const view = await mount();
      Location.getCurrentPositionAsync.mockReturnValueOnce(new Promise(() => {}));
      await view.appState('active');
      await view.flush();
      expectBusy(view);
      await view.advance(LOCATION_TIMEOUT_MS);
      expect(view.hasText(MESSAGES.locationUnavailable)).toBe(true);

      await view.press('location-retry-button');
      await view.flush();
      expect(view.byTestId('map-view')).toHaveLength(1);
    });

    // QA-LS-2: the timer also runs while the app is not in front (e.g. Android's own "turn on
    // location" dialog, opened by the read), so a late position is still used if nothing else
    // happened since the timeout.
    it('a position that arrives after the timeout, with nothing else started since, shows the map (and announces nothing for it)', async () => {
      useFakeTimers();
      const late = deferred();
      Location.getCurrentPositionAsync.mockReturnValueOnce(late.promise);
      const view = await mount();
      await view.advance(LOCATION_TIMEOUT_MS + 5000);
      expect(view.hasText(MESSAGES.locationUnavailable)).toBe(true);
      const announcedBefore = AccessibilityInfo.announceForAccessibility.mock.calls.length;

      await act(async () => { late.resolve(POSITION); });
      await view.flush();
      expect(view.byTestId('location-error')).toHaveLength(0);
      expect(view.byTestId('map-view')).toHaveLength(1);
      expect(view.byTestId('map-view')[0].props.initialRegion).toEqual({
        latitude: -23.5505, longitude: -46.6333, latitudeDelta: 0.04, longitudeDelta: 0.04,
      });
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(announcedBefore);
    });

    it('a timed-out position that arrives while a retry is still reading is ignored: the retry decides', async () => {
      useFakeTimers();
      const first = deferred();
      const second = deferred();
      Location.getCurrentPositionAsync.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const view = await mount();
      await view.advance(LOCATION_TIMEOUT_MS);
      await view.press('location-retry-button');
      await view.flush();
      expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(2);

      await act(async () => { first.resolve(POSITION); });
      await view.flush();
      expect(view.byTestId('map-view')).toHaveLength(0);
      expect(view.byTestId('location-loading')).toHaveLength(1);

      await act(async () => { second.resolve({ coords: { latitude: -22.9068, longitude: -43.1729 } }); });
      await view.flush();
      expect(view.byTestId('map-view')[0].props.initialRegion).toMatchObject({ latitude: -22.9068, longitude: -43.1729 });
    });

    it('a timed-out position that arrives after a retry ended blocked is ignored', async () => {
      useFakeTimers();
      const late = deferred();
      Location.getCurrentPositionAsync.mockReturnValueOnce(late.promise);
      const view = await mount();
      await view.advance(LOCATION_TIMEOUT_MS);
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
      await view.press('location-retry-button');
      await view.flush();
      expect(view.hasText(MESSAGES.locationBlocked)).toBe(true);

      await act(async () => { late.resolve(POSITION); });
      await view.flush();
      expect(view.hasText(MESSAGES.locationBlocked)).toBe(true);
      expect(view.byTestId('map-view')).toHaveLength(0);
    });

    // React 19 ignores state updates of an unmounted component silently, so this only shows that a
    // late position after unmount errs and logs nothing; the mounted guard itself is defensive.
    it('a timed-out position that arrives after unmount: no error, no extra log', async () => {
      useFakeTimers();
      const late = deferred();
      Location.getCurrentPositionAsync.mockReturnValueOnce(late.promise);
      const view = await mount();
      await view.advance(LOCATION_TIMEOUT_MS);
      await view.unmount();
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await act(async () => { late.resolve(POSITION); });
        await act(async () => { await settle(); });
        expect(consoleError).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1); // the timeout only
      } finally {
        consoleError.mockRestore();
      }
    });

    it('a position that fails after the timeout changes nothing and is no unhandled rejection', async () => {
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);
      try {
        useFakeTimers();
        const late = deferred();
        Location.getCurrentPositionAsync.mockReturnValueOnce(late.promise);
        const view = await mount();
        await view.advance(LOCATION_TIMEOUT_MS);
        await act(async () => { late.reject(new Error('Location request failed')); });
        await view.flush();
        jest.useRealTimers();
        fakeTimers = false;
        await view.flush();
        expect(view.hasText(MESSAGES.locationUnavailable)).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });

    it('unmounting while the position is read clears the timer: nothing happens at the timeout', async () => {
      useFakeTimers();
      Location.getCurrentPositionAsync.mockReturnValueOnce(new Promise(() => {}));
      const view = await mount();
      expect(jest.getTimerCount()).toBe(1); // the position timeout
      await view.unmount();
      // A timeout that still fired would reject the read and log "Could not get the current location".
      await act(async () => { await jest.advanceTimersByTimeAsync(LOCATION_TIMEOUT_MS); });
      expect(warn).not.toHaveBeenCalled();
    });

    it('a timeout during a return-to-app check: the AppState listener comes back only with a permission message', async () => {
      useFakeTimers();
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
      const view = await mount();
      Location.getCurrentPositionAsync.mockReturnValueOnce(new Promise(() => {}));
      await view.appState('active');
      await view.flush();
      expect(appStateListeners.size).toBe(0); // busy: no re-check on return
      await view.advance(LOCATION_TIMEOUT_MS);
      expect(appStateListeners.size).toBe(0); // unavailable: no re-check on return either
    });
  });

  // Screen readers: accessibilityRole="alert" alone is not announced on Android.
  describe('announcements', () => {
    const announced = () => AccessibilityInfo.announceForAccessibility.mock.calls.map(([text]) => text);

    it('announces the busy state and then each new location message', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
      const view = await mount();
      expect(announced()).toEqual([MESSAGES.locating, MESSAGES.locationBlocked]);

      Location.getForegroundPermissionsAsync.mockResolvedValueOnce(DENIED);
      await view.appState('active');
      await view.flush();
      expect(announced()).toEqual([MESSAGES.locating, MESSAGES.locationBlocked, MESSAGES.locationDenied]);
    });

    it('does not repeat a message that did not change (back in the app, still blocked)', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce(BLOCKED);
      const view = await mount();
      Location.getForegroundPermissionsAsync.mockResolvedValue(BLOCKED);
      await view.appState('active');
      await view.flush();
      await view.appState('active');
      await view.flush();
      expect(announced()).toEqual([MESSAGES.locating, MESSAGES.locationBlocked]);
    });

    it('announces "unavailable", and nothing once the map is shown', async () => {
      Location.getCurrentPositionAsync.mockRejectedValueOnce(new Error('Location services are disabled'));
      const view = await mount();
      expect(announced()).toEqual([MESSAGES.locating, MESSAGES.locationUnavailable]);
      await view.press('location-retry-button');
      await view.flush();
      expect(view.byTestId('map-view')).toHaveLength(1);
      // The retry's busy state may or may not have rendered before the map (React batches the
      // updates of a fast answer); the map itself is never announced.
      expect(announced().slice(0, 2)).toEqual([MESSAGES.locating, MESSAGES.locationUnavailable]);
      expect(announced().slice(2).every(text => text === MESSAGES.locating)).toBe(true);
    });
  });

  describe('search and live subscription', () => {
    let answerSearch;
    beforeEach(() => {
      const answered = new Promise((resolve) => { answerSearch = resolve; });
      api.defaults.adapter = async (config) => {
        await answered;
        return { status: 200, statusText: 'OK', headers: {}, config, data: { devs: [] } };
      };
    });

    it('subscribes with the token the search was sent with', async () => {
      const view = await mount();
      await view.press('search-button');
      await act(async () => { answerSearch(); });
      await view.flush();
      expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
      expect(fakeSocket.auth).toEqual({ token: 'token-1' });
    });

    it('does not subscribe if another session is in use when the search answers', async () => {
      const view = await mount();
      await view.press('search-button');
      getToken.mockReturnValue('token-2'); // signed out and in again meanwhile
      await act(async () => { answerSearch(); });
      await view.flush();
      expect(fakeSocket.connect).not.toHaveBeenCalled();
    });

    it('does not subscribe once the screen is gone', async () => {
      const view = await mount();
      await view.press('search-button');
      await view.unmount();
      await act(async () => { answerSearch(); });
      await view.flush();
      expect(fakeSocket.connect).not.toHaveBeenCalled();
    });

    it.each([
      ['a 503 profile_busy says "busy, try again"', 503, { error: 'Profile is busy', code: 'profile_busy', details: [] }, MESSAGES.profileBusy],
      ['a 503 with another code is a failed search', 503, { code: 'not_configured' }, MESSAGES.searchFailed],
      ['a 500 is a failed search', 500, { code: 'internal_error' }, MESSAGES.searchFailed],
    ])('%s, and keeps the screen', async (_label, status, data, message) => {
      api.defaults.adapter = async (config) => {
        const error = new Error(`Request failed with status code ${status}`);
        error.config = config;
        error.response = { status, statusText: String(status), headers: {}, config, data };
        throw error;
      };
      const view = await mount();
      await view.press('search-button');
      await view.flush();
      expect(view.calloutText('search-error')).toEqual([message]);
      expect(view.byTestId('map-view')).toHaveLength(1);
      expect(fakeSocket.connect).not.toHaveBeenCalled();
    });

    it('does not search at all without a session', async () => {
      const view = await mount();
      getToken.mockReturnValue(null);
      const adapter = jest.fn(api.defaults.adapter);
      api.defaults.adapter = adapter;
      await view.press('search-button');
      await act(async () => { answerSearch(); });
      await view.flush();
      expect(adapter).not.toHaveBeenCalled();
      expect(fakeSocket.connect).not.toHaveBeenCalled();
    });
  });

  // US-7 "Live profile update" (auth slice 5): dev-updated replaces the dev's marker in place,
  // or adds it, without a new search; dev-deleted removes it.
  describe('live updates', () => {
    const SEARCHED = [
      { _id: 'a1', github_username: 'alice', name: 'Alice', bio: '', techs: ['ReactJS'], location: { type: 'Point', coordinates: [-46.63, -23.55] } },
      { _id: 'g1', github_username: 'gaearon', name: 'Dan', bio: '', techs: ['ReactJS'], location: { type: 'Point', coordinates: [-46.64, -23.56] } },
    ];

    beforeEach(() => {
      api.defaults.adapter = async (config) => ({ status: 200, statusText: 'OK', headers: {}, config, data: { devs: SEARCHED } });
    });

    async function searchAndShow() {
      const view = await mount();
      await view.press('search-button');
      await view.flush();
      expect(view.markers().map(marker => marker.id)).toEqual(['a1', 'g1']);
      return view;
    }

    it('moves and updates the marker of a dev who updated their profile, in place, without a new search', async () => {
      const view = await searchAndShow();
      const searches = jest.fn(api.defaults.adapter);
      api.defaults.adapter = searches;

      await view.push('dev-updated', { ...SEARCHED[1], techs: ['Elixir'], location: { type: 'Point', coordinates: [-46.65, -23.57] } });

      expect(view.markers()).toEqual([
        { id: 'a1', coordinate: { latitude: -23.55, longitude: -46.63 } },
        { id: 'g1', coordinate: { latitude: -23.57, longitude: -46.65 } },
      ]);
      expect(view.calloutText('callout-techs')).toEqual(['ReactJS', 'Elixir']);
      expect(searches).not.toHaveBeenCalled();
    });

    it('matches the dev by github_username in any letter case', async () => {
      const view = await searchAndShow();
      await view.push('dev-updated', { ...SEARCHED[1], _id: 'g2', github_username: 'Gaearon', techs: ['Go'] });
      expect(view.markers().map(marker => marker.id)).toEqual(['a1', 'g2']);
      expect(view.calloutText('callout-techs')).toEqual(['ReactJS', 'Go']);
    });

    it('adds a dev who now matches but was not on the map', async () => {
      const view = await searchAndShow();
      await view.push('dev-updated', { _id: 'c1', github_username: 'carol', name: 'Carol', bio: '', techs: ['ReactJS'], location: { type: 'Point', coordinates: [-46.6, -23.5] } });
      expect(view.markers().map(marker => marker.id)).toEqual(['a1', 'g1', 'c1']);
    });

    // Auth slice 6 (QA-AUTH6-1): a dev whose login GitHub gave to another account is displaced:
    // the backend pushes dev-updated with a placeholder login and github_username_stale.
    it('opens the GitHub profile of a dev with a current login from its callout', async () => {
      const view = await searchAndShow();
      await view.press('callout-g1');
      expect(view.navigate).toHaveBeenCalledWith('Profile', { github_username: 'gaearon' });
      expect(view.calloutText('callout-no-profile')).toEqual([]);
    });

    it('keeps a displaced dev on the map, says its GitHub profile is unavailable, and never opens it', async () => {
      const view = await searchAndShow();
      await view.push('dev-updated', {
        ...SEARCHED[1], github_id: 810438, github_username: '_stale_g1', github_username_stale: true,
      });
      expect(view.markers().map(marker => marker.id)).toEqual(['a1', 'g1']);
      expect(view.calloutText('callout-no-profile')).toEqual(['Perfil do GitHub indisponível']);
      await view.press('callout-g1');
      expect(view.navigate).not.toHaveBeenCalled();
    });

    it('shows a neutral name for a displaced dev whose name (the old login) was cleared', async () => {
      const view = await searchAndShow();
      await view.push('dev-updated', {
        ...SEARCHED[1], name: null, github_id: 810438, github_username: '_stale_g1', github_username_stale: true,
      });
      expect(view.calloutText('callout-name')).toEqual(['Alice', 'Dev sem nome']);
    });

    it('never opens a login that is not a GitHub login, even without the stale flag', async () => {
      const view = await searchAndShow();
      await view.push('dev-updated', { ...SEARCHED[1], github_username: '../orgs/x' });
      await view.press('callout-g1');
      expect(view.navigate).not.toHaveBeenCalled();
    });

    it('ignores a malformed dev-updated push instead of crashing', async () => {
      const view = await searchAndShow();
      await view.push('dev-updated', { _id: 'g1', github_username: 'gaearon' });
      expect(view.markers().map(marker => marker.id)).toEqual(['a1', 'g1']);
    });

    it('removes the marker of a dev who deleted their profile', async () => {
      const view = await searchAndShow();
      await view.push('dev-deleted', { _id: 'g1', github_username: 'gaearon' });
      expect(view.markers().map(marker => marker.id)).toEqual(['a1']);
    });

    it('a new-dev push for a dev already on the map replaces it instead of duplicating it', async () => {
      const view = await searchAndShow();
      await view.push('new-dev', { ...SEARCHED[0], techs: ['Go'] });
      expect(view.markers().map(marker => marker.id)).toEqual(['a1', 'g1']);
    });

    it('registers one listener per event for the screen, however often the list changes, and removes them on unmount', async () => {
      const view = await searchAndShow();
      await view.push('dev-updated', { ...SEARCHED[1], techs: ['Go'] });
      await view.push('new-dev', { ...SEARCHED[0], _id: 'n1', github_username: 'newbie' });
      await view.press('search-button');
      await view.flush();

      ['new-dev', 'dev-updated', 'dev-deleted'].forEach((event) => {
        expect(handlersFor(event)).toHaveLength(1);
      });

      const registered = ['new-dev', 'dev-updated', 'dev-deleted'].map(event => [event, handlersFor(event)[0]]);
      await view.unmount();
      registered.forEach(([event, handler]) => {
        expect(fakeSocket.off).toHaveBeenCalledWith(event, handler);
      });
    });
  });
});
