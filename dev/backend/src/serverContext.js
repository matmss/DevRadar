// Everything a backend server instance keeps in memory, in one object built per server
// (app.js createApp/createServer). Nothing here is a module-level singleton, so two servers built
// in one process (the multi-instance test harness) share nothing but MongoDB, with one deliberate
// exception: config/auth.js's fallback JWT secret (random per process when JWT_SECRET is unset
// outside production), which every server in the process signs with. Separate processes need one
// JWT_SECRET, or a token from one is token_invalid on another.
//
// Per server instance; shared state arrives in later phases. Each piece is the seam for one:
//   realtime         Socket.io server + its `connections` (websocket.js): a cross-instance push
//                    bus delivers to every instance, and each one still matches its own sockets
//                    with isNearby.
//   events           the announcer (services/devEvents.js) pushing through `realtime`.
//   signInStores     the OAuth `state` and the one-time sign-in codes (utils/oneTimeStore.js).
//   rateLimits       the three limiters and their counters (middleware/rateLimit.js).
//   writesByAccount  the per-account write queue (utils/keyedQueue.js) behind
//                    services/devOwnership.js inAccountOrder/inLoginOrder; a shared lease lock
//                    per account goes under it.
//   ownership        devOwnership's queued/announcing operations, bound to `writesByAccount` and
//                    `events`.
const { createRealtime } = require('./websocket');
const { createDevEvents } = require('./services/devEvents');
const { createDevOwnership } = require('./services/devOwnership');
const { createKeyedQueue } = require('./utils/keyedQueue');
const { createRateLimiters } = require('./middleware/rateLimit');
const { createSignInStores, createAuthController } = require('./controllers/AuthController');
const { createDevController } = require('./controllers/DevController');

/**
 * @typedef {{
 *   realtime: import('./websocket').Realtime,
 *   events: import('./services/devEvents').DevEvents,
 *   signInStores: ReturnType<typeof createSignInStores>,
 *   rateLimits: ReturnType<typeof createRateLimiters>,
 *   writesByAccount: ReturnType<typeof createKeyedQueue>,
 *   ownership: ReturnType<typeof createDevOwnership>,
 *   controllers: {
 *     auth: ReturnType<typeof createAuthController>,
 *     devs: ReturnType<typeof createDevController>,
 *   },
 * }} ServerContext
 */

/**
 * A fresh, independent context: new sockets list, stores, counters and queue.
 * @returns {ServerContext}
 */
function createServerContext() {
  const realtime = createRealtime();
  const events = createDevEvents(realtime);
  const writesByAccount = createKeyedQueue();
  const ownership = createDevOwnership({ writesByAccount, events });
  const signInStores = createSignInStores();
  const rateLimits = createRateLimiters();

  return {
    realtime,
    events,
    signInStores,
    rateLimits,
    writesByAccount,
    ownership,
    controllers: {
      auth: createAuthController({ signInStores, ownership }),
      devs: createDevController({ ownership, events }),
    },
  };
}

module.exports = { createServerContext };
