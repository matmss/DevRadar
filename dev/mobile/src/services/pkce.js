// PKCE (RFC 7636, S256) for GitHub sign-in: the app keeps a random code_verifier in memory for
// the duration of one sign-in and sends only code_challenge = BASE64URL(SHA256(code_verifier)).
// The backend hands out a session token for the one-time code only together with the matching
// verifier, so another app that intercepts the com.matmss.mobile:// redirect cannot use it.
import * as Crypto from 'expo-crypto';

const VERIFIER_BYTES = 32; // 43 base64url characters, the RFC 7636 minimum length
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Encodes bytes as base64url without padding (no dependency on btoa, which not every
 * JavaScript engine React Native runs on provides).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function base64UrlEncode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    const remaining = bytes.length - i;
    out += BASE64URL_ALPHABET[(chunk >> 18) & 63];
    out += BASE64URL_ALPHABET[(chunk >> 12) & 63];
    if (remaining > 1) out += BASE64URL_ALPHABET[(chunk >> 6) & 63];
    if (remaining > 2) out += BASE64URL_ALPHABET[chunk & 63];
  }
  return out;
}

/**
 * @param {string} base64 - standard base64, possibly padded
 * @returns {string} the same value in base64url without padding
 */
export function base64ToBase64Url(base64) {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {{ getRandomBytes: (count: number) => Uint8Array }} [cryptoImpl] - defaults to expo-crypto
 *   (the platform's cryptographically secure generator)
 * @returns {string} a fresh random code_verifier
 */
export function createCodeVerifier(cryptoImpl = Crypto) {
  const bytes = cryptoImpl.getRandomBytes(VERIFIER_BYTES);
  if (!bytes || bytes.length !== VERIFIER_BYTES) {
    throw new Error('Secure random generator unavailable');
  }
  return base64UrlEncode(bytes);
}

/**
 * @param {string} verifier
 * @param {{ digestStringAsync: Function }} [cryptoImpl] - defaults to expo-crypto
 * @returns {Promise<string>} BASE64URL(SHA256(ascii(verifier)))
 */
export async function createCodeChallenge(verifier, cryptoImpl = Crypto) {
  const digest = await cryptoImpl.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return base64ToBase64Url(digest);
}
