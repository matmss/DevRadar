const Dev = require('../models/Dev');
const parseStringAsArray = require('../utils/parseStringAsArray');
const validateDevInput = require('../utils/validateDevInput');
const { GITHUB_USERNAME_COLLATION } = require('../utils/githubUsername');
const { findConnections, sendMessage } = require('../websocket')

// MongoDB duplicate-key error: the unique github_username index rejected an insert.
const DUPLICATE_KEY = 11000;

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
    const dev = await Dev.findOne({ github_username }).collation(GITHUB_USERNAME_COLLATION);
    if (!dev) throw err;
    return { dev, created: false };
  }
}

module.exports = {
    async index(req, res) {
      const devs = await Dev.find();

      return res.json(devs)
    },

    // Requires requireAuth (routes.js). The identity is the session token's GitHub login and the
    // name, avatar and bio come from the profile captured at sign-in (the token's `profile`
    // claim, a snapshot as of sign-in), so registration makes no GitHub API call. A body
    // `github_username` is ignored (auth spec Q9).
    async store(req, res) {
    const { errors, value } = validateDevInput(req.body);

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Invalid request', details: errors });
    }

    const { github_username, profile } = req.user;
    const { techs, latitude, longitude } = value;
    const techsArray = parseStringAsArray(techs);

    // An existing dev, including a legacy one created before sign-in existed with different
    // letter case, belongs to this login and is returned unchanged (US-8, Q5). github_username
    // itself comes from the upsert filter.
    const { dev, created } = await findOrCreateDev(github_username, {
      name: profile.name || github_username,
      avatar_url: profile.avatar_url,
      bio: profile.bio,
      techs: techsArray,
      location: {
        type: 'Point',
        coordinates: [longitude, latitude],
      },
    });

    // Only the request that created the dev announces it.
    if (created) {
      const sendSocketMessageTo = findConnections({
        latitude,
        longitude,
      }, techsArray,)

      sendMessage(sendSocketMessageTo, 'new-dev', dev);
    }

    return res.json(dev);
    }
};
