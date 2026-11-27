// Random, single-use, expiring keys shared by every backend instance through MongoDB (the
// `auth_one_time` collection, models/AuthOneTime.js; multi-instance PR1). Used for the OAuth
// `state` (10 min) and the post-login one-time code (60 s): a state issued by one instance is
// accepted at another's callback, and a code from one is redeemable on any other. Works on a
// standalone mongod (no transactions, no replica set). Needs MongoDB 4.4 or later ($$NOW in an
// update pipeline and an aggregation expression in a findAndModify projection).
//
// Same contract as utils/oneTimeStore.js (the in-memory original, kept for its unit tests), but
// async:
//   issue(payload)  -> a fresh random key (32 bytes, base64url). Stored as { _id: sha256(key),
//                      kind, payload, expiresAt }; the raw key is never stored or logged.
//                      expiresAt is MongoDB's clock + ttlMs ($$NOW in an update pipeline), so
//                      instances with skewed clocks agree on every expiry.
//   consume(key)    -> the payload once, then null. One atomic findOneAndDelete: of concurrent
//                      consumers on any instances exactly one gets the document. The document is
//                      deleted whether or not it has expired (a presented value is spent either
//                      way, e.g. a wrong code_verifier burns the code), and the same operation
//                      tells whether it was still live by MongoDB's clock ($$NOW). So expiry
//                      does not wait for the TTL monitor, which only cleans up.
//   clear()         -> deletes every key of this kind (test harnesses).
// The in-memory store's `maxEntries` flood bound is gone: what bounds the collection now is the
// per-IP sign-in rate limit (shared too, middleware/rateLimit.js) plus the TTL cleanup.
//
// MongoDB failures throw a SharedStateError (utils/sharedStateError.js): the request fails closed
// with 500 internal_error, and the log names no key.
const crypto = require('crypto');
const AuthOneTime = require('../models/AuthOneTime');
const { SharedStateError, sharedStateOperation } = require('./sharedStateError');

const KEY_BYTES = 32;
// A fresh key that hashes to a stored one is a 2^-256 event; retried anyway, never overwritten.
const MAX_ISSUE_ATTEMPTS = 3;
const DUPLICATE_KEY = 11000;

/**
 * @param {string} key - the raw value a client holds
 * @returns {string} the stored _id
 */
function hashKey(key) {
  return crypto.createHash('sha256').update(key, 'utf8').digest('base64url');
}

/**
 * @template T
 * @param {{ kind: 'state' | 'code', ttlMs: number,
 *   collection?: () => import('mongodb').Collection }} options
 *   `collection` defaults to the `auth_one_time` collection (through Mongoose's connection, which
 *   queues operations until it is connected).
 * @returns {{
 *   issue: (payload: T) => Promise<string>,
 *   consume: (key: unknown) => Promise<T | null>,
 *   clear: () => Promise<void>,
 * }}
 */
function createSharedOneTimeStore({ kind, ttlMs, collection = () => AuthOneTime.collection }) {
  if (!AuthOneTime.KINDS.includes(kind)) throw new TypeError(`Unknown one-time key kind: ${kind}`);
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs must be a positive integer');

  return {
    async issue(payload) {
      const operation = `auth_one_time issue (${kind})`;
      for (let attempt = 1; attempt <= MAX_ISSUE_ATTEMPTS; attempt += 1) {
        const key = crypto.randomBytes(KEY_BYTES).toString('base64url');
        const inserted = await sharedStateOperation(operation, async () => {
          try {
            await collection().updateOne(
              // Matches no stored document, so this always inserts: a stored key is never
              // overwritten (an existing _id makes the insert fail with E11000 instead).
              { _id: hashKey(key), expiresAt: { $exists: false } },
              [{
                $set: {
                  kind,
                  // $literal: stored as given, never read as an expression or a field path.
                  payload: { $literal: payload === undefined ? null : payload },
                  expiresAt: { $add: ['$$NOW', ttlMs] },
                },
              }],
              { upsert: true }
            );
            return true;
          } catch (err) {
            if (err && err.code === DUPLICATE_KEY) return false;
            throw err;
          }
        });
        if (inserted) return key;
      }
      throw new SharedStateError(operation, { name: 'KeyCollision' });
    },

    async consume(key) {
      if (typeof key !== 'string' || key === '') return null;
      const spent = await sharedStateOperation(`auth_one_time consume (${kind})`, () => collection().findOneAndDelete(
        { _id: hashKey(key), kind },
        { projection: { _id: 0, payload: 1, live: { $gt: ['$expiresAt', '$$NOW'] } } }
      ));
      return spent && spent.live === true ? spent.payload : null;
    },

    async clear() {
      await sharedStateOperation(`auth_one_time clear (${kind})`, () => collection().deleteMany({ kind }));
    },
  };
}

module.exports = { createSharedOneTimeStore, hashKey };
