// utils/githubId.js: GitHub's numeric account id, what a profile belongs to (auth spec Q10), and
// its form as the session token's subject.
const {
  isValidGithubId,
  githubIdToSubject,
  githubIdFromSubject,
} = require('../../../dev/backend/src/utils/githubId');

describe('isValidGithubId', () => {
  it.each([1, 810438, Number.MAX_SAFE_INTEGER])('accepts %p', (value) => {
    expect(isValidGithubId(value)).toBe(true);
  });

  it.each([undefined, null, 0, -1, 1.5, '810438', Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, true, {}, []])(
    'rejects %p',
    (value) => {
      expect(isValidGithubId(value)).toBe(false);
    }
  );
});

describe('subject round trip', () => {
  it.each([1, 810438, Number.MAX_SAFE_INTEGER])('%p survives as a decimal string', (value) => {
    expect(githubIdToSubject(value)).toBe(String(value));
    expect(githubIdFromSubject(githubIdToSubject(value))).toBe(value);
  });

  it.each([
    undefined, null, 810438, '', 'gaearon', '0', '-1', '+1', '0810438', '8e5', '810438.0', ' 810438', '810438 ',
    '0x10', '9007199254740992', '99999999999999999',
  ])('rejects subject %p', (subject) => {
    expect(githubIdFromSubject(subject)).toBeNull();
  });
});
