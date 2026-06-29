# API Developer Setup

**Last verified:** June 30, 2026

Local setup for the **Archivum API** (Express 5 + MySQL). For Docker, see [DOCKER.md](./DOCKER.md). For production, see [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## Prerequisites

- Node.js 20+
- npm
- MySQL 8 (local install or Docker — see [DOCKER.md](./DOCKER.md))

---

## Quick start

```bash
cp .env.example .env
npm install
npm run migrate
npm run dev
```

API runs on **http://localhost:4000**. Verify: `GET /health` → `{ "status": "ok" }`.

Migrations also run automatically on `npm run dev` and `npm start`.

---

## Required environment variables

Minimum `.env`:

```env
NODE_ENV=development
PORT=4000

DB_HOST=localhost
DB_PORT=3306
DB_NAME=student_research
DB_USER=appuser
DB_PASSWORD=password

JWT_SECRET=your-jwt-secret-change-in-production

API_ORIGIN=http://localhost:4000
WEB_ORIGIN=http://localhost:3000
CLIENT_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
```

See [.env.example](../.env.example) for the full list.

---

## Optional environment variables

| Variable | Purpose |
|----------|---------|
| `SMTP_*` | Email verification and password reset |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `ALLOW_DEV_AUTH_BYPASS=true` | **Local only.** Raw UUID / `x-user-id` testing. Never in production. |
| `KEYWORD_MODEL_URL` | Related studies search |
| `TRANSCRIPTION_MODEL_URL` | Audio transcription |
| `JITSI_BASE_URL` | Online defense meetings |
| `UPLOAD_PATH` | Persistent upload directory (default `./uploads`) |

---

## Frontend connection

The Next.js frontend expects:

```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api
```

Ensure `CORS_ORIGINS` includes the frontend origin (default `http://localhost:3000`).

---

## Dev auth bypass

For curl/Postman without a full login:

```env
ALLOW_DEV_AUTH_BYPASS=true
```

Non-production only. Accepts a raw UUID Bearer token or `x-user-id` header.

---

## Common scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Migrations + nodemon |
| `npm run migrate` | Migrations only |
| `npm start` | Migrations + production server |
| `npm run lint` | ESLint |
| `npm run docker:up` | Docker stack — see [DOCKER.md](./DOCKER.md) |

---

## Troubleshooting

| Issue | Check |
|-------|-------|
| CORS errors | `CORS_ORIGINS` includes frontend URL |
| 401 on requests | Valid token; `JWT_SECRET` unchanged |
| DB connection failed | MySQL running; `DB_*` correct |
| Migrations fail | DB exists; user has CREATE/ALTER privileges |
| Uploads lost on restart | Set persistent `UPLOAD_PATH` |
