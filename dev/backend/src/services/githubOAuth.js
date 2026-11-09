// GitHub OAuth web flow calls, the backend's only calls to GitHub (registration uses the
// profile captured here, see utils/githubProfile.js). Failures map to an HTTP status + message:
// 503 for rate limits, 502 otherwise.
// Never log request bodies, axios configs or responses here: they contain the client secret
// and access tokens. Log `err.message` only.
const axios = require('axios');
const { githubClientId, githubClientSecret, githubCallbackUrl } = require('../config/auth');
const { isValidGithubUsername } = require('../utils/githubUsername');
const { sanitizeGithubProfile } = require('../utils/githubProfile');

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const REQUEST_TIMEOUT_MS = 10000;
const ERROR_CODE_PATTERN = /^[a-z_]{1,64}$/;

/**
 * @typedef {{ status: number, error: string, details: string[] }} GithubFailure
 */

/**
 * GitHub signals rate limiting with 429, or 403 + x-ratelimit-remaining: 0.
 * @param {{ status?: number, headers?: Record<string, string> } | undefined} response
 * @returns {boolean}
 */
function isRateLimited(response) {
  if (!response) return false;
  return response.status === 429
    || (response.status === 403 && Boolean(response.headers) && response.headers['x-ratelimit-remaining'] === '0');
}

/**
 * @param {unknown} code - an OAuth error code from GitHub
 * @returns {string} the code if it looks like one, else "unknown_error" (never echo arbitrary input)
 */
function safeErrorCode(code) {
  return typeof code === 'string' && ERROR_CODE_PATTERN.test(code) ? code : 'unknown_error';
}

/**
 * @param {Error & { response?: object }} err - an axios error
 * @param {string} what - description of the failed call, for logs and details
 * @returns {GithubFailure}
 */
function mapAxiosError(err, what) {
  if (isRateLimited(err.response)) {
    return { status: 503, error: 'GitHub API rate limit reached, try again later', details: [what] };
  }
  console.error(`GitHub ${what} failed:`, err.message);
  return { status: 502, error: 'Could not complete GitHub sign-in, try again later', details: [what] };
}

/**
 * @param {string} state - the single-use OAuth state for this attempt
 * @returns {string} GitHub's authorize URL. No `scope`: public profile only (Q8).
 */
function buildAuthorizeUrl(state) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', githubClientId());
  url.searchParams.set('redirect_uri', githubCallbackUrl());
  url.searchParams.set('state', state);
  return url.toString();
}

/**
 * Exchanges an authorization code for a GitHub access token.
 * @param {string} code
 * @returns {Promise<{ accessToken: string } | GithubFailure>}
 */
async function exchangeCodeForToken(code) {
  let response;
  try {
    response = await axios.post(ACCESS_TOKEN_URL, {
      client_id: githubClientId(),
      client_secret: githubClientSecret(),
      code,
      redirect_uri: githubCallbackUrl(),
    }, {
      headers: { Accept: 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
    });
  } catch (err) {
    if (!err.isAxiosError) throw err;
    return mapAxiosError(err, 'token exchange');
  }

  // GitHub answers 200 with { error, error_description } for bad codes or credentials.
  const body = response.data || {};
  if (body.error || typeof body.access_token !== 'string' || body.access_token === '') {
    const errorCode = safeErrorCode(body.error);
    console.error(`GitHub token exchange rejected: ${errorCode}`);
    return {
      status: 502,
      error: 'GitHub rejected the sign-in, try signing in again',
      details: [`token exchange: ${errorCode}`],
    };
  }
  return { accessToken: body.access_token };
}

/**
 * Reads the signed-in user's public profile with their access token. The profile is sanitized
 * and length-limited (utils/githubProfile.js); it becomes the session token's `profile` claim.
 * @param {string} accessToken
 * @returns {Promise<{ user: { login: string, profile: import('../utils/githubProfile').GithubProfile } } | GithubFailure>}
 */
async function fetchAuthenticatedUser(accessToken) {
  let response;
  try {
    response = await axios.get(USER_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });
  } catch (err) {
    if (!err.isAxiosError) throw err;
    return mapAxiosError(err, 'user lookup');
  }

  const data = response.data || {};
  if (!isValidGithubUsername(data.login)) {
    console.error('GitHub user lookup returned no valid login');
    return { status: 502, error: 'Could not complete GitHub sign-in, try again later', details: ['user lookup'] };
  }
  return { user: { login: data.login, profile: sanitizeGithubProfile(data) } };
}

module.exports = {
  AUTHORIZE_URL,
  ACCESS_TOKEN_URL,
  USER_URL,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchAuthenticatedUser,
  safeErrorCode,
};
