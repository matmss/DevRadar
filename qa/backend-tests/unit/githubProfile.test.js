const {
  sanitizeGithubProfile,
  isSanitizedGithubProfile,
  MAX_NAME_LENGTH,
  MAX_NAME_BYTES,
  MAX_BIO_LENGTH,
  MAX_BIO_BYTES,
} = require('../../../dev/backend/src/utils/githubProfile');

// Special characters are built from code points so this file stays plain ASCII.
const ch = (codePoint) => String.fromCodePoint(codePoint);
const BELL = ch(0x07);
const NEWLINE = ch(0x0a);
const C1_CONTROL = ch(0x85);
const LINE_SEPARATOR = ch(0x2028);
const RIGHT_TO_LEFT_OVERRIDE = ch(0x202e);
const FIRST_STRONG_ISOLATE = ch(0x2068);
const EMOJI = ch(0x1f600); // a surrogate pair in UTF-16

const AVATAR = 'https://avatars.githubusercontent.com/u/810438?v=4';

describe('sanitizeGithubProfile', () => {
  it('keeps a normal profile as is, and drops every other field', () => {
    const profile = sanitizeGithubProfile({
      login: 'gaearon',
      name: 'Dan Abramov',
      avatar_url: AVATAR,
      bio: 'Working on React',
      email: 'dan@example.com',
      access_token: 'gho_secret',
    });
    expect(profile).toEqual({ name: 'Dan Abramov', avatar_url: AVATAR, bio: 'Working on React' });
  });

  it.each([undefined, null, 'gaearon', 42])('gives an all-null profile for %p', (raw) => {
    expect(sanitizeGithubProfile(raw)).toEqual({ name: null, avatar_url: null, bio: null });
  });

  it.each([
    ['null', null],
    ['non-string', 42],
    ['empty', ''],
    ['whitespace only', '   '],
    ['control characters only', `${BELL}${NEWLINE}`],
  ])('maps a %s name or bio to null', (_label, value) => {
    expect(sanitizeGithubProfile({ name: value, bio: value })).toMatchObject({ name: null, bio: null });
  });

  it('replaces control, separator and bidi characters with spaces, then trims', () => {
    const name = `${BELL}Dan${NEWLINE}${RIGHT_TO_LEFT_OVERRIDE}Abramov${C1_CONTROL}${LINE_SEPARATOR}${FIRST_STRONG_ISOLATE}`;
    expect(sanitizeGithubProfile({ name }).name).toBe('Dan  Abramov');
    expect(sanitizeGithubProfile({ bio: `line one${NEWLINE}line two` }).bio).toBe('line one line two');
  });

  it('keeps non-ASCII text that is not a control character', () => {
    const name = `Jos${ch(0xe9)} ${EMOJI}`;
    expect(sanitizeGithubProfile({ name }).name).toBe(name);
  });

  it('truncates name and bio by code point', () => {
    const { name, bio } = sanitizeGithubProfile({ name: 'n'.repeat(1000), bio: 'b'.repeat(1000) });
    expect(name).toHaveLength(MAX_NAME_LENGTH);
    expect(bio).toHaveLength(MAX_BIO_LENGTH);
    expect([MAX_NAME_LENGTH, MAX_BIO_LENGTH]).toEqual([100, 160]);
  });

  it('also caps the JSON-encoded UTF-8 bytes, never splitting a surrogate pair', () => {
    const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8') - 2;
    // 4 UTF-8 bytes per emoji, so the byte cap binds before the code-point cap.
    const { name, bio } = sanitizeGithubProfile({ name: EMOJI.repeat(1000), bio: EMOJI.repeat(1000) });
    expect(jsonBytes(name)).toBe(MAX_NAME_BYTES);
    expect(Array.from(name)).toHaveLength(MAX_NAME_BYTES / 4);
    expect(Array.from(name).every((c) => c === EMOJI)).toBe(true);
    expect(jsonBytes(bio)).toBe(MAX_BIO_BYTES);
    expect(Array.from(bio)).toHaveLength(MAX_BIO_BYTES / 4);
    // JSON escapes count too: a quote costs 2 bytes.
    const quotes = sanitizeGithubProfile({ name: '"'.repeat(1000) }).name;
    expect(jsonBytes(quotes)).toBeLessThanOrEqual(MAX_NAME_BYTES);
  });

  it('does not end a truncated value with a space', () => {
    const bio = sanitizeGithubProfile({ bio: `${'b'.repeat(MAX_BIO_LENGTH - 1)} tail` }).bio;
    expect(bio).toBe('b'.repeat(MAX_BIO_LENGTH - 1));
  });

  it.each([
    ['javascript URL', 'javascript:alert(1)'],
    ['data URL', 'data:image/png;base64,AAAA'],
    ['plain http', 'http://avatars.githubusercontent.com/u/1'],
    ['credentials', 'https://user:pass@avatars.githubusercontent.com/u/1'],
    ['relative', '/u/1'],
    ['not a URL', 'not a url'],
    ['non-string', 42],
    ['too long', `https://avatars.githubusercontent.com/${'a'.repeat(600)}`],
  ])('drops an avatar_url that is a %s', (_label, avatar_url) => {
    expect(sanitizeGithubProfile({ avatar_url }).avatar_url).toBeNull();
  });
});

describe('isSanitizedGithubProfile', () => {
  it('accepts exactly what sanitizeGithubProfile produces', () => {
    expect(isSanitizedGithubProfile(sanitizeGithubProfile({ name: 'Dan', avatar_url: AVATAR, bio: null }))).toBe(true);
    expect(isSanitizedGithubProfile(sanitizeGithubProfile(null))).toBe(true);
    expect(isSanitizedGithubProfile(sanitizeGithubProfile({ bio: 'b'.repeat(5000) }))).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['array', []],
    ['string', 'Dan'],
    ['missing keys', { name: 'Dan' }],
    ['extra key', { name: 'Dan', avatar_url: null, bio: null, email: 'x' }],
    ['untrimmed name', { name: ' Dan ', avatar_url: null, bio: null }],
    ['control character', { name: `Dan${BELL}`, avatar_url: null, bio: null }],
    ['unsafe avatar', { name: null, avatar_url: 'javascript:alert(1)', bio: null }],
    ['too-long bio', { name: null, avatar_url: null, bio: 'b'.repeat(MAX_BIO_LENGTH + 1) }],
    ['empty string instead of null', { name: '', avatar_url: null, bio: null }],
  ])('rejects %s', (_label, claim) => {
    expect(isSanitizedGithubProfile(claim)).toBe(false);
  });
});
