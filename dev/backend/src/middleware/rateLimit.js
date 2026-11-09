// Rate limit for the public /auth/* endpoints (dev/docs/03-auth-spec.md, security criteria).
// Keyed by client IP, in-memory: like the OAuth state store, counts are per process. Behind a
// reverse proxy, Express's `trust proxy` must be configured or every client shares one key.
const { rateLimit, MemoryStore } = require('express-rate-limit');

const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_AUTH_RATE_LIMIT_MAX = 60;

/** @returns {number} requests allowed per IP per window (AUTH_RATE_LIMIT_MAX, default 60) */
function authRateLimitMax() {
  const configured = Number(process.env.AUTH_RATE_LIMIT_MAX);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_AUTH_RATE_LIMIT_MAX;
}

const authRateLimitStore = new MemoryStore();

const authRateLimiter = rateLimit({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  limit: () => authRateLimitMax(),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: authRateLimitStore,
  handler(req, res, next, options) {
    res.status(options.statusCode).json({
      error: 'Too many requests, try again later',
      code: 'rate_limited',
      details: [`At most ${authRateLimitMax()} sign-in requests per 15 minutes`],
    });
  },
});

/**
 * Clears all rate-limit counters. For test harnesses that reuse one process across scenarios.
 * @returns {Promise<void>}
 */
async function resetAuthRateLimit() {
  await authRateLimitStore.resetAll();
}

module.exports = { authRateLimiter, resetAuthRateLimit, authRateLimitMax, DEFAULT_AUTH_RATE_LIMIT_MAX };
