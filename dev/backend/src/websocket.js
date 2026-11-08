const socketio = require('socket.io');
const parseStringAsArray = require('./utils/parseStringAsArray');
const { isNearby } = require('./utils/nearby');

let io;
const connections = [];

exports.setupWebsocket = (server) => {
  io = socketio(server, {
    cors: {
      origin: '*',
    },
  });

  io.on('connection', socket =>{
    const { latitude, longitude, techs } = socket.handshake.query;
    
    connections.push({
      id: socket.id,
      coordinates: {
        latitude: Number(latitude),
        longitude: Number(longitude),
      },
      techs: parseStringAsArray(techs),
    });
  });
};

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