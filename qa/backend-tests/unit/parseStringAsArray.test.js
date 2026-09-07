const parseStringAsArray = require('../../../dev/backend/src/utils/parseStringAsArray');

describe('parseStringAsArray', () => {
  it('splits a comma-separated string and trims whitespace', () => {
    expect(parseStringAsArray('ReactJS, Node.js,  Redux')).toEqual(['ReactJS', 'Node.js', 'Redux']);
  });

  it('handles a single value with no commas', () => {
    expect(parseStringAsArray('ReactJS')).toEqual(['ReactJS']);
  });

  // @edge — documents current behavior; an empty string produces [''] rather than [],
  // which is arguably a defect worth raising with the team (see docs/05-bug-tracker.md).
  it('returns an array with one empty string for an empty input (documents current behavior)', () => {
    expect(parseStringAsArray('')).toEqual(['']);
  });
});
