const socketio = require('socket.io');
const parseStringAsArray = require('./utils/parseStringAsArray');
const { isNearby } = require('./utils/nearby');
const { socketCorsOptions } = require('./config/cors');

let io;
const connections = [];

exports.setupWebsocket = (server) => {
  io = socketio(server, socketCorsOptions);

  io.on('connection', socket => {
    const subscription = parseHandshake(socket.handshake.query);

    // An invalid handshake must not throw here: an exception in this listener is uncaught
    // and crashes the whole backend process (BUG-011).
    if (!subscription) {
      socket.emit('subscription-error', 'latitude, longitude and techs query params are required');
      socket.disconnect(true);
      return;
    }

    connections.push({ id: socket.id, ...subscription });

    // Without this, every closed socket stays in `connections` forever (BUG-010).
    socket.on('disconnect', () => {
      const index = connections.findIndex(connection => connection.id === socket.id);
      if (index !== -1) connections.splice(index, 1);
    });
  });
};

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

exports.findConnections = (coordinates, techs) => {
  return connections.filter(connection => {
    return isNearby(coordinates, connection.coordinates)
    && connection.techs.some(item => techs.includes(item))
  })
}

exports.sendMessage = (to, message, data) => {
  to.forEach(connection => {
    io.to(connection.id).emit(message, data);
  })
}