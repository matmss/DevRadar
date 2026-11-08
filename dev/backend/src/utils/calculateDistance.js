function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// MongoDB's 2dsphere queries ($near/$maxDistance) measure on a sphere of this radius, so
// using the same value keeps the websocket radius check identical to GET /search (BUG-002).
const EARTH_RADIUS_KM = 6378.1;

/**
 * Great-circle (haversine) distance in km.
 * @param {{ latitude: number, longitude: number }} centerCoordinates
 * @param {{ latitude: number, longitude: number }} pointCoordinates
 * @returns {number}
 */
module.exports = function getDistanceFromLatLonInKm(
  centerCoordinates,
  pointCoordinates
) {
  const { latitude: lat1, longitude: lon1 } = centerCoordinates;
  const { latitude: lat2, longitude: lon2 } = pointCoordinates;

  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const center = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = EARTH_RADIUS_KM * center;

  return distance;
};
