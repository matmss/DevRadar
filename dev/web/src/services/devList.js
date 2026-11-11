// The dev list shown by App.js, updated in place after a save or delete.
//
// Two entries are the same dev if they have the same _id; otherwise, if both carry a GitHub
// account id (`github_id`, auth slice 6), if those are equal; otherwise (a legacy profile has no
// github_id yet) if they have the same github_username in any letter case. The id comes before
// the login because logins can be renamed and then taken by another account (auth spec Q10): two
// devs of different accounts that show the same login are different devs. A profile deleted and
// registered again has a new _id but the same github_id.

/**
 * @typedef {{ _id?: string, github_id?: number, github_username?: string }} DevIdentity
 */

/**
 * @param {DevIdentity} a
 * @param {DevIdentity} b
 * @returns {boolean}
 */
function isSameDev(a, b) {
  if (a._id && b._id && a._id === b._id) return true;
  if (a.github_id != null && b.github_id != null) return a.github_id === b.github_id;
  return typeof a.github_username === 'string' && typeof b.github_username === 'string'
    && a.github_username.toLowerCase() === b.github_username.toLowerCase();
}

/**
 * The list with `dev` in place of its entry (and without other entries for the same dev), or
 * appended if it is not there.
 * @param {object[]} devs
 * @param {object} dev
 * @returns {object[]}
 */
function upsertDev(devs, dev) {
  let replaced = false;
  const next = [];
  devs.forEach(item => {
    if (!isSameDev(item, dev)) next.push(item);
    else if (!replaced) {
      next.push(dev);
      replaced = true;
    }
  });
  if (!replaced) next.push(dev);
  return next;
}

/**
 * The list without the dev.
 * @param {object[]} devs
 * @param {DevIdentity} dev
 * @returns {object[]}
 */
function removeDev(devs, dev) {
  return devs.filter(item => !isSameDev(item, dev));
}

export { isSameDev, upsertDev, removeDev };
