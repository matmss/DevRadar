import { formatCoordinate } from './coordinates';

// The backend's own rule for coordinates in POST /devs and PUT /devs/me
// (dev/backend/src/utils/validateDevInput.js DECIMAL_PATTERN): plain decimals only.
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

describe('formatCoordinate (QA-AUTH5-2)', () => {
  it.each([
    [1e-7, '0.0000001'],
    [-1e-7, '-0.0000001'],
    [1.5e-7, '0.00000015'],
    [-2.345e-9, '-0.000000002345'],
    [5e-324, `0.${'0'.repeat(323)}5`],
  ])('writes the tiny value %p without exponent notation (%p)', (value, expected) => {
    expect(String(value)).toMatch(/e-/); // what the form used to show
    expect(formatCoordinate(value)).toBe(expected);
  });

  it.each([-23.5505, -46.6333, 0, -0, 90, -180, 0.000001, -0.5, 12.345678901234])(
    'keeps ordinary value %p as String() writes it',
    (value) => {
      expect(formatCoordinate(value)).toBe(String(value));
    }
  );

  it('writes large values without exponent notation too', () => {
    expect(formatCoordinate(1e21)).toBe('1000000000000000000000');
    expect(formatCoordinate(-1.25e22)).toBe('-12500000000000000000000');
  });

  it.each([1e-7, -1e-7, 1.5e-7, -2.345e-9, -23.5505, 0, 179.9999999, 1e21])(
    'gives the backend a plain decimal that is exactly the stored value (%p)',
    (value) => {
      const text = formatCoordinate(value);
      expect(text).toMatch(DECIMAL_PATTERN);
      expect(Number(text)).toBe(value);
    }
  );

  it.each([undefined, null, NaN, Infinity, '12'])('returns an empty field for %p', (value) => {
    expect(formatCoordinate(value)).toBe('');
  });
});
