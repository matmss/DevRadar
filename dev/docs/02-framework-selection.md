# DevRadar — Application Framework Selection

This is the dev-side counterpart to `qa/docs/06-framework-selection.md`
(which covers *test* frameworks). This doc covers the *application*
frameworks already in use, why they fit, and what's worth adding as the
project moves from a planning/QA exercise into full-scale development.

## Already chosen (in place, not being revisited)

| Layer   | Framework          | Why it fits this project |
|---------|--------------------|---------------------------|
| Backend | Express 5          | Minimal, unopinionated HTTP layer for a small REST surface (3 routes today). Express 5's built-in async-error forwarding removes a whole class of unhandled-rejection bugs common in Express 4 apps. |
| Backend | Mongoose            | Schema validation + a `2dsphere` geo index out of the box, which is the one piece of real domain complexity here (radius search). A raw MongoDB driver would mean hand-rolling that validation. |
| Backend | Socket.io           | Needs both a request/response API (registration) and a push channel (live map updates) — Socket.io's room/query-based connection tracking is a natural fit for "notify only clients whose filters match." |
| Web     | Create React App    | Zero-config React setup already carries the app; no build customization has been needed yet, so there's no case for Vite/Next.js migration purely on current requirements. |
| Mobile  | Expo (managed) / RN | `expo-location` and OTA update support are used directly; no native module has needed a bare workflow eject so far. |

None of these need to change to support the QA plan or the current feature
set. The rest of this doc is about what to *add* as the team grows past
"one person, one repo."

## Recommended additions for full-scale development

Ordered by how much pain they prevent per unit of setup effort:

### 1. Linting + formatting (ESLint + Prettier), shared across all three layers
None of `backend/`, `web/`, or `mobile/` currently enforce a lint rule set
beyond CRA's bundled `eslintConfig: { extends: "react-app" }` in `web/`.
Backend and mobile have nothing. Before more than one person is writing
code here, "run linting mentally before presenting code" (the stated
convention) needs an actual linter behind it, or it silently stops
happening. A root-level `.eslintrc` extended per-package, plus
`lint-staged` + Husky pre-commit hook, is the standard shape for this.

### 2. Request validation (Zod or Joi) on the backend
`DevController.store` and `SearchController.index` currently trust
`req.body`/`req.query` shape implicitly — e.g. nothing stops
`latitude`/`longitude` arriving as non-numeric strings before they hit
`Number(...)` in `SearchController`, silently producing `NaN` in a Mongo
geo query. A schema-validation middleware at the route level (reject
malformed requests with a 400 before the controller runs) is the highest-
leverage fix available before adding new endpoints on top of the current
ones.

### 3. Structured logging (pino or winston) on the backend
Currently `console.log`-only (and only in one error-swallowing path in
`DevForm` on the frontend, not the backend at all). No visibility into
request volume, GitHub API rate-limit proximity, or socket connection
counts in production. Pino is the lighter-weight choice given Express 5's
otherwise-minimal dependency footprint here.

### 4. API documentation (OpenAPI/Swagger) for the backend
Three routes today; worth doing before that number doubles. A generated
`openapi.yaml` also becomes the natural source of truth for
`qa/backend-tests` request/response shape assertions and any future
frontend API-client generation.

### 5. TypeScript migration — worth a decision, not a default
The stated convention calls for "type hints on all function signatures."
JSDoc (see `01-conventions.md`) gets partway there today with zero
build-step cost. A full TypeScript migration would get the rest of the
way (compile-time enforcement instead of editor-only hints) but is a
real, non-trivial cost across three packages with different toolchains
(CRA supports it natively; Expo supports it natively; the Express backend
would need a build step it doesn't have today). Recommendation: don't
default into this — decide it explicitly once JSDoc coverage starts
feeling insufficient, not before.

### Not recommended (at current scale)
- **GraphQL** — three REST routes with no complex client-side data-fetching
  problem to solve; would add a query-parsing layer for no benefit yet.
- **Microservices split** — single Mongo collection, single deploy unit;
  splitting this now would add network calls where a function call
  suffices.
