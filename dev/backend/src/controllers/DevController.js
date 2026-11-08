const axios = require('axios');
const Dev = require('../models/Dev');
const parseStringAsArray = require('../utils/parseStringAsArray');
const validateDevInput = require('../utils/validateDevInput');
const { findConnections, sendMessage } = require('../websocket')

/**
 * Fetches a GitHub user, mapping failures to an HTTP status + message for the client.
 * @param {string} username
 * @returns {Promise<{ data?: object, status?: number, error?: string }>}
 */
async function fetchGithubUser(username) {
  try {
    const { data } = await axios.get(`https://api.github.com/users/${username}`);
    return { data };
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 404) {
      return { status: 404, error: `GitHub user "${username}" not found` };
    }
    if (status === 403 || status === 429) {
      return { status: 503, error: 'GitHub API rate limit reached, try again later' };
    }
    console.error(`GitHub API request for "${username}" failed:`, err.message);
    return { status: 502, error: 'Could not reach the GitHub API, try again later' };
  }
}

module.exports = {
    async index(req, res) {
      const devs = await Dev.find();

      return res.json(devs)
    },

    async store(req, res) {
    const { errors, value } = validateDevInput(req.body);

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Invalid request', details: errors });
    }

    const { github_username, techs, latitude, longitude } = value;

    let dev = await Dev.findOne({ github_username });

    if (!dev) {

      const github = await fetchGithubUser(github_username);

      if (github.error) {
        return res.status(github.status).json({ error: github.error });
      }

      const { login, name = login, avatar_url, bio } = github.data;

      const techsArray = parseStringAsArray(techs);

      const location = {
        type: 'Point',
        coordinates: [longitude, latitude],
      }

      dev = await Dev.create({
        github_username,
        name,
        avatar_url,
        bio,
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
