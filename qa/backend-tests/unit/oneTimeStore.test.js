const { createOneTimeStore } = require('../../../dev/backend/src/utils/oneTimeStore');

describe('createOneTimeStore', () => {
  let clock;
  const now = () => clock;
  beforeEach(() => {
    clock = 1_000_000;
  });

  it('issues a random URL-safe key and returns its payload once', () => {
    const store = createOneTimeStore({ ttlMs: 1000, now });
    const key = store.issue({ redirect: 'http://localhost:3000/' });

    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.consume(key)).toEqual({ redirect: 'http://localhost:3000/' });
    expect(store.consume(key)).toBeNull();
  });

  it('issues a different key every time', () => {
    const store = createOneTimeStore({ ttlMs: 1000, now });
    const keys = new Set(Array.from({ length: 100 }, () => store.issue({})));
    expect(keys.size).toBe(100);
  });

  it('expires keys at the TTL boundary', () => {
    const store = createOneTimeStore({ ttlMs: 1000, now });
    const fresh = store.issue('fresh');
    const stale = store.issue('stale');

    clock += 999;
    expect(store.consume(fresh)).toBe('fresh');
    clock += 1;
    expect(store.consume(stale)).toBeNull();
  });

  it('an expired key stays unusable even if consumed again', () => {
    const store = createOneTimeStore({ ttlMs: 1000, now });
    const key = store.issue('x');
    clock += 5000;
    expect(store.consume(key)).toBeNull();
    clock -= 5000;
    expect(store.consume(key)).toBeNull();
  });

  it.each([undefined, null, '', 42, ['key'], { key: 'x' }])('rejects non-string or unknown key %p', (key) => {
    const store = createOneTimeStore({ ttlMs: 1000, now });
    store.issue('x');
    expect(store.consume(key)).toBeNull();
  });

  it('sweeps expired entries when issuing', () => {
    const store = createOneTimeStore({ ttlMs: 1000, now });
    store.issue('a');
    store.issue('b');
    clock += 1000;
    store.issue('c');
    expect(store.size()).toBe(1);
  });

  it('evicts the oldest entries beyond maxEntries', () => {
    const store = createOneTimeStore({ ttlMs: 60_000, maxEntries: 2, now });
    const first = store.issue('first');
    const second = store.issue('second');
    const third = store.issue('third');

    expect(store.size()).toBe(2);
    expect(store.consume(first)).toBeNull();
    expect(store.consume(second)).toBe('second');
    expect(store.consume(third)).toBe('third');
  });

  it('reads the clock at call time by default', () => {
    const realNow = Date.now;
    try {
      const store = createOneTimeStore({ ttlMs: 1000 });
      const key = store.issue('x');
      const issuedAt = realNow();
      Date.now = () => issuedAt + 2000;
      expect(store.consume(key)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });
});
