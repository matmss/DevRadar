// utils/githubId.js storedGithubId / isLegacyDoc / storedGithubIdForms: the one ownership rule for
// a STORED github_id, shared by services/devOwnership.js and the operator CLI (QA-PB-3, QA-PB-5);
// utils/githubUsername.js staleLoginFor: displaced placeholders (QA-PB-6).
const { Decimal128, Long, Int32, Double, ObjectId } = require('../../../dev/backend/node_modules/mongoose').mongo.BSON;
const { storedGithubId, isLegacyDoc, storedGithubIdForms } = require('../../../dev/backend/src/utils/githubId');
const { staleLoginFor, GITHUB_USERNAME_COLLATION } = require('../../../dev/backend/src/utils/githubUsername');

describe('storedGithubId: a stored value that carries a GitHub id is that account', () => {
  it.each([
    ['a number', 222],
    ['an Int32', new Int32(222)],
    ['a Double', new Double(222)],
    ['a Long', Long.fromNumber(222)],
    ['a Decimal128', Decimal128.fromString('222')],
    ['a Decimal128 with a zero fraction', Decimal128.fromString('222.000')],
    ['a Decimal128 in exponent form', Decimal128.fromString('2.22E+2')],
    ['the canonical string', '222'],
  ])('%s -> 222', (_case, value) => {
    expect(storedGithubId(value)).toBe(222);
    expect(isLegacyDoc({ github_id: value })).toBe(false);
  });

  it('keeps the largest safe id and refuses one past it', () => {
    expect(storedGithubId(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(storedGithubId(Long.fromString(String(Number.MAX_SAFE_INTEGER)))).toBe(Number.MAX_SAFE_INTEGER);
    expect(storedGithubId(Long.fromString('9007199254740993'))).toBeNull();
    expect(storedGithubId(Decimal128.fromString('9007199254740993'))).toBeNull();
    expect(storedGithubId('9007199254740993')).toBeNull();
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['""', ''],
    ['"not-a-number"', 'not-a-number'],
    ['"0222" (not canonical)', '0222'],
    ['" 222"', ' 222'],
    ['"222.0" (a string)', '222.0'],
    ['0', 0],
    ['-5', -5],
    ['2.5', 2.5],
    ['NaN', NaN],
    ['a Double 222.5', new Double(222.5)],
    ['a negative Long', Long.fromNumber(-222)],
    ['a Decimal128 222.5', Decimal128.fromString('222.5')],
    ['a Decimal128 -222', Decimal128.fromString('-222')],
    ['a Decimal128 NaN', Decimal128.fromString('NaN')],
    ['a Decimal128 0.000', Decimal128.fromString('0.000')],
    ['true', true],
    ['a document', { $numberInt: '222' }],
    ['an array', [222]],
    ['an ObjectId', new ObjectId()],
  ])('%s names no account: legacy', (_case, value) => {
    expect(storedGithubId(value)).toBeNull();
    expect(isLegacyDoc({ github_id: value })).toBe(true);
  });

  it('lists the forms a query must match, the plain number first', () => {
    expect(storedGithubIdForms(222)).toEqual([222, '222']);
  });
});

describe('staleLoginFor: displaced placeholders (QA-PB-6)', () => {
  const caseInsensitive = (text) => text.toLowerCase();

  it('keeps the ObjectId form unchanged', () => {
    expect(staleLoginFor(new ObjectId('6b038a80752b68e0dabed7dc'))).toBe('_stale_6b038a80752b68e0dabed7dc');
  });

  it('gives string _ids that differ only in letter case different placeholders, also case-insensitively', () => {
    const a = staleLoginFor('Legacy-1');
    const b = staleLoginFor('legacy-1');
    expect(caseInsensitive(a)).not.toBe(caseInsensitive(b));
    expect(GITHUB_USERNAME_COLLATION).toEqual({ locale: 'en', strength: 2 });
  });

  it('is printable ASCII for _ids with control or bidi characters, and tags other BSON types', () => {
    const controls = [0x0a, 0x1b, 0x00, 0x2028, 0x202e].map((code) => String.fromCodePoint(code)).join('');
    [staleLoginFor(`id${controls}`), staleLoginFor(42), staleLoginFor({ a: 1 })].forEach((login) => {
      expect(login).toMatch(/^_stale_[sx]_[0-9a-f]+$/);
    });
    expect(staleLoginFor(42)).not.toBe(staleLoginFor('42'));
  });

  it('never equals an ObjectId placeholder', () => {
    expect(staleLoginFor('6b038a80752b68e0dabed7dc')).not.toBe(staleLoginFor(new ObjectId('6b038a80752b68e0dabed7dc')));
  });
});
