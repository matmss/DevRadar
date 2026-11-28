// Rate limits (dev/docs/03-auth-spec.md, security criteria). Independent limiters, per 15 minutes.
// Per client IP, for the public /auth/* endpoints:
//   - signInRateLimiter:  GET /auth/github, GET /auth/github/callback, POST /auth/token.
//     AUTH_RATE_LIMIT_MAX, default 60. Each sign-in uses 3 requests.
//   - sessionRateLimiter: GET /auth/me, which clients call on every load.
//     AUTH_SESSION_RATE_LIMIT_MAX, default 600.
// Per signed-in GitHub account (its numeric id, auth spec Q10), after requireAuth:
//   - profileRateLimiter: PUT and DELETE /devs/me. PROFILE_RATE_LIMIT_MAX, default 30. Each change
//     is pushed to every matching socket, so this caps how much one account can make the backend
//     broadcast (QA-AUTH5 hardening 2). Keyed on the account, not the IP, so one account cannot
//     spread its changes over many addresses, and users behind one NAT do not share a budget.
//     Not on the login: a rename would otherwise start a fresh budget.
// The client IP is req.ip, so behind a reverse proxy set TRUST_PROXY (config/proxy.js) or every
// client shares the proxy's key.
//
// Counters are shared by every backend instance (multi-instance PR1): each limiter counts in the
// `rate_limits` MongoDB collection (middleware/mongoRateLimitStore.js) under its own key prefix,
// so N requests spread over any instances count as N. Each serverContext.js context still builds
// its own limiter objects (createRateLimiters); they are views of the same shared counters.
// If MongoDB fails, the request fails closed (passOnStoreError stays false): 500 internal_error
// from the error handler, logged without the key. Same 429 body and draft-7 headers as before.
const { rateLimit } = require('express-rate-limit');
const { MongoRateLimitStore } = require('./mongoRateLimitStore');

const WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_AUTH_RATE_LIMIT_MAX = 60;
const DEFAULT_AUTH_SESSION_RATE_LIMIT_MAX = 600;
const DEFAULT_PROFILE_RATE_LIMIT_MAX = 30;

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

/** @returns {number} PUT/DELETE /devs/me requests allowed per GitHub account per window */
function profileRateLimitMax() {
  return limitFromEnv('PROFILE_RATE_LIMIT_MAX', DEFAULT_PROFILE_RATE_LIMIT_MAX);
}

/**
 * @param {() => number} max - read per request, so env changes apply without a restart
 * @param {string} what - for the error details
 * @param {MongoRateLimitStore} store
 * @param {(req: import('express').Request) => string} [keyGenerator] - default: the client IP
 */
function createLimiter(max, what, store, keyGenerator) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: () => max(),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store,
    // Fail closed on a store error (also express-rate-limit's default): never unlimited.
    passOnStoreError: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler(req, res, next, options) {
      res.status(options.statusCode).json({
        error: 'Too many requests, try again later',
        code: 'rate_limited',
        details: [`At most ${max()} ${what} per 15 minutes`],
      });
    },
  });
}

// Key prefixes in the shared `rate_limits` collection, one per limiter.
const STORE_PREFIXES = Object.freeze({ signIn: 'sign_in:', session: 'session:', profile: 'profile:' });

/**
 * One server instance's three limiters, over the counters every instance shares.
 * @returns {{
 *   signInRateLimiter: import('express').RequestHandler,
 *   sessionRateLimiter: import('express').RequestHandler,
 *   profileRateLimiter: import('express').RequestHandler,
 *   reset: () => Promise<void>,
 * }}
 */
function createRateLimiters() {
  const signInStore = new MongoRateLimitStore({ prefix: STORE_PREFIXES.signIn, windowMs: WINDOW_MS });
  const sessionStore = new MongoRateLimitStore({ prefix: STORE_PREFIXES.session, windowMs: WINDOW_MS });
  const profileStore = new MongoRateLimitStore({ prefix: STORE_PREFIXES.profile, windowMs: WINDOW_MS });

  return {
    signInRateLimiter: createLimiter(authRateLimitMax, 'sign-in requests', signInStore),
    sessionRateLimiter: createLimiter(authSessionRateLimitMax, 'session checks', sessionStore),
    // Must run after requireAuth (routes.js), which sets req.user.
    profileRateLimiter: createLimiter(
      profileRateLimitMax,
      'profile changes',
      profileStore,
      (req) => `github_id:${req.user.github_id}`
    ),

    /**
     * Clears the shared counters of all three limiters (auth and profile), for every instance.
     * For test harnesses.
     * @returns {Promise<void>}
     */
    async reset() {
      await Promise.all([signInStore.resetAll(), sessionStore.resetAll(), profileStore.resetAll()]);
    },
  };
}

module.exports = {
  createRateLimiters,
  STORE_PREFIXES,
  WINDOW_MS,
  authRateLimitMax,
  authSessionRateLimitMax,
  profileRateLimitMax,
  DEFAULT_AUTH_RATE_LIMIT_MAX,
  DEFAULT_AUTH_SESSION_RATE_LIMIT_MAX,
  DEFAULT_PROFILE_RATE_LIMIT_MAX,
};
