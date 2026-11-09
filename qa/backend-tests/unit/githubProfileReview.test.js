// QA review of auth slices 2 and 3, QA-AUTH2-2: gaps in the sign-in profile sanitizer
// (dev/backend/src/utils/githubProfile.js).
//
// DEV: "control, line-separator and bidi characters become spaces" and "a null name falls back
// to the login". UNSAFE_RANGES covers the bidi embeddings/overrides (U+202A-U+202E) and isolates
// (U+2066-U+2069) but not the other three Unicode Bidi_Control characters: U+061C ARABIC LETTER
// MARK, U+200E LEFT-TO-RIGHT MARK and U+200F RIGHT-TO-LEFT MARK, which also reorder neutral
// characters around them when rendered. And a GitHub name made only of invisible format
// characters survives trim() (which strips whitespace only), so it is stored and rendered as an
// invisible name instead of falling back to the login.
//
// Characters are built from code points so this file stays plain ASCII.
const { sanitizeGithubProfile } = require('../../../dev/backend/src/utils/githubProfile');

const ch = (codePoint) => String.fromCodePoint(codePoint);
const hex = (s) => Array.from(s).map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' ');

describe('sanitizeGithubProfile (QA review, QA-AUTH2-2)', () => {
  // Every character with the Unicode Bidi_Control property (PropList.txt).
  const BIDI_CONTROLS_NOT_COVERED = [
    ['U+061C ARABIC LETTER MARK', 0x061c],
    ['U+200E LEFT-TO-RIGHT MARK', 0x200e],
    ['U+200F RIGHT-TO-LEFT MARK', 0x200f],
  ];

  it.each(BIDI_CONTROLS_NOT_COVERED)('replaces %s with a space, like the other bidi controls', (_label, codePoint) => {
    const name = sanitizeGithubProfile({ name: `abc${ch(codePoint)}def` }).name;
    expect(hex(name)).toBe(hex('abc def'));
  });

  it.each([
    ['U+200F RIGHT-TO-LEFT MARK', [0x200f]],
    ['U+200B ZERO WIDTH SPACE', [0x200b]],
    ['U+2060 WORD JOINER', [0x2060]],
    ['zero-width space + joiner + non-joiner', [0x200b, 0x200d, 0x200c]],
  ])('maps a name made only of invisible %s to null, so the dev falls back to the login', (_label, codePoints) => {
    const name = sanitizeGithubProfile({ name: codePoints.map(ch).join('') }).name;
    expect(name === null ? null : hex(name)).toBeNull();
  });

  it('keeps zero-width joiners inside visible text (emoji sequences must not break)', () => {
    // Guard for the fix: a family emoji is MAN + ZWJ + WOMAN + ZWJ + GIRL.
    const family = [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467].map(ch).join('');
    expect(sanitizeGithubProfile({ name: `Dan ${family}` }).name).toBe(`Dan ${family}`);
  });
});
