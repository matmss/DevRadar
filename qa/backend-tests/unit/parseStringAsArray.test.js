const parseStringAsArray = require('../../../dev/backend/src/utils/parseStringAsArray');

describe('parseStringAsArray', () => {
  it('splits a comma-separated string and trims whitespace', () => {
    expect(parseStringAsArray('ReactJS, Node.js,  Redux')).toEqual(['ReactJS', 'Node.js', 'Redux']);
  });

  it('handles a single value with no commas', () => {
    expect(parseStringAsArray('ReactJS')).toEqual(['ReactJS']);
  });

  it('returns an empty array for an empty input', () => {
    expect(parseStringAsArray('')).toEqual([]);
  });

  it('drops empty and whitespace-only entries', () => {
    expect(parseStringAsArray('ReactJS,, ,Redux,')).toEqual(['ReactJS', 'Redux']);
  });
});
