// Live `new-dev` pushes for the current map region. The backend requires a session token at
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
 * @param {(dev: object) => void} listener
 * @returns {() => void} unsubscribe
 */
function subscribeToNewDevs(listener) {
  socket.on('new-dev', listener);
  return () => socket.off('new-dev', listener);
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
  subscribeToAuthErrors,
};
