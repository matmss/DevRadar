require('dotenv').config();

const mongoose = require('mongoose');

const { createServer } = require('./app');
const { assertAuthConfig } = require('./config/auth');
const Dev = require('./models/Dev');

if (!process.env.MONGO_URI) {
  throw new Error('Missing MONGO_URI environment variable. Copy .env.example to .env and fill it in.');
}

// In production, refuses to start without GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and JWT_SECRET.
// Also warns (without printing values) about settings that are ignored, e.g. MOBILE_APP_SCHEME.
assertAuthConfig();

// Express app (CORS, JSON body, routes, error handler) plus the HTTP server Socket.io shares.
const { server } = createServer();

mongoose.connect(process.env.MONGO_URI);

// Builds the Dev indexes, including the unique case-insensitive github_username index that keeps
// one dev per GitHub login (models/Dev.js). Existing legacy duplicates (same login in different
// letter case) make the build fail: the server still runs, registration still upserts, but two
// exactly simultaneous first registrations could then both insert. Logged so it gets fixed.
Dev.init().catch((err) => {
  console.error(
    'Could not build the Dev indexes. If this is a duplicate key error, merge the developers '
    + 'whose github_username differs only in letter case, then restart:',
    err.message
  );
});

const PORT = process.env.PORT || 3333;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
