import { isSameDev, upsertDev, removeDev } from './devList';

const ALICE = { _id: 'a1', github_id: 501, github_username: 'alice', techs: ['Go'] };

describe('isSameDev', () => {
  it('matches the same _id', () => {
    expect(isSameDev(ALICE, { _id: 'a1' })).toBe(true);
  });

  it('matches the same GitHub account under a new _id (deleted and registered again)', () => {
    expect(isSameDev(ALICE, { _id: 'a2', github_id: 501, github_username: 'alice' })).toBe(true);
  });

  it('matches the same GitHub account after a rename', () => {
    expect(isSameDev(ALICE, { _id: 'a2', github_id: 501, github_username: 'alice2' })).toBe(true);
  });

  // Auth spec Q10: account 501 renamed away from "alice", account 502 took the login.
  it('does not match two GitHub accounts that show the same login', () => {
    expect(isSameDev(ALICE, { _id: 'b1', github_id: 502, github_username: 'alice' })).toBe(false);
    expect(isSameDev(ALICE, { _id: 'b1', github_id: 502, github_username: 'ALICE' })).toBe(false);
  });

  it('falls back to the login in any letter case when a dev has no GitHub id (legacy profile)', () => {
    const legacy = { _id: 'l1', github_username: 'ALICE' };
    expect(isSameDev(legacy, { _id: 'a2', github_id: 501, github_username: 'alice' })).toBe(true);
    expect(isSameDev({ _id: 'a2', github_id: 501, github_username: 'alice' }, legacy)).toBe(true);
    expect(isSameDev(legacy, { _id: 'x', github_username: 'bob' })).toBe(false);
  });

  it('matches nothing without an _id, a GitHub id or a login', () => {
    expect(isSameDev({}, {})).toBe(false);
    expect(isSameDev({ _id: 'a1' }, { _id: 'a2' })).toBe(false);
  });
});

describe('upsertDev', () => {
  const BOB = { _id: 'b1', github_id: 502, github_username: 'bob' };

  it('replaces the entry in place, matched by GitHub account', () => {
    const saved = { _id: 'a2', github_id: 501, github_username: 'alice2', techs: ['Elixir'] };
    expect(upsertDev([ALICE, BOB], saved)).toEqual([saved, BOB]);
  });

  it('appends another account that shows the same login instead of replacing it', () => {
    const other = { _id: 'c1', github_id: 503, github_username: 'alice' };
    expect(upsertDev([ALICE, BOB], other)).toEqual([ALICE, BOB, other]);
  });

  it('replaces a claimed legacy entry (same _id, now with a GitHub id) and drops duplicates', () => {
    const legacy = { _id: 'l1', github_username: 'GAEARON' };
    const claimed = { _id: 'l1', github_id: 810438, github_username: 'gaearon' };
    expect(upsertDev([legacy, BOB, { _id: 'l2', github_username: 'gaearon' }], claimed)).toEqual([claimed, BOB]);
  });
});

describe('removeDev', () => {
  it('removes the entry by _id or GitHub account, not another account with the same login', () => {
    const other = { _id: 'c1', github_id: 503, github_username: 'alice' };
    expect(removeDev([ALICE, other], { _id: 'zz', github_id: 501, github_username: 'alice' })).toEqual([other]);
  });
});
