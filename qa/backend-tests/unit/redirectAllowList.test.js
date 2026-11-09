const { isRedirectAllowed, buildRedirectUrl } = require('../../../dev/backend/src/utils/redirectAllowList');
const { mobileAppScheme } = require('../../../dev/backend/src/config/auth');

describe('post-login redirect allow-list', () => {
  const original = { cors: process.env.CORS_ORIGINS, scheme: process.env.MOBILE_APP_SCHEME };
  beforeEach(() => {
    delete process.env.CORS_ORIGINS; // defaults: http://localhost:3000, http://localhost:8081
    delete process.env.MOBILE_APP_SCHEME; // default: devradar
  });
  afterAll(() => {
    if (original.cors === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = original.cors;
    if (original.scheme === undefined) delete process.env.MOBILE_APP_SCHEME;
    else process.env.MOBILE_APP_SCHEME = original.scheme;
  });

  it.each([
    'http://localhost:3000',
    'http://localhost:3000/',
    'http://localhost:3000/some/path?x=1#frag',
    'http://localhost:8081/',
    'devradar://auth',
    'devradar:///callback?x=1',
  ])('allows %p', (redirect) => {
    expect(isRedirectAllowed(redirect)).toBe(true);
  });

  it.each([
    undefined,
    null,
    '',
    42,
    ['http://localhost:3000/'],
    'https://evil.example/',
    'https://localhost:3000/', // scheme must match too
    'http://localhost:30001/',
    'http://localhost:3000.evil.example/',
    'http://localhost:3000@evil.example/',
    'http://user:pass@localhost:3000/',
    '//evil.example/',
    '/relative/path',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'devradarx://auth',
    'exp://192.168.0.10:8081',
  ])('rejects %p', (redirect) => {
    expect(isRedirectAllowed(redirect)).toBe(false);
  });

  it('rejects overly long targets', () => {
    expect(isRedirectAllowed(`http://localhost:3000/${'a'.repeat(3000)}`)).toBe(false);
  });

  it('follows CORS_ORIGINS', () => {
    process.env.CORS_ORIGINS = 'https://devradar.app';
    expect(isRedirectAllowed('https://devradar.app/')).toBe(true);
    expect(isRedirectAllowed('http://localhost:3000/')).toBe(false);
  });

  it('follows MOBILE_APP_SCHEME, accepting "scheme://" spelling', () => {
    process.env.MOBILE_APP_SCHEME = 'myapp://';
    expect(isRedirectAllowed('myapp://auth')).toBe(true);
    expect(isRedirectAllowed('devradar://auth')).toBe(false);
  });

  it('allows no custom scheme when MOBILE_APP_SCHEME is empty', () => {
    process.env.MOBILE_APP_SCHEME = '';
    expect(isRedirectAllowed('devradar://auth')).toBe(false);
  });

  const REFUSED = [
    'http', 'https', 'intent', 'exp', 'exps', 'javascript', 'data', 'file', 'ftp',
    'ws', 'wss', 'about', 'blob', 'content', 'vbscript', 'chrome',
  ];

  it.each(REFUSED)('refuses MOBILE_APP_SCHEME %p and allows nothing through it', (scheme) => {
    process.env.MOBILE_APP_SCHEME = scheme;
    expect(mobileAppScheme()).toBeNull();
    expect(isRedirectAllowed(`${scheme}://evil.example/`)).toBe(false);
    expect(isRedirectAllowed('https://evil.example/')).toBe(false);
    expect(isRedirectAllowed('javascript:alert(1)')).toBe(false);
  });

  it.each(['HTTPS', 'Intent://', 'exp:'])('refuses %p regardless of case or "://" spelling', (scheme) => {
    process.env.MOBILE_APP_SCHEME = scheme;
    expect(mobileAppScheme()).toBeNull();
  });

  it.each(['not a scheme', 'my_app', 'a+b', '1app', 'app.', '.app', 'app..x', 'app--x', '-app', 'ü'])(
    'refuses MOBILE_APP_SCHEME %p with an invalid shape',
    (scheme) => {
      process.env.MOBILE_APP_SCHEME = scheme;
      expect(mobileAppScheme()).toBeNull();
    }
  );

  it.each(['devradar', 'com.devradar.app', 'dev-radar', 'app2'])('accepts MOBILE_APP_SCHEME %p', (scheme) => {
    process.env.MOBILE_APP_SCHEME = scheme;
    expect(mobileAppScheme()).toBe(scheme);
    expect(isRedirectAllowed(`${scheme}://auth`)).toBe(true);
  });

  it('appends params while keeping the existing query', () => {
    expect(buildRedirectUrl('http://localhost:3000/welcome?tab=devs', { code: 'abc' }))
      .toBe('http://localhost:3000/welcome?tab=devs&code=abc');
    expect(buildRedirectUrl('devradar://auth', { error: 'sign_in_cancelled' }))
      .toBe('devradar://auth?error=sign_in_cancelled');
  });
});
