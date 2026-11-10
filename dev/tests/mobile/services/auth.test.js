// src/services/auth.js: the PKCE sign-in through the system auth session, then POST /auth/token.
const nodeCrypto = require('crypto');

jest.mock('expo-crypto', () => {
  const crypto = require('crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { BASE64: 'base64' },
    getRandomBytes: (count) => new Uint8Array(crypto.randomBytes(count)),
    digestStringAsync: async (algorithm, data, options) => crypto.createHash('sha256').update(data, 'utf8').digest(options.encoding),
  };
});
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('../../../mobile/src/services/api', () => ({ __esModule: true, default: { post: jest.fn(), get: jest.fn() } }));

const WebBrowser = require('expo-web-browser');
const { default: api } = require('../../../mobile/src/services/api');
const { API_URL, AUTH_REDIRECT_URI } = require('../../../mobile/src/config');
const {
  buildSignInUrl,
  parseCallbackUrl,
  signInWithGithub,
  fetchCurrentUser,
} = require('../../../mobile/src/services/auth');

const USER = { github_username: 'gaearon', name: 'Dan Abramov', avatar_url: 'https://avatars.githubusercontent.com/u/810438?v=4' };

/** Reads the query of the sign-in URL the app opened. */
function queryOf(url) {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

describe('buildSignInUrl', () => {
  it('starts the backend flow with the app redirect and an S256 challenge', () => {
    const url = buildSignInUrl('challenge-abc');
    expect(url.startsWith(`${API_URL}/auth/github?`)).toBe(true);
    expect(queryOf(url)).toEqual({
      redirect: 'com.matmss.mobile://auth/callback',
      code_challenge: 'challenge-abc',
      code_challenge_method: 'S256',
    });
  });
});

describe('parseCallbackUrl', () => {
  it('reads the one-time code', () => {
    expect(parseCallbackUrl(`${AUTH_REDIRECT_URI}?code=abc%2Bdef`)).toEqual({ code: 'abc+def', error: null, reason: null });
  });

  it('reads an error and its reason', () => {
    expect(parseCallbackUrl(`${AUTH_REDIRECT_URI}?error=sign_in_failed&reason=github_unavailable`))
      .toEqual({ code: null, error: 'sign_in_failed', reason: 'github_unavailable' });
  });

  it('ignores a fragment and keeps the first value of a repeated key', () => {
    expect(parseCallbackUrl(`${AUTH_REDIRECT_URI}?code=first&code=second#code=frag`).code).toBe('first');
  });

  it.each([
    ['another scheme', 'devradar://auth/callback?code=abc'],
    ['another path on our scheme', 'com.matmss.mobile://auth/other?code=abc'],
    ['a look-alike path', 'com.matmss.mobile://auth/callbackX?code=abc'],
    ['an https page', 'https://evil.example/auth/callback?code=abc'],
    ['not a string', undefined],
  ])('is null for %s', (_label, url) => {
    expect(parseCallbackUrl(url)).toBeNull();
  });

  it('drops malformed percent-encoding instead of throwing', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseCallbackUrl(`${AUTH_REDIRECT_URI}?code=%E0%A4%A&error=x`)).toEqual({ code: null, error: 'x', reason: null });
    expect(warn).toHaveBeenCalledWith('Ignoring a malformed sign-in callback parameter:', 'URIError');
    warn.mockRestore();
  });

  it('treats prototype keys as plain keys', () => {
    expect(parseCallbackUrl(`${AUTH_REDIRECT_URI}?__proto__=x&code=abc`).code).toBe('abc');
  });
});

describe('signInWithGithub', () => {
  let warn;
  beforeEach(() => {
    jest.clearAllMocks();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('opens the system auth session, then exchanges the code with the matching verifier', async () => {
    WebBrowser.openAuthSessionAsync.mockResolvedValue({ type: 'success', url: `${AUTH_REDIRECT_URI}?code=one-time-code` });
    api.post.mockResolvedValue({ data: { token: 'session-token', token_type: 'Bearer', expires_in: 604800, user: USER } });

    await expect(signInWithGithub()).resolves.toEqual({ ok: true, token: 'session-token', user: USER });

    const [startUrl, redirect] = WebBrowser.openAuthSessionAsync.mock.calls[0];
    expect(redirect).toBe(AUTH_REDIRECT_URI);
    const { code_challenge: challenge, code_challenge_method: method } = queryOf(startUrl);
    expect(method).toBe('S256');

    expect(api.post).toHaveBeenCalledWith('/auth/token', { code: 'one-time-code', code_verifier: expect.any(String) });
    const { code_verifier: verifier } = api.post.mock.calls[0][1];
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(nodeCrypto.createHash('sha256').update(verifier, 'ascii').digest('base64url')).toBe(challenge);
  });

  it('uses a new verifier for every sign-in', async () => {
    WebBrowser.openAuthSessionAsync.mockResolvedValue({ type: 'success', url: `${AUTH_REDIRECT_URI}?code=c` });
    api.post.mockResolvedValue({ data: { token: 't', user: USER } });
    await signInWithGithub();
    await signInWithGithub();
    expect(api.post.mock.calls[0][1].code_verifier).not.toBe(api.post.mock.calls[1][1].code_verifier);
  });

  it.each(['cancel', 'dismiss'])('reports "cancelled" when the user closes the browser (%s)', async (type) => {
    WebBrowser.openAuthSessionAsync.mockResolvedValue({ type });
    await expect(signInWithGithub()).resolves.toEqual({ ok: false, error: 'sign_in_cancelled' });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('reports "cancelled" when the user denies consent on GitHub', async () => {
    WebBrowser.openAuthSessionAsync.mockResolvedValue({ type: 'success', url: `${AUTH_REDIRECT_URI}?error=sign_in_cancelled` });
    await expect(signInWithGithub()).resolves.toEqual({ ok: false, error: 'sign_in_cancelled' });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('reports a GitHub failure with a known reason', async () => {
    WebBrowser.openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: `${AUTH_REDIRECT_URI}?error=sign_in_failed&reason=github_rate_limited`,
    });
    await expect(signInWithGithub()).resolves.toEqual({ ok: false, error: 'sign_in_failed', reason: 'github_rate_limited' });
  });

  it('does not pass on an unknown reason', async () => {
    WebBrowser.openAuthSessionAsync.mockResolvedValue({ type: 'success', url: `${AUTH_REDIRECT_URI}?error=sign_in_failed&reason=%3Cb%3E` });
    await expect(signInWithGithub()).resolves.toEqual({ ok: false, error: 'sign_in_failed', reason: undefined });
  });

  it('fails without exchanging anything for a callback that is not ours', async () => {
    WebBrowser.openAuthSessionAsync.mockResolvedValue({ type: 'success', url: 'https://evil.example/?code=abc' });
    await expect(signInWithGithub()).resolves.toMatchObject({ ok: false, error: 'sign_in_failed' });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('fails when the code exchange is refused', async () => {
    WebBrowser.openAuthSessionAsync.mockResolvedValue({ type: 'success', url: `${AUTH_REDIRECT_URI}?code=used-code` });
    api.post.mockRejectedValue(Object.assign(new Error('400'), { response: { status: 400 } }));
    await expect(signInWithGithub()).resolves.toEqual({ ok: false, error: 'sign_in_failed' });
  });

  it('fails instead of throwing when the auth session cannot open', async () => {
    WebBrowser.openAuthSessionAsync.mockRejectedValue(new Error('no browser'));
    await expect(signInWithGithub()).resolves.toEqual({ ok: false, error: 'sign_in_failed' });
  });
});

describe('fetchCurrentUser', () => {
  it('asks GET /auth/me', async () => {
    api.get.mockResolvedValue({ data: USER });
    await expect(fetchCurrentUser()).resolves.toEqual(USER);
    expect(api.get).toHaveBeenCalledWith('/auth/me');
  });
});
