// Origins allowed to call the API from a browser (BUG-006). Comma-separated in CORS_ORIGINS.
// Defaults cover local dev: the CRA web app (3000) and Expo web (8081).
const DEFAULT_CORS_ORIGINS = 'http://localhost:3000,http://localhost:8081';

/** @returns {string[]} */
function allowedOrigins() {
  return (process.env.CORS_ORIGINS || DEFAULT_CORS_ORIGINS)
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

/**
 * Requests without an Origin header (the native mobile app, curl, server-to-server) are not
 * subject to CORS and stay allowed; browser requests must come from an allowed origin.
 * @param {string | undefined} origin
 * @returns {boolean}
 */
function isOriginAllowed(origin) {
  return !origin || allowedOrigins().includes(origin);
}

/** Options for the `cors` Express middleware. */
const corsOptions = {
  origin(origin, callback) {
    callback(null, isOriginAllowed(origin));
  },
};

/**
 * Socket.io options. `cors` only covers the HTTP long-polling transport; `allowRequest`
 * also rejects WebSocket handshakes from disallowed browser origins.
 */
const socketCorsOptions = {
  cors: corsOptions,
  allowRequest(req, callback) {
    callback(null, isOriginAllowed(req.headers.origin));
  },
};

module.exports = { allowedOrigins, isOriginAllowed, corsOptions, socketCorsOptions };
