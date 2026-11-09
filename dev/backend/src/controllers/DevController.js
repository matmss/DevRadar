const Dev = require('../models/Dev');
const parseStringAsArray = require('../utils/parseStringAsArray');
const validateDevInput = require('../utils/validateDevInput');
const { findConnections, sendMessage } = require('../websocket')

// GitHub usernames are case-insensitive, so "Gaearon" and "gaearon" are the same developer.
const CASE_INSENSITIVE = { locale: 'en', strength: 2 };

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

    // An existing profile, including a legacy one created before sign-in existed with
    // different letter case, belongs to this login and is returned unchanged (US-8, Q5).
    let dev = await Dev.findOne({ github_username }).collation(CASE_INSENSITIVE);

    if (!dev) {
      const techsArray = parseStringAsArray(techs);

      const location = {
        type: 'Point',
        coordinates: [longitude, latitude],
      }

      dev = await Dev.create({
        github_username,
        name: profile.name || github_username,
        avatar_url: profile.avatar_url,
        bio: profile.bio,
        techs: techsArray,
        location,
      })

      const sendSocketMessageTo = findConnections({
        latitude,
        longitude,
      }, techsArray,)

      sendMessage(sendSocketMessageTo, 'new-dev', dev);

    }

    return res.json(dev);
    }
};
