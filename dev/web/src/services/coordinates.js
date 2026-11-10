// Writes a stored coordinate back into a form field (QA-AUTH5-2).
//
// String(number) uses exponent notation below 1e-6 (String(1e-7) === "1e-7"), which the backend
// rejects on purpose: validateDevInput accepts plain decimals only (BUG-003/005). This returns the
// same value as a plain decimal ("0.0000001"), using the digits JavaScript already chose for the
// shortest round-trip representation, so Number(result) === value.

const EXPONENT_FORM = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/;

/**
 * @param {number} value - a finite number, e.g. a latitude from GET /devs/me
 * @returns {string} a plain decimal without exponent, e.g. "0.0000001", "-12.5", "0"
 */
export function formatCoordinate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const text = String(value);
  const match = EXPONENT_FORM.exec(text);
  if (!match) return text;

  const [, sign, firstDigit, fraction = '', exponentText] = match;
  const digits = firstDigit + fraction;
  const exponent = Number(exponentText);
  if (exponent < 0) return `${sign}0.${'0'.repeat(-exponent - 1)}${digits}`;

  const integerLength = exponent + 1;
  if (digits.length <= integerLength) return `${sign}${digits}${'0'.repeat(integerLength - digits.length)}`;
  return `${sign}${digits.slice(0, integerLength)}.${digits.slice(integerLength)}`;
}
