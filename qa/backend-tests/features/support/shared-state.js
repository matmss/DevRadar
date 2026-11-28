// Test access to the state every backend instance shares through MongoDB since multi-instance PR1:
// the `auth_one_time` collection (OAuth states and one-time sign-in codes, stored by the sha256 of
// the raw value, dev/backend/src/utils/sharedOneTimeStore.js) and the `rate_limits` collection
// (dev/backend/src/middleware/mongoRateLimitStore.js).
//
// Both expire by MongoDB's clock ($$NOW), which a test cannot move. "Time passes" for them by
// moving their stored expiry back instead (ageSharedState), which is what MongoDB's clock moving
// forward would look like to them. hooks.js empties both collections before every scenario.
const crypto = require('crypto');
// The same mongoose (and so the same connection) the backend uses, see hooks.js.
const mongoose = require('../../../../dev/backend/node_modules/mongoose');
const AuthOneTime = require('../../../../dev/backend/src/models/AuthOneTime');
const RateLimit = require('../../../../dev/backend/src/models/RateLimit');

/**
 * @param {string} raw - a state or one-time code as a client holds it
 * @returns {string} its `_id` in auth_one_time (sha256, base64url)
 */
function storedIdOf(raw) {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('base64url');
}

/**
 * Moves every stored expiry (sign-in values and rate-limit windows) `ms` into the past.
 * @param {number} ms
 */
async function ageSharedState(ms) {
  await AuthOneTime.collection.updateMany({}, [{ $set: { expiresAt: { $subtract: ['$expiresAt', ms] } } }]);
  await RateLimit.collection.updateMany({}, [{ $set: { resetTime: { $subtract: ['$resetTime', ms] } } }]);
}

/**
 * @param {string} raw
 * @returns {Promise<object | null>} the stored document of that state or code, as the driver reads it
 */
function storedOneTimeDoc(raw) {
  return AuthOneTime.collection.findOne({ _id: storedIdOf(raw) });
}

/**
 * Sets the stored expiry of one state or code `ms` before MongoDB's current time.
 * @param {string} raw
 * @param {number} ms
 * @returns {Promise<number>} documents changed
 */
async function expireOneTimeValue(raw, ms) {
  const result = await AuthOneTime.collection.updateOne(
    { _id: storedIdOf(raw) },
    [{ $set: { expiresAt: { $subtract: ['$$NOW', ms] } } }]
  );
  return result.modifiedCount;
}

/** @returns {Promise<object[]>} every auth_one_time document */
function allOneTimeDocs() {
  return AuthOneTime.collection.find({}).toArray();
}

/** @returns {Promise<object[]>} every rate_limits document */
function allRateLimitDocs() {
  return RateLimit.collection.find({}).toArray();
}

/**
 * Turns MongoDB's TTL monitor off or on (a server parameter; the monitor normally runs every 60 s).
 * Off, an expired document can only disappear because the backend deleted it.
 * @param {boolean} enabled
 */
async function setTtlMonitor(enabled) {
  await mongoose.connection.db.admin().command({ setParameter: 1, ttlMonitorEnabled: enabled });
}

/** @returns {Promise<Date>} MongoDB's current time (the clock behind $$NOW) */
async function mongoNow() {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  return hello.localTime;
}

/**
 * @param {import('mongoose').Model} model
 * @returns {Promise<object[]>} the collection's indexes
 */
function indexesOf(model) {
  return model.collection.indexes();
}

module.exports = {
  AuthOneTime,
  RateLimit,
  storedIdOf,
  ageSharedState,
  storedOneTimeDoc,
  expireOneTimeValue,
  allOneTimeDocs,
  allRateLimitDocs,
  setTtlMonitor,
  mongoNow,
  indexesOf,
};
