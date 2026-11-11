// Live dev events (Socket.io, websocket.js), pushed to the subscribers whose position and techs
// match a dev (findConnections: the same isNearby + techs rule as GET /search).
const { findConnections, sendMessage } = require('../websocket');

const EVENT = Object.freeze({
  NEW_DEV: 'new-dev',
  DEV_UPDATED: 'dev-updated',
  DEV_DELETED: 'dev-deleted',
});

/**
 * Pushes `event` to the connected sockets whose subscription (position and techs) matches a dev
 * at `latitude`/`longitude` with `techs`.
 * @param {string} event
 * @param {{ latitude: number, longitude: number }} position
 * @param {string[]} techs
 * @param {object} payload
 */
function announce(event, position, techs, payload) {
  sendMessage(findConnections(position, techs), event, payload);
}

/**
 * The position and techs a stored dev is matched by, or null if it has none usable (a malformed
 * legacy record cannot match any subscriber).
 * @param {{ location?: { coordinates?: unknown }, techs?: unknown } | null} dev
 * @returns {{ position: { latitude: number, longitude: number }, techs: string[] } | null}
 */
function matchKeyOf(dev) {
  const coordinates = dev && dev.location && dev.location.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length !== 2 || !Array.isArray(dev.techs)) return null;
  const [longitude, latitude] = coordinates;
  return { position: { latitude, longitude }, techs: [...dev.techs] };
}

/**
 * Announces a stored dev as `event` at its own position and techs (if it has usable ones).
 * @param {string} event
 * @param {object} dev - a Dev document
 * @param {object} [payload] - default: the dev
 */
function announceStored(event, dev, payload = dev) {
  const key = matchKeyOf(dev);
  if (key) announce(event, key.position, key.techs, payload);
}

module.exports = { EVENT, announce, announceStored };
