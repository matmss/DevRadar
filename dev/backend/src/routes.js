const { Router } = require('express');

const DevController = require('./controllers/DevController');
const SearchController = require('./controllers/SearchController');
const AuthController = require('./controllers/AuthController');
const { requireAuth } = require('./middleware/auth');
const { signInRateLimiter, sessionRateLimiter } = require('./middleware/rateLimit');

const routes = Router();

// Registration needs a session token: the dev is the signed-in GitHub login (US-3). Reads
// (GET /devs, GET /search, the socket) stay public until slice 4 of dev/docs/03-auth-spec.md.
routes.get('/devs', DevController.index);
routes.post('/devs', requireAuth, DevController.store);

routes.get('/search', SearchController.index);

// GitHub sign-in (dev/docs/03-auth-spec.md). Public and rate limited.
routes.get('/auth/github', signInRateLimiter, AuthController.start);
routes.get('/auth/github/callback', signInRateLimiter, AuthController.callback);
routes.post('/auth/token', signInRateLimiter, AuthController.token);
routes.get('/auth/me', sessionRateLimiter, requireAuth, AuthController.me);

module.exports = routes;
