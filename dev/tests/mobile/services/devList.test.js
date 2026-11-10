// src/services/devList.js: how live pushes change the map's list without a new search.
const { isSameDev, isRenderableDev, upsertDev, removeDev } = require('../../../mobile/src/services/devList');

/** @param {string} id @param {string} login @param {object} [extra] */
function dev(id, login, extra = {}) {
  return {
    _id: id,
    github_username: login,
    name: login,
    techs: ['ReactJS'],
    location: { type: 'Point', coordinates: [-46.6333, -23.5505] },
    ...extra,
  };
}

describe('devList', () => {
  describe('isSameDev', () => {
    it('matches by _id', () => {
      expect(isSameDev({ _id: 'a1' }, { _id: 'a1' })).toBe(true);
      expect(isSameDev({ _id: 'a1' }, { _id: 'b2' })).toBe(false);
    });

    it('matches by github_username in any letter case', () => {
      expect(isSameDev({ _id: 'a1', github_username: 'Gaearon' }, { _id: 'b2', github_username: 'gaearon' })).toBe(true);
    });

    it('never matches on a missing username', () => {
      expect(isSameDev({ _id: 'a1' }, { _id: 'b2' })).toBe(false);
      expect(isSameDev({ github_username: '' }, { github_username: '' })).toBe(false);
    });
  });

  describe('isRenderableDev', () => {
    it.each([
      ['null', null],
      ['no _id', { ...dev('x', 'x'), _id: undefined }],
      ['no location', { ...dev('x', 'x'), location: undefined }],
      ['one coordinate', dev('x', 'x', { location: { coordinates: [1] } })],
      ['a non-numeric coordinate', dev('x', 'x', { location: { coordinates: ['1', 2] } })],
      ['no techs', { ...dev('x', 'x'), techs: undefined }],
    ])('rejects a dev with %s', (_, value) => {
      expect(isRenderableDev(value)).toBe(false);
    });

    it('accepts a full dev', () => {
      expect(isRenderableDev(dev('a1', 'gaearon'))).toBe(true);
    });
  });

  describe('upsertDev', () => {
    const list = [dev('a1', 'alice'), dev('g1', 'gaearon'), dev('b1', 'bob')];

    it('replaces the dev in place, keeping its position in the list', () => {
      const moved = dev('g1', 'gaearon', { techs: ['Elixir'], location: { type: 'Point', coordinates: [-43.17, -22.9] } });
      const next = upsertDev(list, moved);
      expect(next.map(item => item._id)).toEqual(['a1', 'g1', 'b1']);
      expect(next[1]).toBe(moved);
      expect(list[1].techs).toEqual(['ReactJS']); // not mutated
    });

    it('replaces an entry with the same login in another letter case and another _id', () => {
      const next = upsertDev(list, dev('g2', 'GAEARON', { techs: ['Go'] }));
      expect(next.map(item => item._id)).toEqual(['a1', 'g2', 'b1']);
    });

    it('adds a dev that is not on the map yet', () => {
      const next = upsertDev(list, dev('c1', 'carol'));
      expect(next.map(item => item._id)).toEqual(['a1', 'g1', 'b1', 'c1']);
    });

    it('drops duplicates of the dev', () => {
      const next = upsertDev([dev('g1', 'gaearon'), dev('g0', 'Gaearon')], dev('g1', 'gaearon', { techs: ['Go'] }));
      expect(next).toHaveLength(1);
      expect(next[0].techs).toEqual(['Go']);
    });

    it('ignores a malformed push', () => {
      expect(upsertDev(list, { _id: 'g1', github_username: 'gaearon' })).toBe(list);
      expect(upsertDev(list, null)).toBe(list);
    });
  });

  describe('removeDev', () => {
    const list = [dev('a1', 'alice'), dev('g1', 'gaearon')];

    it('removes the dev by _id', () => {
      expect(removeDev(list, { _id: 'g1', github_username: 'someone-else' }).map(item => item._id)).toEqual(['a1']);
    });

    it('removes the dev by login in any letter case', () => {
      expect(removeDev(list, { _id: 'zz', github_username: 'GAEARON' }).map(item => item._id)).toEqual(['a1']);
    });

    it('returns the same list when nothing matches or the push is malformed', () => {
      expect(removeDev(list, { _id: 'zz', github_username: 'nobody' })).toBe(list);
      expect(removeDev(list, null)).toBe(list);
    });
  });
});
