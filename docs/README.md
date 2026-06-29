# API Documentation

Backend documentation for **Archivum** (Student Research Portal API).

| Document | Description |
|----------|-------------|
| [SETUP.md](./SETUP.md) | Local API setup (env, migrate, dev) |
| [API_REFERENCE.md](./API_REFERENCE.md) | REST endpoints grouped by module |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Production deployment (Railway, volumes, CORS) |
| [DOCKER.md](./DOCKER.md) | Docker Compose, Jitsi, optional ML services |

## Related

- [README.md](../README.md) — API quick start
- [AGENTS.md](../AGENTS.md) — contributor conventions
- [docker/jitsi/README.md](../docker/jitsi/README.md) — Jitsi setup (detailed)
- [.github/instructions/railway-deployment.instructions.md](../.github/instructions/railway-deployment.instructions.md) — Railway-specific steps

## Optional: full-stack workspace docs

If this repo is cloned beside `research-pipeline-web` with a parent `Documentation/` folder (SRP layout):

- [Documentation/ARCHITECTURE.md](../../Documentation/ARCHITECTURE.md) — system-wide architecture
- [Documentation/DEVELOPER_SETUP.md](../../Documentation/DEVELOPER_SETUP.md) — full-stack local setup
- [Documentation/KNOWN_LIMITATIONS.md](../../Documentation/KNOWN_LIMITATIONS.md) — gaps and defects

These paths are not required for API-only development.

## Maintenance

Update [API_REFERENCE.md](./API_REFERENCE.md) in the same pull request when adding or changing routes in `src/modules/`.
