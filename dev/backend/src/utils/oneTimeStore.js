// In-memory store of random, single-use, expiring keys: the original OAuth `state` / one-time
// code store. The server no longer uses it: since multi-instance PR1 sign-in uses
// utils/sharedOneTimeStore.js (MongoDB, shared by every instance), which keeps this contract
// (async). Kept as the reference implementation of that contract and for its unit tests
// (qa/backend-tests/unit/oneTimeStore.test.js). Entries here live in one process only, and
// `maxEntries` bounds them; the shared store relies on the per-IP sign-in rate limit instead.
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
