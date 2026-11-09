const validateDevInput = require('../../../dev/backend/src/utils/validateDevInput');

const valid = { techs: 'ReactJS, Redux', latitude: '-23.5505', longitude: '-46.6333' };

describe('validateDevInput', () => {
  it('accepts a valid body and coerces coordinates to numbers', () => {
    const { errors, value } = validateDevInput(valid);
    expect(errors).toEqual([]);
    expect(value).toEqual({ techs: 'ReactJS, Redux', latitude: -23.5505, longitude: -46.6333 });
  });

  it('accepts numeric coordinates and boundary values', () => {
    expect(validateDevInput({ ...valid, latitude: 90, longitude: -180 }).errors).toEqual([]);
    expect(validateDevInput({ ...valid, latitude: 0, longitude: 0 }).errors).toEqual([]);
  });

  it.each(['+12.5', '-.5', '7.', ' 45 '])('accepts decimal string latitude %p', (latitude) => {
    expect(validateDevInput({ ...valid, latitude }).errors).toEqual([]);
  });

  it('rejects an empty body with one error per field', () => {
    expect(validateDevInput({}).errors).toHaveLength(3);
    expect(validateDevInput(undefined).errors).toHaveLength(3);
    expect(validateDevInput(null).errors).toHaveLength(3);
  });

  // The identity comes from the session token (auth spec Q9): a body github_username is
  // neither validated nor returned.
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['another user', 'bob'],
    ['non-string', 123],
    ['path traversal', '../orgs/x'],
    ['too long', 'a'.repeat(40)],
  ])('ignores github_username: %s', (_label, github_username) => {
    const { errors, value } = validateDevInput({ ...valid, github_username });
    expect(errors).toEqual([]);
    expect(value).not.toHaveProperty('github_username');
  });

  it.each([
    ['missing', undefined],
    ['non-string', ['ReactJS']],
    ['only commas/space', ' , ,'],
  ])('rejects techs: %s', (_label, techs) => {
    expect(validateDevInput({ ...valid, techs }).errors).toHaveLength(1);
  });

  it.each([
    ['missing', undefined],
    ['empty string', ''],
    ['non-numeric', 'abc'],
    ['NaN', NaN],
    ['hex string', '0x10'],
    ['exponent string', '1e1'],
    ['Infinity', Infinity],
    ['null', null],
    ['out of range', 90.0001],
    ['boolean', true],
  ])('rejects latitude: %s', (_label, latitude) => {
    expect(validateDevInput({ ...valid, latitude }).errors).toHaveLength(1);
  });

  it('rejects longitude out of range', () => {
    expect(validateDevInput({ ...valid, longitude: -180.5 }).errors).toHaveLength(1);
  });
});
