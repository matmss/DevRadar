# DevRadar web client

React 18, built with [Vite](https://vite.dev/) and tested with [Vitest](https://vitest.dev/)
(jsdom + React Testing Library). GitHub sign-in, then your own profile (register, update,
delete) and the list of registered developers. See `dev/docs/00-architecture.md`, Web.

## Setup

```bash
cp .env.example .env   # VITE_API_URL, defaults to http://localhost:3333
npm ci
```

`VITE_API_URL` is inlined when the dev server starts or the build runs: restart `npm start`
after changing it. The backend must list the web origin in its `CORS_ORIGINS`: its default
allows `http://localhost:3000`, so open the app as `http://localhost:3000` (the server listens
on 127.0.0.1, which `localhost` reaches), or add `http://127.0.0.1:3000` to `CORS_ORIGINS` to
use the address the dev server prints.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Dev server on `http://127.0.0.1:3000` (loopback only; fails if the port is busy). |
| `npm run build` | Production build into `build/` (`public/` is copied as is). |
| `npm run preview` | Serves `build/` on `http://127.0.0.1:3000`, to check a build locally. |
| `npm test` | Unit tests (`src/**/*.test.{js,jsx}`). Watch mode in a terminal; one run when `CI` is set or with `npm test -- --run`. |

Configuration is in `vite.config.js` (dev/preview server, build output and browser target,
Vitest). Files that contain JSX use the `.jsx` extension.

## Deployment

The build is static files. GitHub sign-in returns to `<web origin>/auth/callback`, so the web
server must answer unknown paths with `index.html` (SPA fallback), e.g. nginx
`try_files $uri /index.html`, Netlify `/* /index.html 200`, or `serve -s build`. The dev server
and `npm run preview` already do this.

Functional tests for this client live in `qa/web-tests/` (Playwright, real backend).
