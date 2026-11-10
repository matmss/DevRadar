// src/pages/Profile.js: the GitHub profile WebView opens only for a real GitHub login (auth slice
// 6: a displaced dev has a placeholder login that must never become a github.com URL).
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

let mockParams;
jest.mock('@react-navigation/native', () => ({ useRoute: () => ({ params: mockParams }) }));
jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  return { WebView: (props) => <View {...props} /> };
});

const { default: Profile } = require('../../../mobile/src/pages/Profile');
const { githubLoginOf, githubProfileUrl } = require('../../../mobile/src/services/githubLogin');

async function render() {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<Profile />);
  });
  return renderer;
}

const byTestId = (renderer, testID) => renderer.root.findAll((node) => node.props.testID === testID && typeof node.type === 'string');

describe('Profile', () => {
  it('opens github.com/<login> for a GitHub login', async () => {
    mockParams = { github_username: 'gaearon' };
    const renderer = await render();
    const [webview] = byTestId(renderer, 'profile-webview');
    expect(webview.props.source).toEqual({ uri: 'https://github.com/gaearon' });
  });

  it.each(['_stale_64b7f0c2a1b2c3d4e5f60718', '../orgs/x', '', undefined])(
    'shows a message instead of a WebView for %p',
    async (login) => {
      mockParams = { github_username: login };
      const renderer = await render();
      expect(byTestId(renderer, 'profile-webview')).toHaveLength(0);
      expect(byTestId(renderer, 'profile-unavailable')).toHaveLength(1);
    }
  );
});

describe('githubLoginOf', () => {
  it.each([
    ['a current login', { github_username: 'gaearon' }, 'gaearon'],
    ['a displaced dev', { github_username: '_stale_abc', github_username_stale: true }, null],
    ['the stale flag with a valid-looking login', { github_username: 'alice', github_username_stale: true }, null],
    ['a placeholder without the flag', { github_username: '_stale_abc' }, null],
    ['no dev', null, null],
  ])('%s', (_label, dev, expected) => {
    expect(githubLoginOf(dev)).toBe(expected);
  });

  it('builds the profile URL only for a GitHub login', () => {
    expect(githubProfileUrl('gaearon')).toBe('https://github.com/gaearon');
    expect(githubProfileUrl('-bad-')).toBeNull();
  });
});
