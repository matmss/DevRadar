// Real-time pushes (Socket.io). A client subscribes at handshake time with its map position and
// techs, and must be signed in (dev/docs/03-auth-spec.md, Q1 and US-5). Events, all sent only to
// subscribers whose position and techs match the dev (findConnections, DevController):
//   new-dev      a dev registered (POST /devs created it)               payload: the dev
//   dev-updated  a dev changed techs/position (PUT /devs/me), matched
//                against the NEW position and techs (Q4); or its login
//                changed (a renamed GitHub account signing in or
//                registering again, or a dev displaced from a login
//                GitHub gave to someone else: placeholder login and
//                github_username_stale), matched against its
//                position/techs                                          payload: the dev
//   dev-deleted  a dev deleted their profile (DELETE /devs/me), matched
//                against its last position and techs                     payload: { _id, github_id, github_username }
// (Events are sent from services/devEvents.js.)
//
// Handshake contract:
//   auth:  { token: "<session token>" }            (socket.io-client `auth` option)
//   query: { latitude, longitude, techs }           (techs: comma-separated)
//
// The token is read ONLY from `socket.handshake.auth.token`, which travels in the Socket.io
// CONNECT packet, never in a URL, so it does not end up in access logs. A token in the query
// string or in an `Authorization` header is ignored (the handshake is `token_missing`): one
// place to look, the same on every transport (browsers cannot set headers on a WebSocket).
//
// Every rejection happens in a Socket.io middleware (`io.use`), before the `connection` event,
// so a rejected socket is never added to `connections` and never receives a push. The client
// gets a `connect_error` whose `message` is human readable and whose `data` is
// `{ code, details }`:
//   token_missing | token_expired | token_invalid   (same codes as the HTTP 401s, middleware/auth.js)
//   subscription_invalid                            (missing/invalid latitude, longitude or techs)
//   internal_error                                  (verification itself failed, e.g. no JWT_SECRET)
// The token is checked first, so an unauthenticated client learns nothing about validation.
// socket.io-client does not retry a connection refused by a middleware, so a rejected client
// does not loop. The token is checked on connect only: an open socket is not closed when its
// token expires (Q6). The next connect with that token is rejected as token_expired. A token
// issued before GitHub ids were captured is token_invalid (utils/sessionToken.js).
// socket.data.user is { github_id, github_username, profile }, like req.user.
//
// State: each server instance (app.js createServer, serverContext.js) has its own realtime hub
// (createRealtime): its own Socket.io server and its own `connections`. Two instances in one
// process share nothing, and a push only reaches the sockets connected to the instance that sent
// it (per server instance; a cross-instance push arrives in a later phase).
const socketio = require('socket.io');
const parseStringAsArray = require('./utils/parseStringAsArray');
const { isNearby } = require('./utils/nearby');
const { socketCorsOptions } = require('./config/cors');
const { verifySessionToken, TOKEN_ERROR } = require('./utils/sessionToken');

const SUBSCRIPTION_INVALID = 'subscription_invalid';
const INTERNAL_ERROR = 'internal_error';

const HANDSHAKE_ERRORS = {
  [TOKEN_ERROR.MISSING]: {
    message: 'Authentication required',
    details: ['Send the session token in the handshake auth payload: { token }'],
  },
  [TOKEN_ERROR.EXPIRED]: {
    message: 'Session expired, sign in again',
    details: ['The session token has expired'],
  },
  [TOKEN_ERROR.INVALID]: {
    message: 'Invalid session token',
    details: ['The session token is malformed or its signature is invalid'],
  },
  [SUBSCRIPTION_INVALID]: {
    message: 'Invalid subscription',
    details: ['latitude, longitude and techs query params are required'],
  },
  [INTERNAL_ERROR]: {
    message: 'Internal server error',
    details: ['The connection could not be authenticated, try again later'],
  },
};

// A refused client never joins the namespace; Socket.io closes such a connection after
// `connectTimeout` (default 45 s). Lowered so a client that ignores connect_error does not keep
// a refused connection open for long. A legitimate handshake takes well under a second.
const HANDSHAKE_TIMEOUT_MS = 10000;
// One object shared by every Socket.io server in the process (each createRealtime().attach passes
// it as is, and Socket.io writes `path` onto it). Keep it to options that are the same for every
// instance: per-instance options (e.g. a PR2 adapter) go in a copy made in attach, never here.
const SOCKET_OPTIONS = { ...socketCorsOptions, connectTimeout: HANDSHAKE_TIMEOUT_MS };

/**
 * @param {string} code - a key of HANDSHAKE_ERRORS
 * @returns {Error & { data: { code: string, details: string[] } }}
 */
function handshakeError(code) {
  const { message, details } = HANDSHAKE_ERRORS[code];
  const err = new Error(message);
  err.data = { code, details };
  return err;
}

/**
 * Socket.io middleware: authenticates the handshake, then validates the subscription. Never
 * throws (an exception here would be reported to the client as a generic error, and one in the
 * `connection` listener would crash the process, BUG-011).
 * @param {import('socket.io').Socket} socket
 * @param {(err?: Error) => void} next
 * @returns {void}
 */
function authenticateHandshake(socket, next) {
  const auth = socket.handshake.auth || {};
  let result;
  try {
    result = verifySessionToken(auth.token);
  } catch (err) {
    // Not a token problem (e.g. JWT_SECRET unusable): refuse, without the token or the message.
    console.error('Socket handshake verification failed:', err.name);
    next(handshakeError(INTERNAL_ERROR));
    return;
  }
  if (!result.ok) {
    next(handshakeError(result.code));
    return;
  }

  const subscription = parseHandshake(socket.handshake.query);
  if (!subscription) {
    next(handshakeError(SUBSCRIPTION_INVALID));
    return;
  }

  socket.data.user = result.user;
  socket.data.subscription = subscription;
  next();
}

/**
 * @typedef {{ id: string, coordinates: { latitude: number, longitude: number }, techs: string[] }} Connection
 * @typedef {{
 *   attach: (server: import('http').Server) => import('socket.io').Server,
 *   findConnections: (coordinates: { latitude: number, longitude: number }, techs: string[]) => Connection[],
 *   sendMessage: (to: Connection[], message: string, data: unknown) => void,
 *   connectionCount: () => number,
 * }} Realtime
 */

/**
 * One server instance's realtime hub: its Socket.io server (once attached) and the subscriptions
 * of the sockets connected to it.
 * @returns {Realtime}
 */
function createRealtime() {
  /** @type {import('socket.io').Server | null} */
  let io = null;
  /** @type {Connection[]} */
  const connections = [];

  return {
    /**
     * Attaches Socket.io to `server` (once per hub).
     * @param {import('http').Server} server
     * @returns {import('socket.io').Server}
     */
    attach(server) {
      if (io) throw new Error('This realtime hub is already attached to a server');
      io = socketio(server, SOCKET_OPTIONS);

      io.use(authenticateHandshake);

      io.on('connection', socket => {
        connections.push({ id: socket.id, ...socket.data.subscription });

        // Without this, every closed socket stays in `connections` forever (BUG-010).
        socket.on('disconnect', () => {
          const index = connections.findIndex(connection => connection.id === socket.id);
          if (index !== -1) connections.splice(index, 1);
        });
      });
      return io;
    },

    findConnections(coordinates, techs) {
      return connections.filter(connection => {
        return isNearby(coordinates, connection.coordinates)
        && connection.techs.some(item => techs.includes(item))
      })
    },

    sendMessage(to, message, data) {
      // Not attached (createApp without createServer): no socket can be connected, nothing to send.
      if (!io) return;
      to.forEach(connection => {
        io.to(connection.id).emit(message, data);
      })
    },

    /** @returns {number} sockets connected to this instance (for tests) */
    connectionCount() {
      return connections.length;
    },
  };
}

/**
 * Parses the socket handshake query into a subscription, or returns null if invalid.
 * @param {Record<string, unknown>} query
 * @returns {{ coordinates: { latitude: number, longitude: number }, techs: string[] } | null}
 */
function parseHandshake(query = {}) {
  const latitude = Number(query.latitude);
  const longitude = Number(query.longitude);
  const techs = typeof query.techs === 'string' ? parseStringAsArray(query.techs) : [];

  const valid = typeof query.latitude === 'string' && query.latitude.trim() !== ''
    && typeof query.longitude === 'string' && query.longitude.trim() !== ''
    && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    && techs.length > 0;

  return valid ? { coordinates: { latitude, longitude }, techs } : null;
}

exports.createRealtime = createRealtime;
exports.SUBSCRIPTION_INVALID = SUBSCRIPTION_INVALID;
exports.SOCKET_OPTIONS = SOCKET_OPTIONS;
exports.authenticateHandshake = authenticateHandshake;
