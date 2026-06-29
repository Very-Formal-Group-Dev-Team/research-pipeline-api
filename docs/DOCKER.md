# Docker Guide

**Last verified:** June 30, 2026

Docker Compose setup for running the Archivum API with MySQL and optional supporting services locally or in a containerized environment.

For Node-only local dev (without Docker), see [SETUP.md](./SETUP.md).

---

## What Docker provides

The main compose file at [docker-compose.yml](../docker-compose.yml) includes:

| Service | Container | Purpose |
|---------|-----------|---------|
| `db` | archivum-db | MySQL 8 |
| `app` | archivum-backend | Express API |
| `keyword-model` | archivum-keyword-model | RRL / related studies search |
| `transcription-model` | archivum-transcription-model | Faster-Whisper transcription |
| Jitsi stack | (included via compose) | Online video meetings |

The Next.js frontend is **not** in Docker — run it separately with `npm run dev` in `research-pipeline-web/`.

---

## Quick start (full stack)

From the API repository root:

```bash
cp .env.example .env
npm run docker:up
```

This runs Jitsi setup and starts all services. The API is available at **http://localhost:4000**.

### Connect from the web app

In the frontend repo (`research-pipeline-web/.env.local`):

```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api
```

If using Docker MySQL from the host (API running outside Docker):

```env
DB_HOST=localhost
DB_PORT=3307
DB_USER=root
DB_PASSWORD=rootpassword
```

When the API runs inside Docker, it connects to `db:3306` automatically.

---

## npm scripts

| Command | Purpose |
|---------|---------|
| `npm run docker:up` | Jitsi setup + `docker compose up -d --build` |
| `npm run docker:down` | Stop all services |
| `npm run docker:down:clean` | Stop and remove volumes |
| `npm run docker:restart` | Restart API container (`app`) |
| `npm run docker:logs` | Tail API logs |
| `npm run docker:build` | Rebuild images without cache |
| `npm run docker:jitsi:setup` | Generate Jitsi `.env` and config |
| `npm run docker:jitsi:reset` | Reset Jitsi config (required after `.env` changes) |

---

## Services detail

### MySQL (`db`)

- Image: `mysql:8.0`
- Host port: `${DB_HOST_PORT:-3307}` → container `3306`
- Database: `${DB_NAME:-student_research}`
- Root password: `${DB_ROOT_PASSWORD:-rootpassword}`
- Data persisted in Docker volume `mysql_data`

### API (`app`)

- Built from [Dockerfile](../Dockerfile)
- Port: `${API_PORT:-4000}:4000`
- Uploads mounted at `/opt/archivum-data/uploads` → `/app/uploads`
- Depends on healthy `db`, started `keyword-model` and `transcription-model`
- Runs migrations via [docker-entrypoint.sh](../docker-entrypoint.sh)

Key environment variables inside the container:

```env
DB_HOST=db
KEYWORD_MODEL_URL=http://keyword-model:8000
TRANSCRIPTION_MODEL_URL=http://transcription-model:8001
JITSI_BASE_URL=https://localhost:8443
UPLOAD_PATH=/app/uploads
```

### Keyword model

Builds from `models/keyword_model/Dockerfile`. Required for **Find Related Studies** on projects.

### Transcription model

Builds from `models/transcription_model/Dockerfile`. Uses Faster-Whisper (`WHISPER_MODEL`, default `base`). Requires access to uploaded audio under the shared upload volume.

---

## Jitsi (video meetings)

Jitsi is included via [docker/jitsi/docker-compose.yml](../docker/jitsi/docker-compose.yml).

### Quick start (Jitsi only)

```bash
npm run docker:jitsi:setup
npm run docker:jitsi:reset    # once after changing docker/jitsi/.env
docker compose up -d jitsi-web jitsi-prosody jitsi-jicofo jitsi-jvb
```

Open **https://localhost:8443** (accept the self-signed certificate).

Set in API `.env` and web `.env.local`:

```env
JITSI_BASE_URL=https://localhost:8443
NEXT_PUBLIC_JITSI_BASE_URL=https://localhost:8443
```

### Important notes

- Use **HTTPS on port 8443**, not HTTP on 8000 — HTTP causes broken WebSocket URLs and disconnects.
- After any Jitsi `.env` change: `npm run docker:jitsi:reset` then restart Jitsi containers.
- For LAN devices: set `JVB_ADVERTISE_IPS` and `PUBLIC_URL` to your host LAN IP in `docker/jitsi/.env`.
- Allow **UDP port 10000** through the firewall for media.

Full Jitsi documentation: [docker/jitsi/README.md](../docker/jitsi/README.md).

---

## Volumes and data persistence

| Volume / path | Contents |
|---------------|----------|
| `mysql_data` | MySQL database files |
| `/opt/archivum-data/uploads` | User uploads (avatars, documents, recordings) |
| `docker/jitsi/cfg/` | Generated Jitsi config (gitignored) |

`docker:down:clean` removes MySQL data — use only when you intend to wipe the database.

---

## Running partial stacks

### Database only

```bash
docker compose up -d db
```

Then run the API locally with `DB_HOST=localhost` and `DB_PORT=3307`.

### API + DB (no ML services)

Start specific services:

```bash
docker compose up -d db app
```

Related-studies and transcription features will fail until their services are started.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| API cannot connect to DB | Wait for `db` healthcheck; verify `DB_*` in `.env` |
| Port 3307 or 4000 in use | Change `DB_HOST_PORT` / `API_PORT` in `.env` |
| Jitsi disconnects immediately | Use https://localhost:8443; run `docker:jitsi:reset` |
| Transcription unavailable | Ensure `transcription-model` is running and upload volume is shared |
| Find Related Studies fails | Ensure `keyword-model` is running |
| Uploads lost after container remove | Use named/host volume path; avoid `docker:down:clean` in dev |

---

## Production note

This compose file targets **local development and parity testing**. Production deployment on Railway or similar is documented in [DEPLOYMENT.md](./DEPLOYMENT.md). Jitsi, Whisper, and keyword model may be deployed as separate services or omitted if features are not required.
