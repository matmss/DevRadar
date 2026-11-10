const Dev = require('../models/Dev');
const parseStringAsArray = require('../utils/parseStringAsArray');
const validateDevInput = require('../utils/validateDevInput');
const { GITHUB_USERNAME_COLLATION } = require('../utils/githubUsername');
const { createKeyedQueue } = require('../utils/keyedQueue');
const { findConnections, sendMessage } = require('../websocket')

// MongoDB duplicate-key error: the unique github_username index rejected an insert.
const DUPLICATE_KEY = 11000;

// Socket.io events pushed to nearby, tech-matching subscribers (websocket.js findConnections).
const EVENT = Object.freeze({
  NEW_DEV: 'new-dev',
  DEV_UPDATED: 'dev-updated',
  DEV_DELETED: 'dev-deleted',
});

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
 * The signed-in user's dev, matched case-insensitively (a legacy profile in another letter case
 * belongs to the same GitHub login, US-8 / Q5).
 * @param {string} github_username
 * @returns {Promise<object | null>}
 */
function findOwnDev(github_username) {
  return Dev.findOne({ github_username }).collation(GITHUB_USERNAME_COLLATION);
}

/**
 * Creates the dev for `github_username` unless one exists (case-insensitively), atomically.
 * Concurrent calls for the same login (double click, retry, two tabs) end with one dev: the
 * upsert matches an existing dev, and if two inserts still race, the unique index rejects the
 * second one, which then reads the winner.
 * @param {string} github_username
 * @param {object} newDev - the fields to store if the dev is created
 * @returns {Promise<{ dev: object, created: boolean }>}
 */
async function findOrCreateDev(github_username, newDev) {
  try {
    const result = await Dev.findOneAndUpdate(
      { github_username },
      { $setOnInsert: newDev },
      {
        upsert: true,
        returnDocument: 'after',
        collation: GITHUB_USERNAME_COLLATION,
        includeResultMetadata: true,
      }
    );
    const created = Boolean(result.lastErrorObject && result.lastErrorObject.upserted);
    return { dev: result.value, created };
  } catch (err) {
    if (!err || err.code !== DUPLICATE_KEY) throw err;
    const dev = await findOwnDev(github_username);
    if (!dev) throw err;
    return { dev, created: false };
  }
}

/**
 * Pushes `event` to the connected sockets whose subscription (position and techs) matches a dev
 * at `latitude`/`longitude` with `techs` (same isNearby + techs rule as GET /search).
 * @param {string} event
 * @param {{ latitude: number, longitude: number }} position
 * @param {string[]} techs
 * @param {object} payload
 */
function announce(event, position, techs, payload) {
  sendMessage(findConnections(position, techs), event, payload);
}

// Writes for one login (POST /devs, PUT and DELETE /devs/me) run one at a time, each with its
// announcement, so the live events reach subscribers in the same order as the database changes
// (utils/keyedQueue.js). Keyed case-insensitively, like the unique index.
const writesByLogin = createKeyedQueue();

/**
 * @template T
 * @param {string} github_username
 * @param {() => Promise<T>} task - the database write and its announcement
 * @returns {Promise<T>}
 */
function inLoginOrder(github_username, task) {
  return writesByLogin.run(github_username.toLowerCase(), task);
}

// Every handler requires requireAuth (routes.js). The identity is always the session token's
// GitHub login (req.user); a github_username, _id, name, avatar_url or bio in the body is ignored
// (auth spec Q9). The /devs/me routes take no username, so nobody can touch another user's dev.
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

    const { github_username, profile } = req.user;
    const { techs, latitude, longitude } = value;
    const techsArray = parseStringAsArray(techs);

    const dev = await inLoginOrder(github_username, async () => {
      // An existing dev, including a legacy one created before sign-in existed with different
      // letter case, belongs to this login and is returned unchanged (US-8, Q5).
      // github_username itself comes from the upsert filter.
      const result = await findOrCreateDev(github_username, {
        ...profileFields(github_username, profile),
        techs: techsArray,
        location: point(latitude, longitude),
      });

      // Only the request that created the dev announces it.
      if (result.created) {
        announce(EVENT.NEW_DEV, { latitude, longitude }, techsArray, result.dev);
      }
      return result.dev;
    });

    return res.json(dev);
    },

    // GET /devs/me: the signed-in user's dev, or 404 dev_not_found. Lets a client tell
    // "register" from "update" without scanning GET /devs.
    async show(req, res) {
      const dev = await findOwnDev(req.user.github_username);
      if (!dev) return sendDevNotFound(res);
      return res.json(dev);
    },

    // PUT /devs/me (US-4, BUG-008). A full update of what the user edits: techs, latitude and
    // longitude are all required, with POST /devs's validation and 400. Name, avatar and bio are
    // refreshed from the token's sign-in profile (so signing in again and saving picks up GitHub
    // changes); github_username keeps its stored letter case. One atomic findOneAndUpdate without
    // upsert: a dev deleted meanwhile stays deleted and the answer is 404.
    async update(req, res) {
      const { errors, value } = validateDevInput(req.body);
      if (errors.length > 0) {
        return sendInvalidInput(res, errors);
      }

      const { github_username, profile } = req.user;
      const { techs, latitude, longitude } = value;
      const techsArray = parseStringAsArray(techs);

      const dev = await inLoginOrder(github_username, async () => {
        const updated = await Dev.findOneAndUpdate(
          { github_username },
          {
            $set: {
              ...profileFields(github_username, profile),
              techs: techsArray,
              location: point(latitude, longitude),
            },
          },
          { returnDocument: 'after', collation: GITHUB_USERNAME_COLLATION, runValidators: true }
        );

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
      const { github_username } = req.user;
      const dev = await inLoginOrder(github_username, async () => {
        const deleted = await Dev.findOneAndDelete({ github_username }, { collation: GITHUB_USERNAME_COLLATION });

        // Subscribers that could show the dev (its last position and techs) remove the marker.
        // Only the id and login: nothing else about a deleted profile is sent. A malformed
        // legacy record without a position or techs cannot match any subscriber.
        const coordinates = deleted && deleted.location && deleted.location.coordinates;
        if (Array.isArray(coordinates) && coordinates.length === 2 && Array.isArray(deleted.techs)) {
          const [longitude, latitude] = coordinates;
          announce(EVENT.DEV_DELETED, { latitude, longitude }, deleted.techs, {
            _id: deleted._id,
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
module.exports.pendingWriteLogins = () => writesByLogin.size();
