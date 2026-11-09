const VARS = ['NODE_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_CALLBACK_URL', 'JWT_SECRET'];
const LONG_SECRET = 'x'.repeat(32);

describe('auth config', () => {
  const original = Object.fromEntries(VARS.map((name) => [name, process.env[name]]));
  let config;

  beforeEach(() => {
    VARS.forEach((name) => delete process.env[name]);
    jest.resetModules(); // fresh per-process fallback secret
    config = require('../../../dev/backend/src/config/auth');
  });
  afterAll(() => {
    VARS.forEach((name) => {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    });
  });

  describe('in production', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('refuses to start without the GitHub credentials and JWT_SECRET', () => {
      expect(config.authConfigErrors()).toEqual([
        'GITHUB_CLIENT_ID is required in production',
        'GITHUB_CLIENT_SECRET is required in production',
        'JWT_SECRET is required in production',
      ]);
      expect(() => config.assertAuthConfig()).toThrow(/GITHUB_CLIENT_ID is required/);
    });

    it('treats whitespace-only values as missing', () => {
      process.env.GITHUB_CLIENT_ID = '  ';
      process.env.GITHUB_CLIENT_SECRET = 'secret';
      process.env.JWT_SECRET = LONG_SECRET;
      expect(config.authConfigErrors()).toEqual(['GITHUB_CLIENT_ID is required in production']);
    });

    it('rejects a short JWT_SECRET', () => {
      process.env.GITHUB_CLIENT_ID = 'id';
      process.env.GITHUB_CLIENT_SECRET = 'secret';
      process.env.JWT_SECRET = 'short';
      expect(config.authConfigErrors()).toEqual(['JWT_SECRET must be at least 32 characters in production']);
    });

    it('names variables but never their values in the error, and starts once complete', () => {
      process.env.GITHUB_CLIENT_ID = 'id';
      process.env.GITHUB_CLIENT_SECRET = 'super-secret-value';
      process.env.JWT_SECRET = 'short-secret-value';
      expect(() => config.assertAuthConfig()).toThrow();
      try {
        config.assertAuthConfig();
      } catch (err) {
        expect(err.message).not.toContain('super-secret-value');
        expect(err.message).not.toContain('short-secret-value');
      }
      process.env.JWT_SECRET = LONG_SECRET;
      expect(() => config.assertAuthConfig()).not.toThrow();
    });

    it('never falls back to a random signing secret', () => {
      expect(() => config.jwtSecret()).toThrow(/JWT_SECRET must be set/);
    });
  });

  describe('MOBILE_APP_SCHEME warnings', () => {
    afterEach(() => {
      delete process.env.MOBILE_APP_SCHEME;
    });

    it('warns at startup, without the value, when the scheme is refused', () => {
      process.env.MOBILE_APP_SCHEME = 'intent';
      expect(config.authConfigWarnings()).toEqual([
        'MOBILE_APP_SCHEME is not an allowed app scheme; mobile sign-in redirects are disabled',
      ]);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        config.assertAuthConfig();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).not.toContain('intent');
      } finally {
        warn.mockRestore();
      }
    });

    it('warns when the scheme has an invalid shape', () => {
      process.env.MOBILE_APP_SCHEME = 'my_app';
      expect(config.authConfigWarnings()).toHaveLength(1);
    });

    it('does not warn for the default, a valid scheme, or an explicitly empty one', () => {
      expect(config.authConfigWarnings()).toEqual([]);
      process.env.MOBILE_APP_SCHEME = 'com.devradar.app';
      expect(config.authConfigWarnings()).toEqual([]);
      process.env.MOBILE_APP_SCHEME = '';
      expect(config.authConfigWarnings()).toEqual([]);
    });

    it('does not stop the server in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.GITHUB_CLIENT_ID = 'id';
      process.env.GITHUB_CLIENT_SECRET = 'secret';
      process.env.JWT_SECRET = LONG_SECRET;
      process.env.MOBILE_APP_SCHEME = 'https';
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(() => config.assertAuthConfig()).not.toThrow();
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('outside production', () => {
    it('does not block startup when nothing is configured', () => {
      expect(config.authConfigErrors()).toEqual([]);
      expect(config.isGithubOAuthConfigured()).toBe(false);
    });

    it('uses a stable random per-process secret when JWT_SECRET is unset', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const first = config.jwtSecret();
        expect(first).toMatch(/^[0-9a-f]{64}$/);
        expect(config.jwtSecret()).toBe(first);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).not.toContain(first);
      } finally {
        warn.mockRestore();
      }
    });

    it('prefers JWT_SECRET when set', () => {
      process.env.JWT_SECRET = 'configured';
      expect(config.jwtSecret()).toBe('configured');
    });
  });

  it('defaults the callback URL to the local backend', () => {
    expect(config.githubCallbackUrl()).toBe('http://localhost:3333/auth/github/callback');
    process.env.GITHUB_CALLBACK_URL = 'https://api.devradar.app/auth/github/callback';
    expect(config.githubCallbackUrl()).toBe('https://api.devradar.app/auth/github/callback');
  });
});
