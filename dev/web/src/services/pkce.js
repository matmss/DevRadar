// PKCE (RFC 7636, S256) for GitHub sign-in: the browser keeps a random code_verifier and sends
// only code_challenge = BASE64URL(SHA256(code_verifier)) when sign-in starts. The backend only
// hands out a session token for the one-time code together with the matching verifier.
// Web Crypto (crypto.subtle) needs a secure context: https, or http://localhost in development.

const VERIFIER_BYTES = 32; // 43 base64url characters, the RFC 7636 minimum length

/**
 * @param {Uint8Array} bytes
 * @returns {string} base64url without padding
 */
export function base64UrlEncode(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {Crypto} [cryptoImpl] - defaults to the browser's Web Crypto
 * @returns {string} a fresh random code_verifier
 */
export function createCodeVerifier(cryptoImpl = window.crypto) {
  return base64UrlEncode(cryptoImpl.getRandomValues(new Uint8Array(VERIFIER_BYTES)));
}

/**
 * @param {string} verifier
 * @param {Crypto} [cryptoImpl] - defaults to the browser's Web Crypto
 * @returns {Promise<string>} BASE64URL(SHA256(ascii(verifier)))
 */
export async function createCodeChallenge(verifier, cryptoImpl = window.crypto) {
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** @returns {boolean} true if this browser context can run PKCE */
export function isPkceSupported() {
  return Boolean(window.crypto && window.crypto.getRandomValues && window.crypto.subtle);
}
