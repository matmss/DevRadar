// dev/backend/src/utils/validateDevInput.js: caps on the techs list, shared by POST /devs and
// PUT /devs/me (QA-AUTH5 hardening 2: every change is pushed to each matching socket).
const validateDevInput = require('../../../dev/backend/src/utils/validateDevInput');

const { MAX_TECHS, MAX_TECH_LENGTH } = validateDevInput;
const position = { latitude: '-23.5505', longitude: '-46.6333' };
const techsList = (count, make = (i) => `Tech${i}`) => Array.from({ length: count }, (_, i) => make(i)).join(',');

describe('validateDevInput techs caps', () => {
  it('allows 30 technologies of 50 characters', () => {
    expect(MAX_TECHS).toBe(30);
    expect(MAX_TECH_LENGTH).toBe(50);
    const techs = techsList(30, (i) => `${String(i).padStart(2, '0')}${'x'.repeat(48)}`);
    expect(validateDevInput({ techs, ...position }).errors).toEqual([]);
  });

  it('rejects 31 technologies with a message that says the limit', () => {
    const { errors } = validateDevInput({ techs: techsList(31), ...position });
    expect(errors).toEqual(['techs must list at most 30 technologies (got 31)']);
  });

  it('counts after parsing: empty entries and surrounding spaces do not count', () => {
    const techs = `${techsList(30)},,, , ,`;
    expect(validateDevInput({ techs, ...position }).errors).toEqual([]);
    expect(validateDevInput({ techs: ` ${'x'.repeat(50)} `, ...position }).errors).toEqual([]);
  });

  it('rejects a technology longer than 50 characters', () => {
    const { errors } = validateDevInput({ techs: `ReactJS,${'x'.repeat(51)}`, ...position });
    expect(errors).toEqual(['each tech must be at most 50 characters']);
  });

  it('counts characters, not UTF-16 units (50 emoji are allowed)', () => {
    const emoji = String.fromCodePoint(0x1f680);
    expect(validateDevInput({ techs: emoji.repeat(50), ...position }).errors).toEqual([]);
    expect(validateDevInput({ techs: emoji.repeat(51), ...position }).errors).toHaveLength(1);
  });

  it('reports both caps at once, with the other field errors', () => {
    const techs = techsList(31, () => 'y'.repeat(60));
    const { errors } = validateDevInput({ techs, latitude: '91', longitude: '0' });
    expect(errors).toEqual([
      'techs must list at most 30 technologies (got 31)',
      'each tech must be at most 50 characters',
      'latitude must be a number between -90 and 90',
    ]);
  });
});
