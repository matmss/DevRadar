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
});
