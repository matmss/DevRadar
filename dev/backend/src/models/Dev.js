const mongoose = require('mongoose');
const PointSchema = require('./utils/PointSchema');
const { GITHUB_USERNAME_COLLATION } = require('../utils/githubUsername');

const DevSchema = new mongoose.Schema({
    name: String,
    github_username: String,
    bio: String,
    avatar_url: String,
    techs: [String],
    location: {
        type: PointSchema,
        index: '2dsphere'
    }
});

// One dev per GitHub login, case-insensitively (QA-AUTH2-1). This is what makes concurrent
// POST /devs for the same login safe: DevController upserts, and the losing insert of a race
// gets a duplicate-key error it answers with the existing dev. Built at startup (index.js calls
// Dev.init() without awaiting it, so on the very first start against a DB without the index the
// server can briefly accept requests before it exists). It cannot be built while legacy duplicates (same login in different letter case)
// exist; index.js then logs an error and keeps running without the guarantee.
DevSchema.index(
    { github_username: 1 },
    { unique: true, collation: GITHUB_USERNAME_COLLATION, name: 'github_username_unique_ci' }
);

module.exports = mongoose.model('Dev', DevSchema);
