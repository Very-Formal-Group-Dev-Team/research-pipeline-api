# Student Research Portal Backend Instructions

## What to optimize for
- This repo is an Express 5 + MySQL API on Node.js 20+ with pnpm.
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
- Install dependencies with `pnpm install`.
- Run the API locally with `pnpm dev`.
- Lint code with `pnpm lint`; auto-fix with `pnpm lint:fix`.
- Run migrations with `pnpm migrate`.
- Start production mode with `pnpm start`.
- Use the Docker scripts in `package.json` when working on deployment or local parity.

## Before changing behavior
- Check [README.md](README.md), [api_docs.md](api_docs.md), [Deployment.md](Deployment.md), and [DOCKER.md](DOCKER.md) before inventing new patterns.
- If you touch uploads, auth, or env handling, follow the existing rules in `src/middleware/auth.js`, `config/env.js`, and `config/db.js`.
- Do not add a new abstraction layer unless the current module structure cannot support the change cleanly.