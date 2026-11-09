const { trustProxySetting } = require('../../../dev/backend/src/config/proxy');

describe('TRUST_PROXY', () => {
  const original = process.env.TRUST_PROXY;
  afterAll(() => {
    if (original === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = original;
  });

  it('is off by default', () => {
    delete process.env.TRUST_PROXY;
    expect(trustProxySetting()).toBe(false);
  });

  it.each([
    ['', false],
    ['  ', false],
    ['false', false],
    ['FALSE', false],
    ['true', true],
    [' True ', true],
    ['0', 0],
    ['1', 1],
    ['2', 2],
    ['loopback', ['loopback']],
    ['loopback, 10.0.0.0/8 ,, 192.168.1.1', ['loopback', '10.0.0.0/8', '192.168.1.1']],
  ])('parses %p', (raw, expected) => {
    expect(trustProxySetting(raw)).toEqual(expected);
  });

  it('reads process.env.TRUST_PROXY', () => {
    process.env.TRUST_PROXY = '1';
    expect(trustProxySetting()).toBe(1);
  });
});
