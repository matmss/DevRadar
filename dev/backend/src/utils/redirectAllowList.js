// Post-login redirect targets (dev/docs/03-auth-spec.md, "redirect targets are allow-listed").
// A target is allowed if it is an absolute URL on one of the CORS_ORIGINS (any path), or uses
// the mobile app's custom scheme (MOBILE_APP_SCHEME). Anything else would be an open redirect
// that hands the one-time sign-in code to a third party.
const { allowedOrigins } = require('../config/cors');
const { mobileAppScheme } = require('../config/auth');

const MAX_REDIRECT_LENGTH = 2048;

/**
 * @param {string} raw
 * @returns {URL | null} null if `raw` is not a valid absolute URL
 */
function parseUrl(raw) {
  return URL.canParse(raw) ? new URL(raw) : null;
}

/**
 * @param {unknown} redirect - the client-supplied `redirect` parameter
 * @returns {boolean}
 */
function isRedirectAllowed(redirect) {
  if (typeof redirect !== 'string' || redirect === '' || redirect.length > MAX_REDIRECT_LENGTH) {
    return false;
  }
  const url = parseUrl(redirect);
  if (!url || url.username || url.password) return false;

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return allowedOrigins().includes(url.origin);
  }

  const scheme = mobileAppScheme();
  return scheme !== null && url.protocol === `${scheme}:`;
}

/**
 * Appends query parameters to an allow-listed redirect target, keeping its existing query.
 * @param {string} redirect - a target that passed isRedirectAllowed
 * @param {Record<string, string>} params
 * @returns {string}
 */
function buildRedirectUrl(redirect, params) {
  const url = new URL(redirect);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

module.exports = { isRedirectAllowed, buildRedirectUrl, MAX_REDIRECT_LENGTH };
