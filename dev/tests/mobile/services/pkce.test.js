// src/services/pkce.js: PKCE (RFC 7636, S256) for mobile sign-in.
const nodeCrypto = require('crypto');

// expo-crypto is native; back it with Node's crypto so the default path is exercised too.
jest.mock('expo-crypto', () => {
  const crypto = require('crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { BASE64: 'base64', HEX: 'hex' },
    getRandomBytes: jest.fn((count) => new Uint8Array(crypto.randomBytes(count))),
    digestStringAsync: jest.fn(async (algorithm, data, options) => {
      if (algorithm !== 'SHA-256') throw new Error(`unexpected algorithm ${algorithm}`);
      return crypto.createHash('sha256').update(data, 'utf8').digest(options.encoding);
    }),
  };
});

const Crypto = require('expo-crypto');
const {
  base64UrlEncode,
  base64ToBase64Url,
  createCodeVerifier,
  createCodeChallenge,
} = require('../../../mobile/src/services/pkce');

// RFC 7636 Appendix B.
const RFC_VERIFIER_BYTES = [
  116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186,
  22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
];
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('base64UrlEncode', () => {
  it('encodes the RFC 7636 example verifier', () => {
    expect(base64UrlEncode(new Uint8Array(RFC_VERIFIER_BYTES))).toBe(RFC_VERIFIER);
  });

  it('matches Node base64url for every length up to 40 bytes', () => {
    for (let length = 0; length <= 40; length += 1) {
      const bytes = nodeCrypto.randomBytes(length);
      expect(base64UrlEncode(new Uint8Array(bytes))).toBe(bytes.toString('base64url'));
    }
  });

  it('handles all-zero and all-0xff bytes', () => {
    expect(base64UrlEncode(new Uint8Array(4))).toBe(Buffer.alloc(4).toString('base64url'));
    expect(base64UrlEncode(new Uint8Array(5).fill(255))).toBe(Buffer.alloc(5, 255).toString('base64url'));
  });
});

describe('base64ToBase64Url', () => {
  it('swaps the URL-unsafe characters and drops the padding', () => {
    expect(base64ToBase64Url('a+b/c==')).toBe('a-b_c');
  });
});

describe('createCodeVerifier', () => {
  it('uses 32 bytes from the secure generator: 43 base64url characters', () => {
    const getRandomBytes = jest.fn(() => new Uint8Array(RFC_VERIFIER_BYTES));
    expect(createCodeVerifier({ getRandomBytes })).toBe(RFC_VERIFIER);
    expect(getRandomBytes).toHaveBeenCalledWith(32);
  });

  it('defaults to expo-crypto and gives a fresh verifier each time', () => {
    const first = createCodeVerifier();
    const second = createCodeVerifier();
    expect(Crypto.getRandomBytes).toHaveBeenCalledWith(32);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it('refuses to make a verifier if the generator returns too few bytes', () => {
    expect(() => createCodeVerifier({ getRandomBytes: () => new Uint8Array(8) })).toThrow('Secure random generator unavailable');
    expect(() => createCodeVerifier({ getRandomBytes: () => undefined })).toThrow('Secure random generator unavailable');
  });
});

describe('createCodeChallenge', () => {
  it('is BASE64URL(SHA256(verifier)) (RFC 7636 Appendix B)', async () => {
    await expect(createCodeChallenge(RFC_VERIFIER)).resolves.toBe(RFC_CHALLENGE);
    expect(Crypto.digestStringAsync).toHaveBeenCalledWith('SHA-256', RFC_VERIFIER, { encoding: 'base64' });
  });

  it('matches what the backend checks for a random verifier', async () => {
    const verifier = createCodeVerifier();
    const expected = nodeCrypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
    await expect(createCodeChallenge(verifier)).resolves.toBe(expected);
  });
});
