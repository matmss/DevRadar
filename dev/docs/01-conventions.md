# DevRadar — Development Conventions

These apply to new code in `backend/`, `web/`, and `mobile/`. QA/test
conventions (BDD tagging, test data builders, mocking strategy) live in
`qa/docs/04-qa-process.md` and `qa/docs/06-framework-selection.md` — this
doc is for application code.

## A note on where these conventions differ from generic defaults

Two conventions commonly used as boilerplate don't fit this codebase, so
they're adapted rather than force-fit:

- **"Type hints on all function signatures"** — this is a plain JavaScript
  codebase (no TypeScript). The equivalent here is **JSDoc `@param`/
  `@returns` annotations** on exported functions, which VS Code and most
  editors will type-check against with zero build step. See example below.
- **"No ORM, raw SQL with parameterized queries"** — this project uses
  MongoDB via Mongoose, not a SQL database. There's no SQL injection
  surface to parameterize against; the equivalent discipline is **never
  building Mongoose queries from unsanitized string concatenation** (e.g.
  don't hand-build `$where` clauses from user input) and preferring
  Mongoose's query builder / schema validation over raw
  `db.collection.find()` calls.

## JSDoc type hints

```js
/**
 * @param {string} arrayAsString - comma-separated tech list, e.g. "node,react"
 * @returns {string[]}
 */
function parseStringAsArray(arrayAsString) {
  return arrayAsString.split(',').map((tech) => tech.trim());
}
```

## Tests mirror `/src` — three different real locations, not one

The stated convention is "tests go in `/tests` mirroring `/src`." In
practice, each layer's own tooling decides where that's actually possible,
so `dev/tests/` is **not** a single universal home — it's where mobile's
tests live, because mobile has no tooling constraint forcing them
elsewhere. This was checked before scaffolding rather than assumed:

| Layer   | Unit tests live at                          | Why not `dev/tests/<layer>/` |
|---------|----------------------------------------------|-------------------------------|
| backend | `qa/backend-tests/unit/`                     | Already existed before this pass (mirrors `backend/src/utils/`); adding a second location here would be the exact "redundant logic" this doc warns against below. |
| web     | `web/src/**/*.test.js` (co-located)          | Create React App's Jest config hardcodes `roots: ["<rootDir>/src"]`. `react-scripts test` will not discover or run tests outside `web/src/`, and CRA offers no supported way to override this without ejecting. Verified against `web/package.json` before placing tests. |
| mobile  | `dev/tests/mobile/`                          | No such constraint — nothing in `mobile/package.json` restricts Jest's `rootDir`/`testMatch`, so `mobile/jest.config.js` points here explicitly. |

Concretely, for new tests:
- **Backend:** add to `qa/backend-tests/unit/`, following
  `parseStringAsArray.test.js` / `calculateDistance.test.js`.
- **Web:** co-locate — `web/src/services/api.test.js` next to `api.js`,
  `web/src/components/DevItem/DevItem.test.js` inside the component's own
  folder. Run via `npm test` in `web/`.
- **Mobile:** add to `dev/tests/mobile/`, mirroring
  `mobile/src/` (e.g. `dev/tests/mobile/services/api.test.js` for
  `mobile/src/services/api.js`). Run via `npm test` in `mobile/`
  (added a `jest.config.js` there that points at this folder, plus `jest`
  and `babel-jest` as devDependencies since neither existed for the mobile
  app package before this pass — only `qa/mobile-tests/` had Jest, and
  that's the E2E/BDD layer, not this one).

The BDD/E2E suites (`qa/{backend,web,mobile}-tests/features/`) are a
separate layer testing user-facing scenarios — see
`qa/docs/06-framework-selection.md`. Don't conflate the two.

## Environment variables

| Layer   | File               | Var                   |
|---------|--------------------|------------------------|
| backend | `backend/.env`     | `MONGO_URI`, `PORT`   |
| web     | `web/.env`         | `REACT_APP_API_URL`   |
| mobile  | `mobile/.env`      | `EXPO_PUBLIC_API_URL` |

Never commit `.env` — only `.env.example` with placeholder values. All
three layers now have one.

## Error handling

- No bare `catch {}` blocks — every catch either handles the error
  meaningfully or rethrows with added context.
- Express 5 (used here) auto-forwards rejected promises from async route
  handlers to error middleware, so `async (req, res) => { ... }` controllers
  don't need manual try/catch for that path — **but** `backend/src/index.js`
  currently has no error-handling middleware registered, so unhandled
  rejections still crash with a default stack-trace response. Add one
  (`app.use((err, req, res, next) => { ... })`, registered last) before
  relying on this further — flagged, not yet fixed.
- External calls (the GitHub Users API in `DevController.store`) should
  handle the "user not found" (404) and rate-limit (403) cases explicitly
  rather than letting a raw axios error surface to the client.

## Before implementing

Per team convention, before writing new code, check for:
- **Assumptions the existing code makes that you're about to violate** —
  e.g. `parseStringAsArray` assumes its argument is always a string; it
  throws on `undefined`, which is reachable today if `techs` is omitted
  from a request (see `qa/backend-tests/unit/parseStringAsArray.test.js`,
  which documents this).
- **Redundant logic** — check whether a util already exists (like the
  test-location table above) before adding a parallel one.
- **Security surface** — no auth exists yet (see `00-architecture.md`);
  don't assume `req.body`/`req.query` values are trustworthy identity
  claims.

## Follow existing patterns

- Controllers are plain objects with async methods
  (`module.exports = { async index(req, res) {...} }`), not classes.
- Models are Mongoose schemas in `backend/src/models/`, one file per
  collection, `PascalCase` filename matching the model name.
- Route registration is centralized in `routes.js` per layer — don't
  scatter `app.get(...)` calls elsewhere.
