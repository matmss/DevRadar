const axios = require('axios');
const Dev = require('../models/Dev');
const parseStringAsArray = require('../utils/parseStringAsArray');
const validateDevInput = require('../utils/validateDevInput');
const { findConnections, sendMessage } = require('../websocket')

// GitHub usernames are case-insensitive, so "Gaearon" and "gaearon" are the same developer.
const CASE_INSENSITIVE = { locale: 'en', strength: 2 };

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
    const response = err.response;
    const status = response && response.status;
    if (status === 404) {
      return { status: 404, error: `GitHub user "${username}" not found` };
    }
    // GitHub signals rate limiting with 429, or 403 + x-ratelimit-remaining: 0. Other 403s
    // (e.g. abuse detection) are not rate limits and fall through to the generic 502.
    const rateLimited = status === 429
      || (status === 403 && response.headers && response.headers['x-ratelimit-remaining'] === '0');
    if (rateLimited) {
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

    let dev = await Dev.findOne({ github_username }).collation(CASE_INSENSITIVE);

    if (!dev) {

      const github = await fetchGithubUser(github_username);

      if (github.error) {
        return res.status(github.status).json({ error: github.error, details: [] });
      }

      const { login, avatar_url, bio } = github.data;
      const name = github.data.name || login;

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
