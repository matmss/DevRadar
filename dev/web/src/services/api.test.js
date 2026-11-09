import api, { REQUEST_TIMEOUT_MS, setUnauthorizedHandler } from './api';
import { saveToken } from './session';

/** Answers every request without a network; axios runs the interceptors around the adapter. */
function answerWith(status, data) {
  const sent = [];
  api.defaults.adapter = async (config) => {
    sent.push(config);
    const response = { data, status, statusText: String(status), headers: {}, config, request: {} };
    if (status >= 200 && status < 300) return response;
    const error = new Error(`Request failed with status code ${status}`);
    error.config = config;
    error.response = response;
    throw error;
  };
  return sent;
}

describe('api', () => {
  let handler;
  beforeEach(() => {
    window.localStorage.clear();
    handler = jest.fn();
    setUnauthorizedHandler(handler);
  });
  afterEach(() => setUnauthorizedHandler(null));

  it('gives up on a request after a timeout, so a hung GET /auth/me cannot load forever', () => {
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30000);
    expect(api.defaults.timeout).toBe(REQUEST_TIMEOUT_MS);
  });

  it('sends the session token on GET /devs', async () => {
    saveToken('token-1');
    const sent = answerWith(200, []);
    await api.get('/devs');
    expect(sent[0].headers.Authorization).toBe('Bearer token-1');
  });

  it('reports a 401 on GET /devs with its code and the token it carried', async () => {
    saveToken('token-1');
    answerWith(401, { error: 'Session expired, sign in again', code: 'token_expired', details: [] });
    await expect(api.get('/devs')).rejects.toBeDefined();
    expect(handler).toHaveBeenCalledWith('token_expired', 'token-1');
  });

  it('does not report other errors as a 401', async () => {
    saveToken('token-1');
    answerWith(500, { code: 'internal_error' });
    await expect(api.get('/devs')).rejects.toBeDefined();
    expect(handler).not.toHaveBeenCalled();
  });
});
