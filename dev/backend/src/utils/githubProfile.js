// The public GitHub profile captured at sign-in (from the authenticated GET /user response) and
// carried in the session token as the `profile` claim. POST /devs builds a new dev from it, so
// registration never calls the unauthenticated GET /users/:username API.
//
// It is a snapshot as of sign-in: a name, avatar or bio changed on GitHub afterwards is only
// picked up by the next sign-in. Values are sanitized and length-limited before signing, so every
// value is safe to store and render, and the whole token stays well under 2048 bytes (the
// expo-secure-store value limit the mobile app depends on, auth slice 4).

// Limits in code points (what a person sees) and in bytes of the value's JSON encoding in UTF-8
// (what the token carries: multi-byte characters and JSON escapes such as \" cost more).
// GitHub's own limits are 255 characters for the name and 160 for the bio.
const MAX_NAME_LENGTH = 100;
const MAX_NAME_BYTES = 200;
const MAX_BIO_LENGTH = 160;
const MAX_BIO_BYTES = 400;
const MAX_AVATAR_URL_BYTES = 300;

// Characters replaced by a space: C0/C1 controls, line/paragraph separators, and every Unicode
// Bidi_Control character (marks, embeddings, overrides, isolates), which can reorder or hide the
// surrounding text when rendered. Built from code points so the source file stays plain ASCII.
const UNSAFE_RANGES = [
  [0x0000, 0x001f], // C0 controls
  [0x007f, 0x009f], // DEL + C1 controls
  [0x061c, 0x061c], // ARABIC LETTER MARK
  [0x200e, 0x200f], // LEFT-TO-RIGHT / RIGHT-TO-LEFT MARK
  [0x2028, 0x2029], // line / paragraph separator
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2066, 0x2069], // bidi isolates
];
/** @param {number} codePoint @returns {string} a regex escape for the code point */
const regexEscape = (codePoint) => `\\u${codePoint.toString(16).padStart(4, '0')}`;
const UNSAFE_CHARACTERS = new RegExp(
  `[${UNSAFE_RANGES.map(([from, to]) => `${regexEscape(from)}-${regexEscape(to)}`).join('')}]`,
  'g'
);

// A value is kept only if it has at least one character that is not whitespace, a format or
// default-ignorable character (zero-width space/joiners, word joiner, ...), a control, or a
// combining mark on its own. Zero-width joiners inside visible text (emoji sequences) are kept.
const VISIBLE_CHARACTER = /[^\s\p{Cc}\p{Cf}\p{M}\p{Default_Ignorable_Code_Point}]/u;

/**
 * @typedef {{ name: string | null, avatar_url: string | null, bio: string | null }} GithubProfile
 */

/**
 * @param {string} value
 * @returns {number} bytes of the value inside a JSON string, in UTF-8 (without the quotes)
 */
function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8') - 2;
}

/**
 * Keeps the longest prefix within both limits, never splitting a surrogate pair.
 * @param {string} value
 * @param {number} maxLength - code points
 * @param {number} maxBytes - JSON-encoded UTF-8 bytes
 * @returns {string}
 */
function truncate(value, maxLength, maxBytes) {
  let kept = '';
  let length = 0;
  let bytes = 0;
  for (const character of value) {
    const cost = jsonBytes(character);
    if (length + 1 > maxLength || bytes + cost > maxBytes) break;
    kept += character;
    length += 1;
    bytes += cost;
  }
  return kept;
}

/**
 * Replaces unsafe characters with spaces, trims, truncates, and drops values with nothing visible.
 * @param {unknown} value
 * @param {number} maxLength - code points
 * @param {number} maxBytes - JSON-encoded UTF-8 bytes
 * @returns {string | null} null if `value` is not a string or nothing visible is left
 */
function cleanText(value, maxLength, maxBytes) {
  if (typeof value !== 'string') return null;
  const cleaned = truncate(value.replace(UNSAFE_CHARACTERS, ' ').trim(), maxLength, maxBytes).trimEnd();
  return VISIBLE_CHARACTER.test(cleaned) ? cleaned : null;
}

/**
 * @param {unknown} value
 * @returns {string | null} the URL if it is an absolute https URL without credentials, else null
 */
function cleanAvatarUrl(value) {
  if (typeof value !== 'string' || jsonBytes(value) > MAX_AVATAR_URL_BYTES || !URL.canParse(value)) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return value;
}

/**
 * Builds the profile to sign into the session token from GitHub's GET /user response.
 * @param {{ name?: unknown, avatar_url?: unknown, bio?: unknown } | null | undefined} raw
 * @returns {GithubProfile}
 */
function sanitizeGithubProfile(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    name: cleanText(source.name, MAX_NAME_LENGTH, MAX_NAME_BYTES),
    avatar_url: cleanAvatarUrl(source.avatar_url),
    bio: cleanText(source.bio, MAX_BIO_LENGTH, MAX_BIO_BYTES),
  };
}

/**
 * True if `claim` is exactly what sanitizeGithubProfile produces: the three keys, each null or
 * an already-clean value. Used when verifying a token, so a profile claim that did not come from
 * signSessionToken is rejected rather than trusted.
 * @param {unknown} claim
 * @returns {boolean}
 */
function isSanitizedGithubProfile(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return false;
  const keys = Object.keys(claim).sort();
  if (keys.join(',') !== 'avatar_url,bio,name') return false;
  const clean = sanitizeGithubProfile(claim);
  return clean.name === claim.name && clean.avatar_url === claim.avatar_url && clean.bio === claim.bio;
}

module.exports = {
  MAX_NAME_LENGTH,
  MAX_NAME_BYTES,
  MAX_BIO_LENGTH,
  MAX_BIO_BYTES,
  MAX_AVATAR_URL_BYTES,
  sanitizeGithubProfile,
  isSanitizedGithubProfile,
};
