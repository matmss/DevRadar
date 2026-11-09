// Rate limits for the public /auth/* endpoints (dev/docs/03-auth-spec.md, security criteria).
// Two independent limiters, both per client IP per 15 minutes:
//   - signInRateLimiter:  GET /auth/github, GET /auth/github/callback, POST /auth/token.
//     AUTH_RATE_LIMIT_MAX, default 60. Each sign-in uses 3 requests.
//   - sessionRateLimiter: GET /auth/me, which clients call on every load.
//     AUTH_SESSION_RATE_LIMIT_MAX, default 600.
// The client IP is req.ip, so behind a reverse proxy set TRUST_PROXY (config/proxy.js) or every
// client shares the proxy's key. Counters are in memory, per process (like the OAuth state).
const { rateLimit, MemoryStore } = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_AUTH_RATE_LIMIT_MAX = 60;
const DEFAULT_AUTH_SESSION_RATE_LIMIT_MAX = 600;

/**
 * @param {string} name - env var holding a positive integer
 * @param {number} fallback
 * @returns {number}
 */
function limitFromEnv(name, fallback) {
  const configured = Number(process.env[name]);
  return Number.isInteger(configured) && configured > 0 ? configured : fallback;
}

/** @returns {number} sign-in requests allowed per IP per window */
function authRateLimitMax() {
  return limitFromEnv('AUTH_RATE_LIMIT_MAX', DEFAULT_AUTH_RATE_LIMIT_MAX);
}

/** @returns {number} GET /auth/me requests allowed per IP per window */
function authSessionRateLimitMax() {
  return limitFromEnv('AUTH_SESSION_RATE_LIMIT_MAX', DEFAULT_AUTH_SESSION_RATE_LIMIT_MAX);
}

/**
 * @param {() => number} max - read per request, so env changes apply without a restart
 * @param {string} what - for the error details
 * @param {MemoryStore} store
 */
function createLimiter(max, what, store) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: () => max(),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store,
    handler(req, res, next, options) {
      res.status(options.statusCode).json({
        error: 'Too many requests, try again later',
        code: 'rate_limited',
        details: [`At most ${max()} ${what} per 15 minutes`],
      });
    },
  });
}

const signInStore = new MemoryStore();
const sessionStore = new MemoryStore();

const signInRateLimiter = createLimiter(authRateLimitMax, 'sign-in requests', signInStore);
const sessionRateLimiter = createLimiter(authSessionRateLimitMax, 'session checks', sessionStore);

/**
 * Clears all auth rate-limit counters. For test harnesses that reuse one process.
 * @returns {Promise<void>}
 */
async function resetAuthRateLimit() {
  await Promise.all([signInStore.resetAll(), sessionStore.resetAll()]);
}

module.exports = {
  signInRateLimiter,
  sessionRateLimiter,
  resetAuthRateLimit,
  authRateLimitMax,
  authSessionRateLimitMax,
  DEFAULT_AUTH_RATE_LIMIT_MAX,
  DEFAULT_AUTH_SESSION_RATE_LIMIT_MAX,
};
