# Student Research Portal Backend Instructions

## What to optimize for
- This repo is an Express 5 + MySQL API on Node.js 20+ with npm.
- Keep changes aligned with the modular `src/modules/<domain>/` layout.
- Prefer small, local edits that preserve the current route, controller, and service split.

## Backend conventions
- Put DB queries in `*.service.js`, request handling in `*.controller.js`, and route wiring in `*.routes.js`.
- Register new routers in `src/app.js`.
- Use `requireAuth` for protected routes and read the caller from `req.user.id`.
- Use the multer helpers in `src/middleware/multer.js` for uploads.
- Keep error responses JSON-shaped as `{ error: "..." }` with the right HTTP status.
- Use `db.query(...)` for simple reads and transactions for multi-step writes.
- Keep migrations idempotent and zero-padded in `migrations/`.

## Commands
- Install dependencies with `npm install`.
- Run the API locally with `npm run dev`.
- Lint code with `npm run lint`; auto-fix with `npm run lint:fix`.
- Run migrations with `npm run migrate`.
- Start production mode with `npm start`.
- Use the Docker scripts in `package.json` when working on deployment or local parity.

## Before changing behavior
- Check [README.md](README.md), [docs/SETUP.md](docs/SETUP.md), [docs/API_REFERENCE.md](docs/API_REFERENCE.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), and [docs/DOCKER.md](docs/DOCKER.md) before inventing new patterns.
- For Railway-specific steps, see [.github/instructions/railway-deployment.instructions.md](.github/instructions/railway-deployment.instructions.md).
- If you add or change API routes, update [docs/API_REFERENCE.md](docs/API_REFERENCE.md) in the same pull request.
- If you touch uploads, auth, or env handling, follow the existing rules in `src/middleware/auth.js`, `config/env.js`, and `config/db.js`.
- Do not add a new abstraction layer unless the current module structure cannot support the change cleanly.
