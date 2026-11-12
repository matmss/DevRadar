// src/pages/Main.js: location failures show a message instead of crashing, and a search answered
// for another session (or after the screen is gone) never opens the live subscription.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

// A cold Jest cache on a loaded machine has pushed the first render past Jest's 5 s default.
jest.setTimeout(30000);

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
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
const { fakeSocket } = require('socket.io-client').default;
const { getToken } = require('../../../mobile/src/services/session');
const { default: api } = require('../../../mobile/src/services/api');
const { MESSAGES } = require('../../../mobile/src/services/authErrors');
const { default: Main } = require('../../../mobile/src/pages/Main');

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
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
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
    Location.requestForegroundPermissionsAsync.mockResolvedValue({ granted: true });
    Location.getCurrentPositionAsync.mockResolvedValue(POSITION);
  });
  afterEach(async () => {
    const test = currentTest;
    test.ended = true;
    for (const renderer of test.renderers) await unmountOnce(test, renderer);
    warn.mockRestore();
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

    it('asks for the permission when it is denied', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: false });
      const view = await mount();
      expect(view.root().findAllByProps({ children: MESSAGES.locationDenied }).length).toBeGreaterThan(0);
      expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
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
