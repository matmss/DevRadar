import { clearToken, getToken, saveToken, SESSION_TOKEN_KEY } from './session';

describe('session token storage', () => {
  beforeEach(() => window.localStorage.clear());

  it('saves and reads the token', () => {
    saveToken('token-1');
    expect(getToken()).toBe('token-1');
    expect(window.localStorage.getItem(SESSION_TOKEN_KEY)).toBe('token-1');
  });

  it('"Sair" clears whatever is stored', () => {
    saveToken('token-1');
    expect(clearToken()).toBe(true);
    expect(getToken()).toBeNull();
  });

  it('a 401 clears the token only if it is still the one the request carried', () => {
    saveToken('token-1');
    expect(clearToken('token-1')).toBe(true);
    expect(getToken()).toBeNull();
  });

  it('a 401 for an old token keeps the token another tab has saved since', () => {
    saveToken('new-token-from-another-tab');
    expect(clearToken('old-token')).toBe(false);
    expect(getToken()).toBe('new-token-from-another-tab');
  });

  it('a 401 for a request sent without a token keeps a token saved since', () => {
    saveToken('new-token-from-another-tab');
    expect(clearToken(null)).toBe(false);
    expect(getToken()).toBe('new-token-from-another-tab');
  });

  it('reports signed out when nothing is stored any more', () => {
    expect(clearToken('old-token')).toBe(true);
    expect(getToken()).toBeNull();
  });
});
