const { Router } = require('express');

const DevController = require('./controllers/DevController');
const SearchController = require('./controllers/SearchController');
const AuthController = require('./controllers/AuthController');
const { requireAuth } = require('./middleware/auth');
const { authRateLimiter } = require('./middleware/rateLimit');

const routes = Router();

routes.get('/devs', DevController.index);
routes.post('/devs', DevController.store);

routes.get('/search', SearchController.index);

// GitHub sign-in (dev/docs/03-auth-spec.md). Public and rate limited. Slice 1: /auth/me is the
// only route that requires a session token; /devs and /search are not protected yet.
routes.use('/auth', authRateLimiter);
routes.get('/auth/github', AuthController.start);
routes.get('/auth/github/callback', AuthController.callback);
routes.post('/auth/token', AuthController.token);
routes.get('/auth/me', requireAuth, AuthController.me);

module.exports = routes;
