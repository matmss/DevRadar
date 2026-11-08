const { NEARBY_RADIUS_METERS, isNearby } = require('../../../dev/backend/src/utils/nearby');

// Degrees of latitude per km on MongoDB's 2dsphere sphere (radius 6378.1 km).
const DEG_PER_KM = (180 / Math.PI) / 6378.1;
const origin = { latitude: -23.5505, longitude: -46.6333 };
const north = (km) => ({ latitude: origin.latitude + km * DEG_PER_KM, longitude: origin.longitude });

describe('isNearby', () => {
  it('uses a 10 km radius', () => {
    expect(NEARBY_RADIUS_METERS).toBe(10000);
  });

  it('includes the origin itself', () => {
    expect(isNearby(origin, origin)).toBe(true);
  });

  it('includes points just inside the radius', () => {
    expect(isNearby(origin, north(9.995))).toBe(true);
  });

  it('excludes points just outside the radius (where the old 6371 km / "< 10" check said yes)', () => {
    expect(isNearby(origin, north(10.005))).toBe(false);
  });

  it('is inclusive at the boundary, like MongoDB $maxDistance', () => {
    expect(isNearby(origin, north(10 - 1e-9))).toBe(true);
  });
});
