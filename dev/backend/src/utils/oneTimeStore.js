// In-memory store of random, single-use, expiring keys. Used for the OAuth `state` (~10 min)
// and the post-login one-time code (~1 min).
//
// Limitation: entries live in memory, per server instance (each serverContext.js context makes
// its own stores). A key issued by one instance (or before a restart) is unknown to another, so
// until shared state arrives in a later phase, sign-in needs sticky sessions with more than one
// instance.
const crypto = require('crypto');

const KEY_BYTES = 32;
const DEFAULT_MAX_ENTRIES = 10000;

/**
 * @template T
 * @param {{ ttlMs: number, maxEntries?: number, now?: () => number }} options
 *   `now` is injectable for tests; it defaults to Date.now, read at call time.
 * @returns {{
 *   issue: (payload: T) => string,
 *   consume: (key: unknown) => T | null,
 *   size: () => number,
 *   clear: () => void,
 * }}
 */
function createOneTimeStore({ ttlMs, maxEntries = DEFAULT_MAX_ENTRIES, now = () => Date.now() }) {
  /** @type {Map<string, { payload: T, expiresAt: number }>} insertion order = oldest first */
  const entries = new Map();

  function sweepExpired() {
    const current = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= current) entries.delete(key);
    }
  }

  return {
    issue(payload) {
      sweepExpired();
      // Bounds memory if someone floods the start endpoint: evict the oldest entries.
      while (entries.size >= maxEntries) {
        entries.delete(entries.keys().next().value);
      }
      const key = crypto.randomBytes(KEY_BYTES).toString('base64url');
      entries.set(key, { payload, expiresAt: now() + ttlMs });
      return key;
    },

    consume(key) {
      if (typeof key !== 'string' || !entries.has(key)) return null;
      const entry = entries.get(key);
      entries.delete(key); // single use, whether or not it has expired
      return entry.expiresAt > now() ? entry.payload : null;
    },

    size() {
      return entries.size;
    },

    clear() {
      entries.clear();
    },
  };
}

module.exports = { createOneTimeStore };
