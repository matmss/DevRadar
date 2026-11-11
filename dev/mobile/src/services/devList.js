// The map's list of devs, updated by live pushes (services/socket.js) without a new search:
//   new-dev, dev-updated  -> upsertDev: replace the dev's entry in place, or add it
//   dev-deleted           -> removeDev
// The backend only pushes to subscribers the dev matches (position and techs; for dev-updated,
// the NEW ones, auth spec Q4), so a pushed dev that is not on the map yet now belongs there.
// A dev is the same entry if it has the same _id; otherwise, if both carry a GitHub account id
// (`github_id`, auth slice 6), if those are equal; otherwise (a legacy profile has no github_id
// yet) if they have the same github_username in any letter case (GitHub logins are
// case-insensitive). The id comes before the login because a login can be renamed and then taken
// by another account (auth spec Q10). A dev deleted and registered again gets a new _id but keeps
// its github_id.

/**
 * @param {unknown} value
 * @returns {string | null} the GitHub login in lower case, or null
 */
function loginKey(value) {
  return typeof value === 'string' && value !== '' ? value.toLowerCase() : null;
}

/**
 * @param {unknown} value
 * @returns {boolean} true for a GitHub account id (a positive safe integer)
 */
function isGithubId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * @param {{ _id?: unknown, github_id?: unknown, github_username?: unknown }} a
 * @param {{ _id?: unknown, github_id?: unknown, github_username?: unknown }} b
 * @returns {boolean}
 */
function isSameDev(a, b) {
  if (a._id != null && b._id != null && String(a._id) === String(b._id)) return true;
  if (isGithubId(a.github_id) && isGithubId(b.github_id)) return a.github_id === b.github_id;
  const login = loginKey(a.github_username);
  return login !== null && login === loginKey(b.github_username);
}

/**
 * True if the dev can be drawn as a marker (Main.js reads these fields); a malformed push is
 * ignored instead of crashing the map.
 * @param {unknown} dev
 * @returns {boolean}
 */
function isRenderableDev(dev) {
  if (!dev || typeof dev !== 'object' || dev._id == null) return false;
  const coordinates = dev.location && dev.location.coordinates;
  return Array.isArray(coordinates)
    && coordinates.length === 2
    && coordinates.every(Number.isFinite)
    && Array.isArray(dev.techs);
}

/**
 * The list with `dev` in place of its current entry (same position, so the marker moves instead
 * of being re-created), or appended if it is not there. Duplicates of the dev are dropped.
 * @param {object[]} devs
 * @param {object} dev
 * @returns {object[]} a new array, or `devs` itself if `dev` is not renderable
 */
function upsertDev(devs, dev) {
  if (!isRenderableDev(dev)) return devs;
  let replaced = false;
  const next = [];
  devs.forEach((item) => {
    if (!isSameDev(item, dev)) {
      next.push(item);
    } else if (!replaced) {
      next.push(dev);
      replaced = true;
    }
  });
  if (!replaced) next.push(dev);
  return next;
}

/**
 * The list without the dev (matched like isSameDev: _id, then github_id, then github_username).
 * @param {object[]} devs
 * @param {{ _id?: unknown, github_id?: unknown, github_username?: unknown } | null | undefined} dev
 * @returns {object[]} a new array, or `devs` itself if nothing matched
 */
function removeDev(devs, dev) {
  if (!dev || typeof dev !== 'object') return devs;
  const next = devs.filter((item) => !isSameDev(item, dev));
  return next.length === devs.length ? devs : next;
}

export { isSameDev, isRenderableDev, upsertDev, removeDev };
