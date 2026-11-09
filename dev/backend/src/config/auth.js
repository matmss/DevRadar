// GitHub sign-in and session-token configuration (dev/docs/03-auth-spec.md).
// Values are read from the environment on every call, not cached at require time, so the
// test harnesses can set them per run. Never log any of these values.
const crypto = require('crypto');

const DEFAULT_GITHUB_CALLBACK_URL = 'http://localhost:3333/auth/github/callback';
const DEFAULT_MOBILE_APP_SCHEME = 'devradar';
const MIN_PRODUCTION_SECRET_LENGTH = 32;

// Schemes that would turn the mobile allow-list entry into an open redirect or script sink.
const FORBIDDEN_APP_SCHEMES = ['http', 'https', 'javascript', 'data', 'file', 'vbscript', 'blob', 'about'];
const URL_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*$/;

// Outside production a missing JWT_SECRET falls back to a random per-process secret, so local
// development works without setup. Sessions then reset whenever the process restarts.
let fallbackJwtSecret = null;

/** @returns {boolean} */
function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * @param {string} name
 * @returns {string} the trimmed env value, or '' if unset
 */
function readEnv(name) {
  return (process.env[name] || '').trim();
}

/** @returns {string} the GitHub OAuth App client id, or '' if not configured */
function githubClientId() {
  return readEnv('GITHUB_CLIENT_ID');
}

/** @returns {string} the GitHub OAuth App client secret, or '' if not configured */
function githubClientSecret() {
  return readEnv('GITHUB_CLIENT_SECRET');
}

/** @returns {string} the backend URL GitHub redirects back to after consent */
function githubCallbackUrl() {
  return readEnv('GITHUB_CALLBACK_URL') || DEFAULT_GITHUB_CALLBACK_URL;
}

/** @returns {boolean} true if both GitHub OAuth App credentials are set */
function isGithubOAuthConfigured() {
  return githubClientId() !== '' && githubClientSecret() !== '';
}

/** @returns {string} the HMAC secret used to sign DevRadar session tokens */
function jwtSecret() {
  const configured = readEnv('JWT_SECRET');
  if (configured) return configured;
  if (isProduction()) {
    // assertAuthConfig() stops the server from starting in this state; this is a second guard.
    throw new Error('JWT_SECRET must be set in production');
  }
  if (!fallbackJwtSecret) {
    fallbackJwtSecret = crypto.randomBytes(32).toString('hex');
    console.warn('JWT_SECRET is not set: using a random per-process secret (sessions reset on restart).');
  }
  return fallbackJwtSecret;
}

/**
 * The custom URL scheme of the mobile app (e.g. "devradar" for devradar://...), allowed as a
 * post-login redirect target. Returns null if it is unset or unsafe to allow-list.
 * @returns {string | null}
 */
function mobileAppScheme() {
  const raw = process.env.MOBILE_APP_SCHEME === undefined
    ? DEFAULT_MOBILE_APP_SCHEME
    : readEnv('MOBILE_APP_SCHEME');
  const scheme = raw.toLowerCase().replace(/:(\/\/)?$/, '');
  if (!URL_SCHEME_PATTERN.test(scheme) || FORBIDDEN_APP_SCHEMES.includes(scheme)) return null;
  return scheme;
}

/**
 * Lists configuration problems that must stop the server from starting. Only production is
 * strict: missing GitHub credentials or signing secret, or a signing secret that is too short.
 * Returns variable names and reasons only, never values.
 * @returns {string[]}
 */
function authConfigErrors() {
  if (!isProduction()) return [];
  const errors = [];
  ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'JWT_SECRET'].forEach((name) => {
    if (!readEnv(name)) errors.push(`${name} is required in production`);
  });
  const secret = readEnv('JWT_SECRET');
  if (secret && secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    errors.push(`JWT_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`);
  }
  return errors;
}

/**
 * Throws if the auth configuration is unusable, so index.js refuses to start.
 * @returns {void}
 */
function assertAuthConfig() {
  const errors = authConfigErrors();
  if (errors.length > 0) {
    throw new Error(`Invalid auth configuration: ${errors.join('; ')}. See dev/backend/.env.example.`);
  }
}

module.exports = {
  DEFAULT_GITHUB_CALLBACK_URL,
  DEFAULT_MOBILE_APP_SCHEME,
  githubClientId,
  githubClientSecret,
  githubCallbackUrl,
  isGithubOAuthConfigured,
  jwtSecret,
  mobileAppScheme,
  authConfigErrors,
  assertAuthConfig,
};
