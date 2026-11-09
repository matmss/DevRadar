// QA review of auth slice 1 (QA-AUTH-3). config/auth.js#mobileAppScheme() drops schemes that
// would make the mobile allow-list entry an open redirect, but it uses a short denylist.
// Android Chrome's `intent:` scheme is a redirect sink that the list misses:
// intent://evil.example/?code=X#Intent;scheme=https;end opens https://evil.example/?code=X, so
// the one-time sign-in code would reach an arbitrary host.
const { mobileAppScheme } = require('../../../dev/backend/src/config/auth');
const { isRedirectAllowed } = require('../../../dev/backend/src/utils/redirectAllowList');

describe('MOBILE_APP_SCHEME safety (QA review)', () => {
  const original = process.env.MOBILE_APP_SCHEME;
  afterAll(() => {
    if (original === undefined) delete process.env.MOBILE_APP_SCHEME;
    else process.env.MOBILE_APP_SCHEME = original;
  });

  it('refuses "intent" as the app scheme, since Android resolves it to arbitrary https URLs', () => {
    process.env.MOBILE_APP_SCHEME = 'intent';
    expect(mobileAppScheme()).toBeNull();
    expect(isRedirectAllowed('intent://evil.example/#Intent;scheme=https;end')).toBe(false);
  });

  it('still accepts an ordinary custom scheme', () => {
    process.env.MOBILE_APP_SCHEME = 'devradar';
    expect(mobileAppScheme()).toBe('devradar');
    expect(isRedirectAllowed('devradar://auth')).toBe(true);
  });
});
