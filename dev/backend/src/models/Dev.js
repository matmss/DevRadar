const mongoose = require('mongoose');
const PointSchema = require('./utils/PointSchema');
const { GITHUB_USERNAME_COLLATION } = require('../utils/githubUsername');

const DevSchema = new mongoose.Schema({
    name: String,
    // GitHub's numeric account id: who the profile belongs to (auth spec Q10). Set on every dev
    // created since sign-in exists, and on a legacy dev (created before, without one) when its
    // owner first changes it (services/devOwnership.js). Never null: absent means legacy.
    github_id: Number,
    // The GitHub login, display data. Refreshed from the owner's session on their writes and
    // sign-ins, so a renamed account shows its new login (and frees the old one).
    github_username: String,
    // When the session that set github_username began (its token's iat). A session that began
    // earlier never changes the login, so a stale token cannot set back a rename. Internal: not
    // sent to clients (toJSON below).
    github_username_seen_at: Date,
    bio: String,
    avatar_url: String,
    techs: [String],
    location: {
        type: PointSchema,
        index: '2dsphere'
    }
}, {
    toJSON: {
        transform(doc, ret) {
            delete ret.github_username_seen_at;
            return ret;
        }
    }
});

// One dev per GitHub account (Q10). Partial, not sparse: legacy devs have no github_id and are
// left out of the index entirely, so any number of them can coexist and building it never
// requires touching an existing document (US-8, no migration). It also makes a concurrent claim
// or registration for the same account fail with a duplicate-key error instead of a second dev.
DevSchema.index(
    { github_id: 1 },
    { unique: true, partialFilterExpression: { github_id: { $exists: true } }, name: 'github_id_unique' }
);

// One dev per GitHub login, case-insensitively (QA-AUTH2-1). A legacy dev can only be claimed by
// the account holding its login, so two devs must never share one; and a dev whose owner renamed
// away keeps the old login until that owner signs in again, which is why POST /devs can answer
// 409 github_username_conflict (DevController). Built at startup (index.js calls Dev.init()
// without awaiting it, so on the very first start against a DB without the index the server can
// briefly accept requests before it exists). It cannot be built while legacy duplicates (same
// login in different letter case) exist; index.js then logs an error and keeps running without
// the guarantee. Mongoose still builds the other indexes when one fails.
DevSchema.index(
    { github_username: 1 },
    { unique: true, collation: GITHUB_USERNAME_COLLATION, name: 'github_username_unique_ci' }
);

module.exports = mongoose.model('Dev', DevSchema);
