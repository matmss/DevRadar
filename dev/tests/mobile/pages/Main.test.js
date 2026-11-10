// src/pages/Main.js: location failures show a message instead of crashing, and a search answered
// for another session (or after the screen is gone) never opens the live subscription.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

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

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render() {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<Main navigation={{ navigate: jest.fn() }} />);
  });
  await flush();
  return renderer;
}

const byTestId = (renderer, testID) => renderer.root.findAll((node) => node.props.testID === testID && typeof node.type === 'string');

/** Presses the touchable with this testID (the composite element carries onPress). */
async function press(renderer, testID) {
  const [touchable] = renderer.root.findAll((node) => node.props.testID === testID && typeof node.props.onPress === 'function');
  await act(async () => { touchable.props.onPress(); });
}

describe('Main', () => {
  let renderer;
  let warn;
  beforeEach(() => {
    jest.clearAllMocks();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    getToken.mockReturnValue('token-1');
    Location.requestForegroundPermissionsAsync.mockResolvedValue({ granted: true });
    Location.getCurrentPositionAsync.mockResolvedValue(POSITION);
  });
  afterEach(async () => {
    if (renderer) await act(async () => renderer.unmount());
    renderer = null;
    warn.mockRestore();
  });

  describe('location', () => {
    it('shows a message and a retry when the location cannot be read (e.g. services off)', async () => {
      Location.getCurrentPositionAsync.mockRejectedValueOnce(new Error('Location services are disabled'));
      renderer = await render();
      expect(byTestId(renderer, 'location-error')).toHaveLength(1);
      expect(renderer.root.findAllByProps({ children: MESSAGES.locationUnavailable }).length).toBeGreaterThan(0);
      expect(byTestId(renderer, 'map-view')).toHaveLength(0);

      await press(renderer, 'location-retry-button');
      await flush();
      expect(byTestId(renderer, 'location-error')).toHaveLength(0);
      expect(byTestId(renderer, 'map-view')).toHaveLength(1);
    });

    it('shows a message when the permission request itself fails', async () => {
      Location.requestForegroundPermissionsAsync.mockRejectedValueOnce(new Error('no activity'));
      renderer = await render();
      expect(renderer.root.findAllByProps({ children: MESSAGES.locationUnavailable }).length).toBeGreaterThan(0);
    });

    it('asks for the permission when it is denied', async () => {
      Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: false });
      renderer = await render();
      expect(renderer.root.findAllByProps({ children: MESSAGES.locationDenied }).length).toBeGreaterThan(0);
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

    async function search() {
      await press(renderer, 'search-button');
    }

    it('subscribes with the token the search was sent with', async () => {
      renderer = await render();
      await search();
      await act(async () => { answerSearch(); });
      await flush();
      expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
      expect(fakeSocket.auth).toEqual({ token: 'token-1' });
    });

    it('does not subscribe if another session is in use when the search answers', async () => {
      renderer = await render();
      await search();
      getToken.mockReturnValue('token-2'); // signed out and in again meanwhile
      await act(async () => { answerSearch(); });
      await flush();
      expect(fakeSocket.connect).not.toHaveBeenCalled();
    });

    it('does not subscribe once the screen is gone', async () => {
      renderer = await render();
      await search();
      await act(async () => renderer.unmount());
      renderer = null;
      await act(async () => { answerSearch(); });
      await flush();
      expect(fakeSocket.connect).not.toHaveBeenCalled();
    });

    it('does not search at all without a session', async () => {
      renderer = await render();
      getToken.mockReturnValue(null);
      const adapter = jest.fn(api.defaults.adapter);
      api.defaults.adapter = adapter;
      await search();
      await act(async () => { answerSearch(); });
      await flush();
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

    /** The handlers Main registered for `event` (the fake socket records every `on`). */
    const handlersFor = (event) => fakeSocket.on.mock.calls.filter(([name]) => name === event).map(([, fn]) => fn);

    /** Delivers a push the way socket.io-client would, to every registered handler. */
    async function push(event, payload) {
      await act(async () => { handlersFor(event).forEach(fn => fn(payload)); });
    }

    /** The markers on the map, in order: id and coordinate. */
    function markers() {
      return renderer.root
        .findAll(node => typeof node.type !== 'string' && typeof node.props.testID === 'string' && node.props.testID.startsWith('marker-'))
        .map(node => ({ id: node.props.testID.slice('marker-'.length), coordinate: node.props.coordinate }));
    }

    async function searchAndShow() {
      renderer = await render();
      await press(renderer, 'search-button');
      await flush();
      expect(markers().map(marker => marker.id)).toEqual(['a1', 'g1']);
    }

    const calloutText = (testID) => renderer.root.findAll(node => node.props.testID === testID && typeof node.type === 'string').map(node => node.props.children);

    it('moves and updates the marker of a dev who updated their profile, in place, without a new search', async () => {
      await searchAndShow();
      const searches = jest.fn(api.defaults.adapter);
      api.defaults.adapter = searches;

      await push('dev-updated', { ...SEARCHED[1], techs: ['Elixir'], location: { type: 'Point', coordinates: [-46.65, -23.57] } });

      expect(markers()).toEqual([
        { id: 'a1', coordinate: { latitude: -23.55, longitude: -46.63 } },
        { id: 'g1', coordinate: { latitude: -23.57, longitude: -46.65 } },
      ]);
      expect(calloutText('callout-techs')).toEqual(['ReactJS', 'Elixir']);
      expect(searches).not.toHaveBeenCalled();
    });

    it('matches the dev by github_username in any letter case', async () => {
      await searchAndShow();
      await push('dev-updated', { ...SEARCHED[1], _id: 'g2', github_username: 'Gaearon', techs: ['Go'] });
      expect(markers().map(marker => marker.id)).toEqual(['a1', 'g2']);
      expect(calloutText('callout-techs')).toEqual(['ReactJS', 'Go']);
    });

    it('adds a dev who now matches but was not on the map', async () => {
      await searchAndShow();
      await push('dev-updated', { _id: 'c1', github_username: 'carol', name: 'Carol', bio: '', techs: ['ReactJS'], location: { type: 'Point', coordinates: [-46.6, -23.5] } });
      expect(markers().map(marker => marker.id)).toEqual(['a1', 'g1', 'c1']);
    });

    // Auth slice 6 (QA-AUTH6-1): a dev whose login GitHub gave to another account is displaced:
    // the backend pushes dev-updated with a placeholder login and github_username_stale.
    it('opens the GitHub profile of a dev with a current login from its callout', async () => {
      await searchAndShow();
      await press(renderer, 'callout-g1');
      expect(renderer.root.props.navigation.navigate).toHaveBeenCalledWith('Profile', { github_username: 'gaearon' });
      expect(calloutText('callout-no-profile')).toEqual([]);
    });

    it('keeps a displaced dev on the map, says its GitHub profile is unavailable, and never opens it', async () => {
      await searchAndShow();
      await push('dev-updated', {
        ...SEARCHED[1], github_id: 810438, github_username: '_stale_g1', github_username_stale: true,
      });
      expect(markers().map(marker => marker.id)).toEqual(['a1', 'g1']);
      expect(calloutText('callout-no-profile')).toEqual(['Perfil do GitHub indisponível']);
      await press(renderer, 'callout-g1');
      expect(renderer.root.props.navigation.navigate).not.toHaveBeenCalled();
    });

    it('never opens a login that is not a GitHub login, even without the stale flag', async () => {
      await searchAndShow();
      await push('dev-updated', { ...SEARCHED[1], github_username: '../orgs/x' });
      await press(renderer, 'callout-g1');
      expect(renderer.root.props.navigation.navigate).not.toHaveBeenCalled();
    });

    it('ignores a malformed dev-updated push instead of crashing', async () => {
      await searchAndShow();
      await push('dev-updated', { _id: 'g1', github_username: 'gaearon' });
      expect(markers().map(marker => marker.id)).toEqual(['a1', 'g1']);
    });

    it('removes the marker of a dev who deleted their profile', async () => {
      await searchAndShow();
      await push('dev-deleted', { _id: 'g1', github_username: 'gaearon' });
      expect(markers().map(marker => marker.id)).toEqual(['a1']);
    });

    it('a new-dev push for a dev already on the map replaces it instead of duplicating it', async () => {
      await searchAndShow();
      await push('new-dev', { ...SEARCHED[0], techs: ['Go'] });
      expect(markers().map(marker => marker.id)).toEqual(['a1', 'g1']);
    });

    it('registers one listener per event for the screen, however often the list changes, and removes them on unmount', async () => {
      await searchAndShow();
      await push('dev-updated', { ...SEARCHED[1], techs: ['Go'] });
      await push('new-dev', { ...SEARCHED[0], _id: 'n1', github_username: 'newbie' });
      await press(renderer, 'search-button');
      await flush();

      ['new-dev', 'dev-updated', 'dev-deleted'].forEach((event) => {
        expect(handlersFor(event)).toHaveLength(1);
      });

      const registered = ['new-dev', 'dev-updated', 'dev-deleted'].map(event => [event, handlersFor(event)[0]]);
      await act(async () => renderer.unmount());
      renderer = null;
      registered.forEach(([event, handler]) => {
        expect(fakeSocket.off).toHaveBeenCalledWith(event, handler);
      });
    });
  });
});
