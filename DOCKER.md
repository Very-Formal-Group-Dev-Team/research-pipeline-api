# Docker Setup

This project includes Docker configuration for easy development and deployment.

## Prerequisites

- Docker Desktop installed and running
- Docker Compose V2 (included with Docker Desktop)

## Quick Start

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and update the values as needed.

2. **Start the application:**
   ```bash
   pnpm docker:up
   # or
   docker compose up -d --build
   ```

3. **View logs:**
   ```bash
   pnpm docker:logs
   # or
   docker compose logs -f app
   ```

4. **Stop the application:**
   ```bash
   pnpm docker:down
   # or
   docker compose down
   ```

## Available Services

### App Service (Node.js API)
- **Service name:** `app`
- **Container:** `student-research-app`
- **Port:** 4000 (configurable via `API_PORT` in `.env`)
- **URL:** http://localhost:4000
- **Healthcheck:** `GET /` every 15s

### Database Service
- **Service name:** `db`
- **Container:** `student-research-db`
- **Type:** MySQL 8.0
- **Port:** 3307 → 3306 (configurable via `DB_HOST_PORT` in `.env`)
- **Data:** Persisted in Docker volume `mysql_data`

## Development Workflow

The docker-compose setup mounts your local code into the container, so changes
you make will automatically restart the server (using nodemon).

Database migrations run automatically on every container start via
`docker-entrypoint.sh`.

### Useful Commands

```bash
# Build/rebuild containers (fresh, no cache)
pnpm docker:build

# Start services in background (with build)
pnpm docker:up

# Restart only the app container
pnpm docker:restart
# or
docker compose restart app

# View app logs
pnpm docker:logs

# Stop all services
pnpm docker:down

# Stop and remove ALL volumes + orphans (⚠️ removes database data)
pnpm docker:down:clean
# or
docker compose down -v --remove-orphans

# Access the app container shell
docker exec -it student-research-app sh

# Access the database
docker exec -it student-research-db mysql -u root -p student_research
```

## Production Build

To build for production:

```bash
# Build the Docker image
docker build -t student-research-api:latest .

# Run without docker compose
docker run -p 4000:4000 --env-file .env student-research-api:latest
```

## Startup Flow

1. `docker compose up --build` builds the image and starts `db` first.
2. The DB healthcheck ping verifies MySQL is ready to accept connections.
3. Once `db` is healthy the `app` container starts and runs
   `docker-entrypoint.sh`:
   - Validates required environment variables
   - Runs pending database migrations (`scripts/run-migrations.js`)
   - Starts the Node.js server (nodemon in dev, node in production)

## Troubleshooting

### Database connection issues
- Ensure the database service is healthy: `docker compose ps`
- Check database logs: `docker compose logs db`

### Port conflicts
- Change `API_PORT` or `DB_HOST_PORT` in `.env` if default ports are in use
- Default: API → 4000, DB → 3307

### Orphan container warnings
- Run `docker compose down -v --remove-orphans` to clean up

### Stale build cache
- Run `pnpm docker:build` (uses `--no-cache`)

### Reset database
```bash
docker-compose down -v
docker-compose up -d
```
