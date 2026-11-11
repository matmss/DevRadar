// Live pushes for the current map region: `new-dev` (a dev registered), `dev-updated` (a dev
// changed techs or position, sent for the NEW ones; or its login changed: a rename, or a
// displacement with `github_username_stale: true` and a placeholder login, see
// services/githubLogin.js) and `dev-deleted` ({ _id, github_id, github_username }; a legacy dev
// is claimed before it is deleted, so github_id is set), see dev/backend/src/websocket.js. The backend requires a session token at
// handshake (dev/backend/src/websocket.js): it goes in the Socket.io `auth` payload, never in
// the query string, so it does not end up in URLs or access logs. A refused handshake arrives as
// connect_error with `data.code`; socket.io-client does not retry it on its own.
import socketio from 'socket.io-client';

import { API_URL } from '../config';
import { socketAuthFailure } from './authErrors';

const socket = socketio(API_URL, {
  autoConnect: false,
});

/**
 * @param {string} event
 * @param {(payload: object) => void} listener
 * @returns {() => void} unsubscribe
 */
function subscribe(event, listener) {
  socket.on(event, listener);
  return () => socket.off(event, listener);
}

/**
 * @param {(dev: object) => void} listener
 * @returns {() => void} unsubscribe
 */
function subscribeToNewDevs(listener) {
  return subscribe('new-dev', listener);
}

/**
 * A nearby, tech-matching dev changed their techs or position (PUT /devs/me).
 * @param {(dev: object) => void} listener - receives the whole updated dev
 * @returns {() => void} unsubscribe
 */
function subscribeToDevUpdates(listener) {
  return subscribe('dev-updated', listener);
}

/**
 * A dev that could be on this map deleted their profile (DELETE /devs/me).
 * @param {(dev: { _id: string, github_id: number, github_username: string }) => void} listener
 * @returns {() => void} unsubscribe
 */
function subscribeToDevDeletions(listener) {
  return subscribe('dev-deleted', listener);
}

/**
 * Calls `listener(code, sentToken)` when the backend refuses the handshake because of the
 * session token (token_missing, token_expired, token_invalid). Other refusals are only logged.
 * @param {(code: string, sentToken: string | null) => void} listener
 * @returns {() => void} unsubscribe
 */
function subscribeToAuthErrors(listener) {
  const onConnectError = (error) => {
    const failure = socketAuthFailure(error);
    if (failure) {
      listener(failure.code, (socket.auth && socket.auth.token) || null);
      return;
    }
    console.warn('Live updates unavailable:', (error && error.data && error.data.code) || (error && error.message));
  };
  socket.on('connect_error', onConnectError);
  return () => socket.off('connect_error', onConnectError);
}

/**
 * Subscribes to pushes around a position, authenticated as `token`. Replaces any previous
 * subscription (the backend reads position and techs at handshake only).
 * @param {number} latitude
 * @param {number} longitude
 * @param {string} techs - comma-separated
 * @param {string | null} token - the session token
 * @returns {boolean} false (and nothing is opened) without a token: an anonymous handshake would
 *   only be refused, and must never reach the server (QA-AUTH4-1)
 */
function connect(latitude, longitude, techs, token) {
  socket.disconnect();
  if (typeof token !== 'string' || token === '') {
    socket.auth = {};
    return false;
  }
  socket.auth = { token };
  socket.io.opts.query = {
    latitude,
    longitude,
    techs,
  };

  socket.connect();
  return true;
}

/** Closes the socket (also stops a connection attempt in progress) and forgets the token. */
function disconnect() {
  socket.disconnect();
  socket.auth = {};
}

export {
  connect,
  disconnect,
  subscribeToNewDevs,
  subscribeToDevUpdates,
  subscribeToDevDeletions,
  subscribeToAuthErrors,
};
