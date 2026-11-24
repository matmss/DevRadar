// The backend URL comes from VITE_API_URL only (inlined at build time). REACT_APP_API_URL, the
// Create React App name used before the move to Vite, is no longer read, so a leftover .env with
// only that variable falls back to localhost instead of reaching some other backend.
describe('API_URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** Loads a fresh copy of ./api, so it reads the environment stubbed by the test. */
  async function loadApi() {
    vi.resetModules();
    return import('./api');
  }

  it('ignores REACT_APP_API_URL and falls back to localhost:3333', async () => {
    vi.stubEnv('VITE_API_URL', undefined);
    vi.stubEnv('REACT_APP_API_URL', 'http://react-app-api.example:9999');
    const { API_URL, default: api } = await loadApi();
    expect(API_URL).toBe('http://localhost:3333');
    expect(api.defaults.baseURL).toBe('http://localhost:3333');
  });

  it('uses VITE_API_URL when it is set', async () => {
    vi.stubEnv('VITE_API_URL', 'http://127.0.0.1:3334');
    vi.stubEnv('REACT_APP_API_URL', 'http://react-app-api.example:9999');
    const { API_URL, default: api } = await loadApi();
    expect(API_URL).toBe('http://127.0.0.1:3334');
    expect(api.defaults.baseURL).toBe('http://127.0.0.1:3334');
  });
});
