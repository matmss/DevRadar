// The `rate_limits` collection: express-rate-limit counters shared by every backend instance
// (multi-instance PR1, middleware/mongoRateLimitStore.js). One document per limiter and client:
//   _id        `<limiter prefix><key>`, e.g. `sign_in:203.0.113.7` or
//              `profile:github_id:810438` (middleware/rateLimit.js).
//   hits       requests counted in the current window.
//   resetTime  when the window ends, set by MongoDB's clock ($$NOW + window) at the window's
//              first hit. A hit after it starts a new window.
// The TTL index only removes windows that are over; a stale document is never counted, since
// every increment compares resetTime with MongoDB's clock itself.
//
// The store writes through the driver (`RateLimit.collection`, update pipelines with $$NOW).
// This schema declares the collection and its indexes (built at startup by index.js).
const mongoose = require('mongoose');

const RateLimitSchema = new mongoose.Schema(
  {
    _id: String,
    hits: { type: Number, required: true },
    resetTime: { type: Date, required: true },
  },
  { collection: 'rate_limits', versionKey: false }
);

// Cleanup only (see above).
RateLimitSchema.index({ resetTime: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RateLimit', RateLimitSchema);
