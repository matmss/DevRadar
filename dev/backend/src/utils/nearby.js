const calculateDistance = require('./calculateDistance');

// Single source of truth for "nearby", shared by GET /search and the websocket push.
const NEARBY_RADIUS_METERS = 10000;

/**
 * Same rule as MongoDB's `$near` + `$maxDistance`: inclusive, measured on the same sphere.
 * @param {{ latitude: number, longitude: number }} center
 * @param {{ latitude: number, longitude: number }} point
 * @returns {boolean}
 */
function isNearby(center, point) {
  return calculateDistance(center, point) * 1000 <= NEARBY_RADIUS_METERS;
}

module.exports = { NEARBY_RADIUS_METERS, isNearby };
