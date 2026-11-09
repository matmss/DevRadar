require('dotenv').config();

const mongoose = require('mongoose');

const { createServer } = require('./app');
const { assertAuthConfig } = require('./config/auth');

if (!process.env.MONGO_URI) {
  throw new Error('Missing MONGO_URI environment variable. Copy .env.example to .env and fill it in.');
}

// In production, refuses to start without GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and JWT_SECRET.
// Also warns (without printing values) about settings that are ignored, e.g. MOBILE_APP_SCHEME.
assertAuthConfig();

// Express app (CORS, JSON body, routes, error handler) plus the HTTP server Socket.io shares.
const { server } = createServer();

mongoose.connect(process.env.MONGO_URI);

const PORT = process.env.PORT || 3333;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
