// src/services/api.js: every request carries the session token; any 401 reports which one.
jest.mock('../../../mobile/src/services/session', () => ({ getToken: jest.fn(() => null) }));

const { getToken } = require('../../../mobile/src/services/session');
const { default: api, setUnauthorizedHandler } = require('../../../mobile/src/services/api');
const { REQUEST_TIMEOUT_MS } = require('../../../mobile/src/config');

/**
 * Answers every request with `status` + `data` without a network, recording what was sent.
 * axios applies the request interceptors before calling the adapter.
 */
function answerWith(status, data) {
  const sent = [];
  api.defaults.adapter = async (config) => {
    sent.push(config);
    const response = { data, status, statusText: String(status), headers: {}, config, request: {} };
    if (status >= 200 && status < 300) return response;
    const error = new Error(`Request failed with status code ${status}`);
    error.config = config;
    error.response = response;
    error.isAxiosError = true;
    throw error;
  };
  return sent;
}

describe('api', () => {
  let handler;
  beforeEach(() => {
    handler = jest.fn();
    setUnauthorizedHandler(handler);
    getToken.mockReturnValue(null);
  });
  afterEach(() => setUnauthorizedHandler(null));

  it('has a request timeout, so a hung request cannot spin forever', () => {
    expect(api.defaults.timeout).toBe(REQUEST_TIMEOUT_MS);
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('sends the session token as a Bearer header on /search', async () => {
    getToken.mockReturnValue('token-1');
    const sent = answerWith(200, { devs: [] });
    await api.get('/search', { params: { latitude: 1, longitude: 2, techs: 'ReactJS' } });
    expect(sent[0].headers.Authorization).toBe('Bearer token-1');
    expect(sent[0].params).toEqual({ latitude: 1, longitude: 2, techs: 'ReactJS' });
    expect(JSON.stringify(sent[0].params)).not.toContain('token-1');
  });

  it('sends no Authorization header when signed out', async () => {
    const sent = answerWith(200, {});
    await api.post('/auth/token', { code: 'c', code_verifier: 'v' });
    expect(sent[0].headers.Authorization).toBeUndefined();
  });

  it('reports a 401 with its code and the token the request carried', async () => {
    getToken.mockReturnValue('token-1');
    answerWith(401, { error: 'Session expired, sign in again', code: 'token_expired', details: [] });
    await expect(api.get('/search')).rejects.toMatchObject({ response: { status: 401 } });
    expect(handler).toHaveBeenCalledWith('token_expired', 'token-1');
  });

  it('reports a 401 without a code as an auth failure too', async () => {
    getToken.mockReturnValue('token-1');
    answerWith(401, 'Unauthorized');
    await expect(api.get('/auth/me')).rejects.toBeDefined();
    expect(handler).toHaveBeenCalledWith(null, 'token-1');
  });

  it('reports the token that was sent, even if another one is in use by the time the 401 arrives', async () => {
    getToken.mockReturnValue('old-token');
    api.defaults.adapter = async (config) => {
      getToken.mockReturnValue('new-token'); // signed out and in again while in flight
      const error = new Error('401');
      error.config = config;
      error.response = { status: 401, data: { code: 'token_invalid' }, config };
      throw error;
    };
    await expect(api.get('/search')).rejects.toBeDefined();
    expect(handler).toHaveBeenCalledWith('token_invalid', 'old-token');
  });

  it.each([400, 429, 500])('does not report a %i as an auth failure', async (status) => {
    getToken.mockReturnValue('token-1');
    answerWith(status, { code: 'token_invalid' });
    await expect(api.get('/search')).rejects.toBeDefined();
    expect(handler).not.toHaveBeenCalled();
  });
});
