const { allowedOrigins, isOriginAllowed } = require('../../../dev/backend/src/config/cors');

describe('CORS config', () => {
  const original = process.env.CORS_ORIGINS;
  afterEach(() => {
    if (original === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = original;
  });

  it('defaults to the local web and Expo web dev servers', () => {
    delete process.env.CORS_ORIGINS;
    expect(allowedOrigins()).toEqual(['http://localhost:3000', 'http://localhost:8081']);
  });

  it('reads a trimmed, comma-separated CORS_ORIGINS', () => {
    process.env.CORS_ORIGINS = ' https://devradar.app , https://www.devradar.app ,';
    expect(allowedOrigins()).toEqual(['https://devradar.app', 'https://www.devradar.app']);
    expect(isOriginAllowed('https://devradar.app')).toBe(true);
    expect(isOriginAllowed('http://localhost:3000')).toBe(false);
  });

  it('allows requests with no Origin header (native clients)', () => {
    expect(isOriginAllowed(undefined)).toBe(true);
  });

  it('matches origins exactly (no prefix or suffix tricks)', () => {
    delete process.env.CORS_ORIGINS;
    expect(isOriginAllowed('http://localhost:3000.evil.example')).toBe(false);
    expect(isOriginAllowed('http://localhost:30001')).toBe(false);
    expect(isOriginAllowed('https://localhost:3000')).toBe(false);
  });
});
