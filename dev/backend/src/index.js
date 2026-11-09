require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const routes = require('./routes');
const cors = require('cors');
const http = require('http');

const { setupWebsocket } = require('./websocket');
const { corsOptions } = require('./config/cors');
const { assertAuthConfig } = require('./config/auth');

const app = express();
const server = http.Server(app);

setupWebsocket(server);

if (!process.env.MONGO_URI) {
  throw new Error('Missing MONGO_URI environment variable. Copy .env.example to .env and fill it in.');
}

// In production, refuses to start without GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and JWT_SECRET.
assertAuthConfig();

mongoose.connect(process.env.MONGO_URI);

app.use(cors(corsOptions));
app.use(express.json());
app.use(routes);

const PORT = process.env.PORT || 3333;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));