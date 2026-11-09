// Keeps every web scenario off GitHub's real servers ("only GitHub is faked"), and proves it.
// Installed for every scenario by step_definitions/network.hooks.js:
//  - avatars.githubusercontent.com (fixture and seed avatar URLs) is answered with a local 1x1
//    PNG through context.route;
//  - every browser request to github.com, *.github.com, githubusercontent.com or
//    *.githubusercontent.com is recorded, and any that was not answered by one of these local
//    fakes counts as unexpected. That includes requests Playwright cannot route, such as a
//    navigation that a redirect leads to (how the first sign-in attempt reached the real
//    github.com login page before the authorize fake was moved to /auth/github).
// GitHub's server-side OAuth API is faked separately, with nock in support/backend-server.js.

const AVATAR_HOST = 'avatars.githubusercontent.com';
const GITHUB_DOMAINS = ['github.com', 'githubusercontent.com'];

// 1x1 transparent PNG.
const AVATAR_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

// Per browser context (one per scenario).
const githubRequests = new WeakMap();
const fakedRequests = new WeakMap();

/** @param {string} url @returns {boolean} */
function isGithubUrl(url) {
  const { hostname } = new URL(url);
  return GITHUB_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

/**
 * @param {import('@playwright/test').BrowserContext} context
 * @returns {Promise<void>}
 */
async function installGithubNetworkGuard(context) {
  if (githubRequests.has(context)) return;
  githubRequests.set(context, []);
  fakedRequests.set(context, new Set());

  context.on('request', (request) => {
    if (isGithubUrl(request.url())) githubRequests.get(context).push(request);
  });

  await context.route((url) => url.hostname === AVATAR_HOST, async (route) => {
    fakedRequests.get(context).add(route.request());
    await route.fulfill({ status: 200, contentType: 'image/png', body: AVATAR_PNG });
  });
}

/**
 * @param {import('@playwright/test').BrowserContext} context
 * @returns {string[]} URLs of GitHub requests the browser sent that no local fake answered
 */
function unexpectedGithubRequests(context) {
  const faked = fakedRequests.get(context) || new Set();
  return (githubRequests.get(context) || [])
    .filter((request) => !faked.has(request))
    .map((request) => request.url());
}

module.exports = { installGithubNetworkGuard, unexpectedGithubRequests, AVATAR_HOST };
