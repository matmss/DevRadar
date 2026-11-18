// utils/githubAvatarId.js: the GitHub user id inside a legacy dev's avatar_url, the owner hint of
// the operator tool (dev/docs/04-legacy-merge-spec.md AC-6, AC-6b) and of the planned claim guard
// (option B1). Strict on purpose: anything but GitHub's own avatar URL form carries no evidence.
const {
  AVATAR_ID_STATUS,
  parseGithubAvatarId,
  legacyAvatarEvidence,
} = require('../../../dev/backend/src/utils/githubAvatarId');

describe('parseGithubAvatarId: the spec table (AC-6)', () => {
  it.each([
    ['https://avatars.githubusercontent.com/u/810438?v=4', 810438],
    ['https://avatars0.githubusercontent.com/u/810438?v=3', 810438],
    ['https://avatars.githubusercontent.com/u/810438', 810438],
  ])('%s -> %p', (url, id) => {
    expect(parseGithubAvatarId(url)).toEqual({ status: 'parsed', id, host: new URL(url).hostname });
  });

  it.each([
    'https://avatars.githubusercontent.com/in/123?v=4',
    'https://secure.gravatar.com/avatar/0cc175b9c0f1b6a831c3',
    'https://avatars.githubusercontent.com/u/0?v=4',
    'https://avatars.githubusercontent.com/u/12x?v=4',
    'http://avatars.githubusercontent.com/u/810438?v=4',
    'https://avatars.githubusercontent.com.evil.example/u/1',
    'https://user:pw@avatars.githubusercontent.com/u/1',
    'https://example.com/avatar.png',
  ])('%s -> unparseable', (url) => {
    const result = parseGithubAvatarId(url);
    expect(result.status).toBe('unparseable');
    expect(result.id).toBeNull();
  });

  it.each([undefined, null, ''])('%p -> none', (value) => {
    expect(parseGithubAvatarId(value)).toEqual({ status: 'none', id: null, host: null });
  });
});

describe('parseGithubAvatarId: other forms', () => {
  it.each([
    ['https://avatars1.githubusercontent.com/u/1?v=4', 1],
    ['https://avatars2.githubusercontent.com/u/22?v=4', 22],
    ['https://avatars3.githubusercontent.com/u/333?v=3', 333],
    ['https://avatars.githubusercontent.com/u/810438?s=460&v=4', 810438],
    ['https://avatars.githubusercontent.com/u/810438?v=4&s=40', 810438],
    ['https://avatars.githubusercontent.com/u/9007199254740991', Number.MAX_SAFE_INTEGER],
  ])('%s -> %p', (url, id) => {
    expect(parseGithubAvatarId(url)).toMatchObject({ status: 'parsed', id });
  });

  it.each([
    ['another sharded host', 'https://avatars4.githubusercontent.com/u/1?v=4'],
    ['upper-case host', 'https://AVATARS.githubusercontent.com/u/1?v=4'],
    ['explicit port', 'https://avatars.githubusercontent.com:443/u/1?v=4'],
    ['trailing slash', 'https://avatars.githubusercontent.com/u/1/'],
    ['extra path', 'https://avatars.githubusercontent.com/u/1/x'],
    ['dot segment', 'https://avatars.githubusercontent.com/x/../u/1'],
    ['encoded digit', 'https://avatars.githubusercontent.com/u/%31'],
    ['fragment', 'https://avatars.githubusercontent.com/u/1#v=4'],
    ['unknown query parameter', 'https://avatars.githubusercontent.com/u/1?v=4&id=2'],
    ['empty query', 'https://avatars.githubusercontent.com/u/1?'],
    ['leading zero', 'https://avatars.githubusercontent.com/u/0810438?v=4'],
    ['negative', 'https://avatars.githubusercontent.com/u/-1?v=4'],
    ['above 2^53', 'https://avatars.githubusercontent.com/u/9007199254740992'],
    ['seventeen digits', 'https://avatars.githubusercontent.com/u/12345678901234567'],
    ['leading space', ' https://avatars.githubusercontent.com/u/1'],
    ['trailing newline', 'https://avatars.githubusercontent.com/u/1\n'],
    ['backslashes', 'https:\\\\avatars.githubusercontent.com\\u\\1'],
    ['protocol-relative', '//avatars.githubusercontent.com/u/1'],
    ['enterprise path', 'https://github.example.com/avatars/u/1'],
    ['javascript URL', 'javascript:alert(1)'],
    ['GitHub Apps id', 'https://avatars.githubusercontent.com/in/15368?v=4'],
    ['a word', ' x '],
    ['over 300 characters', `https://avatars.githubusercontent.com/u/1?v=4${'&s=1'.repeat(80)}`],
  ])('%s -> unparseable', (_case, url) => {
    expect(parseGithubAvatarId(url)).toMatchObject({ status: 'unparseable', id: null });
  });

  it.each([42, {}, [], true])('a non-string value %p -> unparseable', (value) => {
    expect(parseGithubAvatarId(value)).toEqual({ status: 'unparseable', id: null, host: null });
  });

  it('a blank string -> none', () => {
    expect(parseGithubAvatarId('   ')).toEqual({ status: 'none', id: null, host: null });
  });

  it('reports the host of an unparseable URL, never its credentials', () => {
    expect(parseGithubAvatarId('https://user:pw@avatars.githubusercontent.com/u/1').host)
      .toBe('avatars.githubusercontent.com');
    expect(parseGithubAvatarId('https://secure.gravatar.com/avatar/0cc175b9c0f1b6a831c3').host).toBe('secure.gravatar.com');
    expect(parseGithubAvatarId('not a url').host).toBeNull();
  });
});

describe('legacyAvatarEvidence (AC-6b)', () => {
  const avatar = 'https://avatars.githubusercontent.com/u/810438?v=4';

  it.each([
    ['no github_id field', {}],
    ['a null github_id', { github_id: null }],
  ])('parses the avatar of a legacy dev (%s)', (_case, fields) => {
    expect(legacyAvatarEvidence({ ...fields, avatar_url: avatar })).toMatchObject({ status: 'parsed', id: 810438 });
  });

  it.each([810438, 1, 0, -1])('never uses the avatar of a dev with github_id %p', (githubId) => {
    expect(legacyAvatarEvidence({ github_id: githubId, avatar_url: avatar }))
      .toEqual({ status: AVATAR_ID_STATUS.NOT_LEGACY, id: null, host: null });
  });
});
