// Plain decimal only: rejects hex ("0x10"), exponents ("1e1") and other forms Number() accepts.
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

const parseStringAsArray = require('./parseStringAsArray');

/**
 * Parses a coordinate that may arrive as a number or a numeric string.
 * @param {unknown} raw
 * @returns {number} the parsed value, or NaN if it is missing or not numeric
 */
function toCoordinate(raw) {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && DECIMAL_PATTERN.test(raw.trim())) return Number(raw);
  return NaN;
}

/**
 * Validates the body of POST /devs. The developer's identity comes from the session token
 * (req.user), so a `github_username` in the body is ignored, not validated (auth spec Q9).
 * @param {Record<string, unknown>} body
 * @returns {{ errors: string[], value: { techs: string, latitude: number, longitude: number } }}
 */
function validateDevInput(body) {
  const source = body && typeof body === 'object' ? body : {};
  const errors = [];
  const { techs } = source;

  if (typeof techs !== 'string' || parseStringAsArray(techs).length === 0) {
    errors.push('techs is required (comma-separated string)');
  }

  const latitude = toCoordinate(source.latitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    errors.push('latitude must be a number between -90 and 90');
  }

  const longitude = toCoordinate(source.longitude);
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    errors.push('longitude must be a number between -180 and 180');
  }

  return { errors, value: { techs, latitude, longitude } };
}

module.exports = validateDevInput;
