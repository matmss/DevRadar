const mongoose = require('mongoose');
const PointSchema = require('./utils/PointSchema');
const { GITHUB_USERNAME_COLLATION } = require('../utils/githubUsername');

const DevSchema = new mongoose.Schema({
    name: String,
    // GitHub's numeric account id: who the profile belongs to (auth spec Q10). Set on every dev
    // created since sign-in exists, and on a legacy dev (created before, without one) when its
    // owner first changes it (services/devOwnership.js). Missing (or null, in hand-edited data)
    // means legacy.
    github_id: Number,
    // The GitHub login, display data, unique across all devs. Refreshed from the owner's GitHub
    // reads (sign-ins, and writes with a newer session). A dev whose login GitHub has given to
    // another account is displaced: it gets a placeholder that is never a valid GitHub login
    // (`_stale_<_id>`) and github_username_stale = true until its owner signs in again.
    github_username: String,
    // True while github_username is such a placeholder: clients show no GitHub link for it.
    github_username_stale: Boolean,
    // When GitHub was read for the login state stored here (a sign-in's GET /user, the session
    // token's login_read_at). An older read never changes it, so a stale token cannot set back a
    // rename. Internal: not sent to clients (toJSON below).
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

// One dev per GitHub account (Q10). Partial, not sparse: only devs with a positive numeric
// github_id are in it, so legacy devs (field missing, or null in hand-edited data) are left out
// entirely, any number of them can coexist, and building it never requires touching an existing
// document (US-8, no migration). An equality query on an id (always positive) can use it. It also
// makes a concurrent claim or registration for the same account fail with a duplicate-key error
// instead of a second dev.
DevSchema.index(
    { github_id: 1 },
    { unique: true, partialFilterExpression: { github_id: { $gt: 0 } }, name: 'github_id_unique' }
);

// One dev per GitHub login, case-insensitively, across ALL devs (QA-AUTH2-1; product decision
// for QA-AUTH6-1: logins stay unique). A legacy dev can only be claimed by the account holding its
// login, so two devs must never share one. A dev whose login GitHub gave to someone else is
// displaced at that person's sign-in (services/devOwnership.js), which frees the login. Built at
// startup (index.js calls Dev.init() without awaiting it, so on the very first start against a DB
// without the index the server can briefly accept requests before it exists). It cannot be built
// while legacy duplicates (same login in different letter case) exist; index.js then logs an
// error and keeps running without the guarantee. Mongoose still builds the other indexes when one
// fails.
DevSchema.index(
    { github_username: 1 },
    { unique: true, collation: GITHUB_USERNAME_COLLATION, name: 'github_username_unique_ci' }
);

module.exports = mongoose.model('Dev', DevSchema);
