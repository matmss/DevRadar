// An express-rate-limit (v8) Store backed by MongoDB (the `rate_limits` collection,
// models/RateLimit.js; multi-instance PR1), so every backend instance counts against one limit.
// Works on a standalone mongod (single-document atomic updates only); needs MongoDB 4.2 or later
// ($$NOW in update pipelines).
//
// Fixed windows, like express-rate-limit's MemoryStore: a client's first hit opens a window of
// `windowMs`, every hit until it ends adds one, the first hit after it opens a new one. One
// atomic upsert per hit on { _id: prefix + key }; the window's resetTime is MongoDB's clock
// ($$NOW + windowMs) and the "is the window over?" check uses $$NOW too, so instances with skewed
// clocks share the same windows. (The RateLimit/Retry-After headers express-rate-limit sends
// subtract the instance's clock from resetTime: only they depend on it.) The TTL index on
// resetTime removes finished windows; it is never needed for correctness.
//
// Errors: a MongoDB failure throws a SharedStateError (utils/sharedStateError.js) whose message
// names no key. middleware/rateLimit.js leaves express-rate-limit's passOnStoreError at false,
// so the request fails closed: it reaches the error handler, 500 internal_error.
const RateLimit = require('../models/RateLimit');
const { sharedStateOperation } = require('../utils/sharedStateError');

const DUPLICATE_KEY = 11000;

/** @param {string} text @returns {string} the text as a literal in a regular expression */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class MongoRateLimitStore {
  /**
   * @param {{ prefix: string, windowMs: number,
   *   collection?: () => import('mongodb').Collection }} options
   *   `prefix` must be unique per limiter (it namespaces the keys in the shared collection).
   *   `windowMs` is replaced by the limiter's own in init(). `collection` defaults to
   *   `rate_limits` (through Mongoose's connection, which queues operations until connected).
   */
  constructor({ prefix, windowMs, collection = () => RateLimit.collection }) {
    if (typeof prefix !== 'string' || prefix === '') throw new TypeError('prefix is required');
    /** Read by express-rate-limit's double-count validation. */
    this.prefix = prefix;
    /** Keys are shared with every other instance of this store (express-rate-limit Store API). */
    this.localKeys = false;
    this.windowMs = windowMs;
    this.collection = collection;
  }

  /** @param {{ windowMs: number }} options - the limiter's options */
  init(options) {
    this.windowMs = options.windowMs;
  }

  /** @param {string} key @returns {string} */
  storedId(key) {
    return `${this.prefix}${key}`;
  }

  /**
   * @param {string} key
   * @returns {Promise<{ totalHits: number, resetTime: Date } | undefined>}
   */
  async get(key) {
    const doc = await sharedStateOperation('rate_limits get', () => this.collection().findOne({
      _id: this.storedId(key),
      $expr: { $gt: ['$resetTime', '$$NOW'] },
    }));
    return doc ? { totalHits: doc.hits, resetTime: doc.resetTime } : undefined;
  }

  /**
   * One hit: +1 in the current window, or 1 in a new window if there is none or it is over.
   * @param {string} key
   * @returns {Promise<{ totalHits: number, resetTime: Date }>}
   */
  async increment(key) {
    const live = { $gt: ['$resetTime', '$$NOW'] }; // false while resetTime is missing
    const hit = () => this.collection().findOneAndUpdate(
      { _id: this.storedId(key) },
      [{
        // Both read the stored document as it was before this update.
        $set: {
          hits: { $cond: [live, { $add: ['$hits', 1] }, 1] },
          resetTime: { $cond: [live, '$resetTime', { $add: ['$$NOW', this.windowMs] }] },
        },
      }],
      { upsert: true, returnDocument: 'after' }
    );
    const doc = await sharedStateOperation('rate_limits increment', async () => {
      try {
        return await hit();
      } catch (err) {
        // Two first hits racing to insert: MongoDB retries such upserts itself, this covers any
        // server that does not. The second try finds the inserted document.
        if (err && err.code === DUPLICATE_KEY) return hit();
        throw err;
      }
    });
    return { totalHits: doc.hits, resetTime: doc.resetTime };
  }

  /** @param {string} key - takes back one hit of the current window (never below 0) */
  async decrement(key) {
    await sharedStateOperation('rate_limits decrement', () => this.collection().updateOne(
      { _id: this.storedId(key), hits: { $gt: 0 }, $expr: { $gt: ['$resetTime', '$$NOW'] } },
      { $inc: { hits: -1 } }
    ));
  }

  /** @param {string} key */
  async resetKey(key) {
    await sharedStateOperation('rate_limits resetKey', () => this.collection().deleteOne({ _id: this.storedId(key) }));
  }

  /** Clears this limiter's counters on every instance (same prefix). */
  async resetAll() {
    await sharedStateOperation('rate_limits resetAll', () => this.collection().deleteMany({
      _id: { $regex: `^${escapeRegExp(this.prefix)}` },
    }));
  }
}

module.exports = { MongoRateLimitStore };
