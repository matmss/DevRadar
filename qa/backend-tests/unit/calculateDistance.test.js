const calculateDistance = require('../../../dev/backend/src/utils/calculateDistance');

describe('calculateDistance (Haversine)', () => {
  it('returns ~0 for identical coordinates', () => {
    const point = { latitude: -23.5505, longitude: -46.6333 };
    expect(calculateDistance(point, point)).toBeCloseTo(0, 2);
  });

  it('returns a plausible distance between São Paulo and Rio de Janeiro (~360km)', () => {
    const saoPaulo = { latitude: -23.5505, longitude: -46.6333 };
    const rio = { latitude: -22.9068, longitude: -43.1729 };
    const distance = calculateDistance(saoPaulo, rio);
    expect(distance).toBeGreaterThan(330);
    expect(distance).toBeLessThan(370);
  });

  it('is symmetric', () => {
    const a = { latitude: -23.5505, longitude: -46.6333 };
    const b = { latitude: -22.9068, longitude: -43.1729 };
    expect(calculateDistance(a, b)).toBeCloseTo(calculateDistance(b, a), 6);
  });
});
