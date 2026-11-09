// Plain decimal only: rejects hex ("0x10"), exponents ("1e1") and other forms Number() accepts.
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

const parseStringAsArray = require('./parseStringAsArray');
const { isValidGithubUsername } = require('./githubUsername');

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
 * Validates the body of POST /devs.
 * @param {Record<string, unknown>} body
 * @returns {{ errors: string[], value: { github_username: string, techs: string, latitude: number, longitude: number } }}
 */
function validateDevInput(body = {}) {
  const errors = [];
  const { github_username, techs } = body;

  const username = typeof github_username === 'string' ? github_username.trim() : '';
  if (!username) {
    errors.push('github_username is required');
  } else if (!isValidGithubUsername(username)) {
    errors.push('github_username is not a valid GitHub username');
  }

  if (typeof techs !== 'string' || parseStringAsArray(techs).length === 0) {
    errors.push('techs is required (comma-separated string)');
  }

  const latitude = toCoordinate(body.latitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    errors.push('latitude must be a number between -90 and 90');
  }

  const longitude = toCoordinate(body.longitude);
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    errors.push('longitude must be a number between -180 and 180');
  }

  return { errors, value: { github_username: username, techs, latitude, longitude } };
}

module.exports = validateDevInput;
