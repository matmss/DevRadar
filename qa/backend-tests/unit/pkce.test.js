const {
  PKCE_METHOD,
  isValidCodeChallenge,
  isValidCodeVerifier,
  s256Challenge,
  verifyCodeVerifier,
} = require('../../../dev/backend/src/utils/pkce');

// RFC 7636 Appendix B test vector.
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('PKCE (RFC 7636)', () => {
  it('only supports S256', () => {
    expect(PKCE_METHOD).toBe('S256');
  });

  it('computes the RFC 7636 Appendix B challenge', () => {
    expect(s256Challenge(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
  });

  it('verifies the matching verifier', () => {
    expect(verifyCodeVerifier(RFC_VERIFIER, RFC_CHALLENGE)).toBe(true);
  });

  it.each([
    ['a different verifier', 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXl'],
    ['the challenge itself (plain method)', RFC_CHALLENGE],
    ['a too-short verifier', 'short'],
    ['a verifier with forbidden characters', `${RFC_VERIFIER}!`],
    ['undefined', undefined],
    ['a number', 42],
  ])('rejects %s', (label, verifier) => {
    expect(verifyCodeVerifier(verifier, RFC_CHALLENGE)).toBe(false);
  });

  it('rejects when the stored challenge is malformed', () => {
    expect(verifyCodeVerifier(RFC_VERIFIER, 'not a challenge')).toBe(false);
  });

  it('accepts challenges of 43-128 base64url characters only', () => {
    expect(isValidCodeChallenge(RFC_CHALLENGE)).toBe(true);
    expect(isValidCodeChallenge('a'.repeat(128))).toBe(true);
    expect(isValidCodeChallenge('a'.repeat(42))).toBe(false);
    expect(isValidCodeChallenge('a'.repeat(129))).toBe(false);
    expect(isValidCodeChallenge(`${RFC_CHALLENGE.slice(0, 42)}+`)).toBe(false);
    expect(isValidCodeChallenge(`${RFC_CHALLENGE}=`)).toBe(false);
    expect(isValidCodeChallenge(undefined)).toBe(false);
    expect(isValidCodeChallenge([RFC_CHALLENGE])).toBe(false);
  });

  it('accepts verifiers of 43-128 unreserved characters only', () => {
    expect(isValidCodeVerifier(RFC_VERIFIER)).toBe(true);
    expect(isValidCodeVerifier('a.b_c~d-'.repeat(6))).toBe(true);
    expect(isValidCodeVerifier('a'.repeat(42))).toBe(false);
    expect(isValidCodeVerifier('a'.repeat(129))).toBe(false);
    expect(isValidCodeVerifier(`${'a'.repeat(43)} `)).toBe(false);
  });
});
