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
after changing it. Open the URL the dev server prints, `http://127.0.0.1:3000`: the backend's
default `CORS_ORIGINS` (and its sign-in redirect allow-list) includes it. Avoid
`http://localhost:3000`: on macOS another server listening on the wildcard `::` port 3000 can
run next to Vite (which only warns; `strictPort` fails only against another 127.0.0.1:3000
holder) and answers `localhost`, which browsers try as `::1` first. A deployed web origin must
be added to the backend's `CORS_ORIGINS`.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Dev server on `http://127.0.0.1:3000` (loopback only; fails if another process holds 127.0.0.1:3000). |
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
