// The `auth_one_time` collection: sign-in's single-use values, shared by every backend instance
// (multi-instance PR1, utils/sharedOneTimeStore.js). One document per issued OAuth `state`
// (10 min) or one-time sign-in code (60 s):
//   _id        sha256 of the raw value (base64url). The raw state or code is never stored, so
//              reading this collection gives nothing a client could present.
//   kind       'state' or 'code': a state is never accepted as a code, nor the reverse.
//   payload    what the value stands for (controllers/AuthController.js createSignInStores).
//              Never the GitHub access token.
//   expiresAt  set by MongoDB's clock at issue ($$NOW + lifetime). Expiry is enforced when the
//              value is consumed, against MongoDB's clock in the same operation.
// The TTL index only cleans up documents nobody consumed; it is not what makes a value expire
// (the TTL monitor runs about once a minute).
//
// The store reads and writes through the driver (`AuthOneTime.collection`): its update pipelines
// need $$NOW and $literal, which Mongoose casting does not handle. This schema declares the
// collection and its indexes (built at startup by index.js, like the Dev indexes).
const mongoose = require('mongoose');

const KINDS = ['state', 'code'];

const AuthOneTimeSchema = new mongoose.Schema(
  {
    _id: String,
    kind: { type: String, enum: KINDS, required: true },
    payload: mongoose.Schema.Types.Mixed,
    expiresAt: { type: Date, required: true },
  },
  { collection: 'auth_one_time', versionKey: false }
);

// Cleanup only (see above). expireAfterSeconds 0: removed once expiresAt has passed.
AuthOneTimeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AuthOneTime', AuthOneTimeSchema);
module.exports.KINDS = KINDS;
