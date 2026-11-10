// Plain decimal only: rejects hex ("0x10"), exponents ("1e1") and other forms Number() accepts.
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

const parseStringAsArray = require('./parseStringAsArray');

// Caps on the techs list (QA-AUTH5 hardening 2). Every change of a dev is pushed to each matching
// socket, so an unbounded list multiplied the bytes the backend broadcasts (9,001 techs x 100
// updates = 7.2 MB to one subscriber in QA's review). Counted after parsing (trimmed, empty
// entries dropped); lengths in code points.
const MAX_TECHS = 30;
const MAX_TECH_LENGTH = 50;

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
 * Validates the body of POST /devs and PUT /devs/me (all three fields required in both). The
 * developer's identity comes from the session token (req.user), so a `github_username` in the
 * body is ignored, not validated (auth spec Q9).
 * @param {Record<string, unknown>} body
 * @returns {{ errors: string[], value: { techs: string, latitude: number, longitude: number } }}
 */
function validateDevInput(body) {
  const source = body && typeof body === 'object' ? body : {};
  const errors = [];
  const { techs } = source;

  const techsArray = typeof techs === 'string' ? parseStringAsArray(techs) : [];
  if (techsArray.length === 0) {
    errors.push('techs is required (comma-separated string)');
  } else {
    if (techsArray.length > MAX_TECHS) {
      errors.push(`techs must list at most ${MAX_TECHS} technologies (got ${techsArray.length})`);
    }
    if (techsArray.some((tech) => Array.from(tech).length > MAX_TECH_LENGTH)) {
      errors.push(`each tech must be at most ${MAX_TECH_LENGTH} characters`);
    }
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
module.exports.MAX_TECHS = MAX_TECHS;
module.exports.MAX_TECH_LENGTH = MAX_TECH_LENGTH;
