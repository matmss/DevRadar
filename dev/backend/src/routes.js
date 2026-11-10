const { Router } = require('express');

const DevController = require('./controllers/DevController');
const SearchController = require('./controllers/SearchController');
const AuthController = require('./controllers/AuthController');
const { requireAuth } = require('./middleware/auth');
const { signInRateLimiter, sessionRateLimiter } = require('./middleware/rateLimit');

const routes = Router();

// Everything that shows or changes devs needs a session token (dev/docs/03-auth-spec.md, Q1 and
// the access matrix). Registration uses the signed-in GitHub login (US-3). The Socket.io
// subscription is authenticated at handshake in websocket.js.
routes.get('/devs', requireAuth, DevController.index);
routes.post('/devs', requireAuth, DevController.store);

// The signed-in user's own dev (US-4, BUG-008): the dev is the token's login, so these take no
// username or id and cannot reach anyone else's profile. No profile: 404 dev_not_found.
// Registered before any future `/devs/:param` route so "me" can never be read as an id.
routes.get('/devs/me', requireAuth, DevController.show);
routes.put('/devs/me', requireAuth, DevController.update);
routes.delete('/devs/me', requireAuth, DevController.destroy);

routes.get('/search', requireAuth, SearchController.index);

// GitHub sign-in (dev/docs/03-auth-spec.md). Public (the only public routes) and rate limited.
routes.get('/auth/github', signInRateLimiter, AuthController.start);
routes.get('/auth/github/callback', signInRateLimiter, AuthController.callback);
routes.post('/auth/token', signInRateLimiter, AuthController.token);
routes.get('/auth/me', sessionRateLimiter, requireAuth, AuthController.me);

module.exports = routes;
