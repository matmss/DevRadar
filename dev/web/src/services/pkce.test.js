import { webcrypto } from 'crypto';
import { TextEncoder } from 'util';

import { base64UrlEncode, createCodeVerifier, createCodeChallenge } from './pkce';

// jsdom has no Web Crypto digest or TextEncoder; Node's are the same APIs browsers have.
beforeAll(() => {
  if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
});

describe('pkce', () => {
  it('computes the RFC 7636 Appendix B S256 challenge', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    await expect(createCodeChallenge(verifier, webcrypto)).resolves.toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('makes 43-character base64url verifiers that differ every time', () => {
    const first = createCodeVerifier(webcrypto);
    const second = createCodeVerifier(webcrypto);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it('base64url-encodes without padding or +/ characters', () => {
    expect(base64UrlEncode(new Uint8Array([251, 255, 191]))).toBe('-_-_');
    expect(base64UrlEncode(new Uint8Array([1]))).toBe('AQ');
  });
});
