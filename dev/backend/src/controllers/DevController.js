const Dev = require('../models/Dev');
const parseStringAsArray = require('../utils/parseStringAsArray');
const validateDevInput = require('../utils/validateDevInput');
const { EVENT, announce, announceStored } = require('../services/devEvents');
const {
  OWNERSHIP,
  isDuplicateKey,
  resolveOwnDev,
  loginFields,
  refreshLogin,
  updateOwnDev,
  inAccountOrder,
  pendingWrites,
} = require('../services/devOwnership');

// POST /devs gives up after this many lost races in a row (another dev took the login, or the
// account's own dev appeared, between our read and our insert). See services/devOwnership.js.
const MAX_REGISTRATION_ATTEMPTS = 3;

/**
 * @param {import('express').Response} res
 * @returns {import('express').Response} 404 for a signed-in user who has no dev profile
 */
function sendDevNotFound(res) {
  return res.status(404).json({
    error: 'Developer not found',
    code: 'dev_not_found',
    details: ['You have no developer profile yet; register with POST /devs'],
  });
}

/**
 * 409 for POST /devs when another account's dev still holds the signed-in login (rule 3 in
 * services/devOwnership.js). Signing in displaces such a dev when GitHub's answer is newer than
 * that dev's login, so this means the other dev's login was confirmed by GitHub after this
 * session read it: signing in again settles it. Names only the login, which is the caller's own;
 * nothing about the other dev is revealed.
 * @param {import('express').Response} res
 * @param {string} github_username
 * @returns {import('express').Response}
 */
function sendUsernameConflict(res, github_username) {
  return res.status(409).json({
    error: 'Another DevRadar profile uses this GitHub login',
    code: 'github_username_conflict',
    details: [
      `Another GitHub account's DevRadar profile shows the login "${github_username}", confirmed by GitHub `
      + 'after this session signed in. Sign in again: if GitHub gives you this login now, that profile is released.',
    ],
  });
}

/**
 * @param {import('express').Response} res
 * @param {string[]} errors
 * @returns {import('express').Response} the same 400 as POST /devs (BUG-003/005)
 */
function sendInvalidInput(res, errors) {
  return res.status(400).json({ error: 'Invalid request', details: errors });
}

/**
 * The name, avatar and bio a dev gets from the profile captured at sign-in (the session token's
 * `profile` claim, already sanitized by utils/githubProfile.js). A missing name falls back to
 * the login.
 * @param {string} github_username
 * @param {import('../utils/githubProfile').GithubProfile} profile
 * @returns {{ name: string, avatar_url: string | null, bio: string | null }}
 */
function profileFields(github_username, profile) {
  return {
    name: profile.name || github_username,
    avatar_url: profile.avatar_url,
    bio: profile.bio,
  };
}

/**
 * @param {number} latitude
 * @param {number} longitude
 * @returns {{ type: 'Point', coordinates: [number, number] }} GeoJSON (longitude first)
 */
function point(latitude, longitude) {
  return { type: 'Point', coordinates: [longitude, latitude] };
}

/**
 * Creates the account's dev, atomically: an upsert on github_id, so it can never create a second
 * dev for the account.
 * @param {{ github_id: number, github_username: string, login_read_at: number }} user
 * @param {object} fields - everything else the new dev stores
 * @returns {Promise<{ dev: object, created: boolean }>}
 */
async function createOwnDev(user, fields) {
  const result = await Dev.findOneAndUpdate(
    { github_id: user.github_id },
    { $setOnInsert: { ...loginFields(user), ...fields } },
    { upsert: true, returnDocument: 'after', includeResultMetadata: true }
  );
  const created = Boolean(result.lastErrorObject && result.lastErrorObject.upserted);
  return { dev: result.value, created };
}

// Every handler requires requireAuth (routes.js). The identity is always the session token's
// GitHub account (req.user: github_id, and the login as of sign-in); a github_username, github_id,
// _id, name, avatar_url or bio in the body is ignored (auth spec Q9). Which dev is the user's is
// decided by services/devOwnership.js (by github_id; legacy devs by login, claimed on the first
// write). The /devs/me routes take no username or id, so nobody can touch another user's dev.
module.exports = {
    async index(req, res) {
      const devs = await Dev.find();

      return res.json(devs)
    },

    // The name, avatar and bio come from the profile captured at sign-in (the token's `profile`
    // claim, a snapshot as of sign-in), so registration makes no GitHub API call.
    async store(req, res) {
    const { errors, value } = validateDevInput(req.body);

    if (errors.length > 0) {
      return sendInvalidInput(res, errors);
    }

    const { user } = req;
    const { techs, latitude, longitude } = value;
    const techsArray = parseStringAsArray(techs);

    const outcome = await inAccountOrder(user, async () => {
      for (let attempt = 0; attempt < MAX_REGISTRATION_ATTEMPTS; attempt += 1) {
        const ownership = await resolveOwnDev(user, { claim: true });

        if (ownership.status === OWNERSHIP.CONFLICT) return { conflict: true };

        if (ownership.status !== OWNERSHIP.NONE) {
          // Already registered (or a legacy dev just claimed, US-8): returned as it is, except
          // that its login follows the account's current one (Q10). A rename is announced.
          const { dev, renamed } = await refreshLogin(ownership.dev, user);
          if (!dev) continue; // deleted meanwhile: register anew
          if (renamed) announceStored(EVENT.DEV_UPDATED, dev);
          return { dev };
        }

        try {
          const result = await createOwnDev(user, {
            ...profileFields(user.github_username, user.profile),
            techs: techsArray,
            location: point(latitude, longitude),
          });
          // Only the request that created the dev announces it.
          if (result.created) announce(EVENT.NEW_DEV, { latitude, longitude }, techsArray, result.dev);
          return { dev: result.dev };
        } catch (err) {
          // Another dev took the login (or this account's dev appeared) since we looked: look
          // again, which answers the existing dev or the conflict.
          if (!isDuplicateKey(err)) throw err;
        }
      }
      throw new Error('Could not register the developer: too many concurrent changes');
    });

    if (outcome.conflict) return sendUsernameConflict(res, user.github_username);
    return res.json(outcome.dev);
    },

    // GET /devs/me: the signed-in user's dev, or 404 dev_not_found. Lets a client tell
    // "register" from "update" without scanning GET /devs. A read: a legacy dev is found by login
    // but not claimed, and nothing is written.
    async show(req, res) {
      const { dev } = await resolveOwnDev(req.user, { claim: false });
      if (!dev) return sendDevNotFound(res);
      return res.json(dev);
    },

    // PUT /devs/me (US-4, BUG-008). A full update of what the user edits: techs, latitude and
    // longitude are all required, with POST /devs's validation and 400. Name, avatar and bio are
    // refreshed from the token's sign-in profile (so signing in again and saving picks up GitHub
    // changes), and so is the login (Q10). Never creates a dev: one deleted meanwhile stays
    // deleted and the answer is 404.
    async update(req, res) {
      const { errors, value } = validateDevInput(req.body);
      if (errors.length > 0) {
        return sendInvalidInput(res, errors);
      }

      const { user } = req;
      const { techs, latitude, longitude } = value;
      const techsArray = parseStringAsArray(techs);

      const dev = await inAccountOrder(user, async () => {
        const { dev: own } = await resolveOwnDev(user, { claim: true });
        if (!own) return null;

        const updated = await updateOwnDev(own, user, {
          ...profileFields(user.github_username, user.profile),
          techs: techsArray,
          location: point(latitude, longitude),
        });

        // Q4: to the subscribers the dev matches NOW (new position and techs). A subscriber that
        // only matched the old ones gets nothing and keeps the old marker until it searches again.
        if (updated) announce(EVENT.DEV_UPDATED, { latitude, longitude }, techsArray, updated);
        return updated;
      });
      if (!dev) return sendDevNotFound(res);

      return res.json(dev);
    },

    // DELETE /devs/me (US-4, Q7): hard delete, 204. No profile is a 404 dev_not_found, like
    // PUT and GET /devs/me (a repeated DELETE, e.g. a double click, gets 404; clients treat it
    // as "already gone"). The user can register again with POST /devs.
    async destroy(req, res) {
      const { user } = req;
      const dev = await inAccountOrder(user, async () => {
        const { dev: own } = await resolveOwnDev(user, { claim: true });
        if (!own) return null;

        const deleted = await Dev.findOneAndDelete({ _id: own._id, github_id: user.github_id });

        // Subscribers that could show the dev (its last position and techs) remove the marker.
        // Only the ids and the login: nothing else about a deleted profile is sent.
        if (deleted) {
          announceStored(EVENT.DEV_DELETED, deleted, {
            _id: deleted._id,
            github_id: deleted.github_id,
            github_username: deleted.github_username,
          });
        }
        return deleted;
      });
      if (!dev) return sendDevNotFound(res);

      return res.status(204).end();
    },
};

module.exports.EVENT = EVENT;
// For tests: accounts with a write queued or running (idle accounts are dropped).
module.exports.pendingWrites = pendingWrites;
