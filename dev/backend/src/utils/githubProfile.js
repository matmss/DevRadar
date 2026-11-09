// The public GitHub profile captured at sign-in (from the authenticated GET /user response) and
// carried in the session token as the `profile` claim. POST /devs builds a new dev from it, so
// registration never calls the unauthenticated GET /users/:username API.
//
// It is a snapshot as of sign-in: a name, avatar or bio changed on GitHub afterwards is only
// picked up by the next sign-in. Values are sanitized and length-limited before signing, so the
// token stays small and every value is safe to store and render.

// GitHub's own limits are 255 (name) and 160 (bio); these are upper bounds, not expectations.
const MAX_NAME_LENGTH = 255;
const MAX_BIO_LENGTH = 300;
const MAX_AVATAR_URL_LENGTH = 512;

// C0/C1 control characters, plus line/paragraph separators and bidi overrides/isolates, which
// can reorder or hide surrounding text when rendered. Built from code points so the source
// file stays plain ASCII.
const UNSAFE_RANGES = [
  [0x0000, 0x001f], // C0 controls
  [0x007f, 0x009f], // DEL + C1 controls
  [0x2028, 0x2029], // line / paragraph separator
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2066, 0x2069], // bidi isolates
];
/** @param {number} codePoint @returns {string} a \uXXXX regex escape */
const regexEscape = (codePoint) => `\\u${codePoint.toString(16).padStart(4, '0')}`;
const UNSAFE_CHARACTERS = new RegExp(
  `[${UNSAFE_RANGES.map(([from, to]) => `${regexEscape(from)}-${regexEscape(to)}`).join('')}]`,
  'g'
);

/**
 * @typedef {{ name: string | null, avatar_url: string | null, bio: string | null }} GithubProfile
 */

/**
 * Collapses unsafe characters to spaces, trims, and truncates to `maxLength` code points (never
 * splitting a surrogate pair).
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string | null} null if `value` is not a string or nothing is left
 */
function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(UNSAFE_CHARACTERS, ' ').trim();
  if (cleaned === '') return null;
  const codePoints = Array.from(cleaned);
  return codePoints.length > maxLength ? codePoints.slice(0, maxLength).join('').trimEnd() : cleaned;
}

/**
 * @param {unknown} value
 * @returns {string | null} the URL if it is an absolute https URL without credentials, else null
 */
function cleanAvatarUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_AVATAR_URL_LENGTH || !URL.canParse(value)) return null;
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
    name: cleanText(source.name, MAX_NAME_LENGTH),
    avatar_url: cleanAvatarUrl(source.avatar_url),
    bio: cleanText(source.bio, MAX_BIO_LENGTH),
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
  MAX_BIO_LENGTH,
  MAX_AVATAR_URL_LENGTH,
  sanitizeGithubProfile,
  isSanitizedGithubProfile,
};
