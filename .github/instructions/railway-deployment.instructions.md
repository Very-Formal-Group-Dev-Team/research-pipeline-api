---
applyTo: "**"
description: >
  Step-by-step guide for deploying student-research-api to Railway,
  including persistent volume setup for file uploads and required
  codebase changes. Apply when preparing or updating the Railway deployment.
---

# Railway Deployment Guide — student-research-api

## 1. Pre-Deployment Checklist

### Start Script
`package.json` already has:
```json
"scripts": {
  "start": "node src/server.js"
}
```
Railway runs `npm start` (or `pnpm start`) by default. No change needed.

### PORT Binding
`src/server.js` already reads `process.env.PORT`:
```js
const PORT = process.env.PORT || 4000;
app.listen(PORT, ...);
```
Railway injects `PORT` automatically. No change needed.

### Node Version
Add an `engines` field to `package.json` to pin the Node version:
```json
"engines": {
  "node": ">=20.0.0"
}
```
Or create a `.node-version` file in the repo root:
```
20
```

### Dependencies
All runtime dependencies are in `dependencies` (not `devDependencies`).
`nodemon` is correctly in `devDependencies`. No change needed.

### Environment Variables for DB
`config/db.js` already reads from env vars:
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`

These must be set in the Railway dashboard (see Section 3).

---

## 2. Persistent File Uploads — Railway Volume Setup

### Why This Matters
Railway's filesystem is **ephemeral**: any file written to disk is deleted
on each redeploy or restart. User-uploaded files (avatars, documents) must
be stored on a Railway **Volume** (persistent disk) instead.

### Step 1 — Add a Railway Volume
1. Open your service in the Railway dashboard.
2. Go to **Settings → Volumes → Add Volume**.
3. Set the mount path to `/mnt/uploads`.
4. Click **Add**.

Railway will mount the volume at `/mnt/uploads` inside the container.

### Step 2 — Add an Environment Variable
In **Railway → Variables**, add:
```
UPLOAD_PATH=/mnt/uploads
```

### Step 3 — Update `src/middleware/multer.js`

Change the two hardcoded directory constants at the top of the file:

**Before:**
```js
const AVATARS_DIR = path.join(__dirname, '..', '..', 'uploads', 'avatars');
const FILES_DIR   = path.join(__dirname, '..', '..', 'uploads', 'files');
```

**After:**
```js
const UPLOAD_BASE = process.env.UPLOAD_PATH
  ? path.resolve(process.env.UPLOAD_PATH)
  : path.join(__dirname, '..', '..', 'uploads');

const AVATARS_DIR = path.join(UPLOAD_BASE, 'avatars');
const FILES_DIR   = path.join(UPLOAD_BASE, 'files');
```

- When `UPLOAD_PATH=/mnt/uploads`, files land in `/mnt/uploads/avatars`
  and `/mnt/uploads/files` — persisted across deploys.
- When `UPLOAD_PATH` is unset (local dev), falls back to the existing
  `uploads/` folder — no local workflow change.

### Step 4 — Update Static File Serving in `src/app.js`

**Before:**
```js
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
```

**After:**
```js
const UPLOAD_BASE = process.env.UPLOAD_PATH
  ? path.resolve(process.env.UPLOAD_PATH)
  : path.join(__dirname, '..', 'uploads');

app.use('/uploads', express.static(UPLOAD_BASE));
```

Place this constant near the top of `app.js`, after the `require`s.

### Step 5 — Verify DB paths stored for files
Files are stored in the DB as `/uploads/files/<filename>` and served via
the static route above. These paths remain unchanged — the URL still
resolves to `/uploads/files/<filename>` regardless of where the file
is physically stored on disk.

---

## 3. Deployment Steps

### Connect Repository
1. In Railway, click **New Project → Deploy from GitHub repo**.
2. Select `student-research-api` from the list.
3. Railway auto-detects Node.js and uses `pnpm start` (or `npm start`).

### Set Environment Variables
In **Railway → Variables**, add all of the following:

| Variable          | Value (example)            |
|-------------------|----------------------------|
| `NODE_ENV`        | `production`               |
| `PORT`            | *(Railway sets this automatically — do not override)* |
| `DB_HOST`         | your MySQL host            |
| `DB_PORT`         | `3306`                     |
| `DB_NAME`         | `student_research`         |
| `DB_USER`         | your DB user               |
| `DB_PASSWORD`     | your DB password           |
| `JWT_SECRET`      | a long random string       |
| `UPLOAD_PATH`     | `/mnt/uploads`             |
| `CLIENT_URL`      | your frontend Railway URL  |
| `GOOGLE_CLIENT_ID`| your Google OAuth client ID|

> For MySQL, use a Railway MySQL plugin or an external provider (e.g.,
> PlanetScale, Railway's own MySQL service). Copy the connection variables
> from its dashboard into the variables above.

### Update CORS for Production
In `src/app.js`, add your deployed frontend URL to the `origin` array:
```js
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    process.env.CLIENT_URL, // e.g. https://your-app.up.railway.app
  ],
  credentials: true,
  ...
}));
```

### Run Migrations on First Deploy
Railway does not run migrations automatically. After the first deploy:
1. Open the Railway service **Shell** tab (or use Railway CLI).
2. Run:
   ```sh
   pnpm run migrate
   ```
   Or set a **Deploy Command** (one-time) override to:
   ```sh
   pnpm run migrate && pnpm run start
   ```
   Remove the override after the first successful run.

### Deploy and Monitor
1. Push to the connected branch (e.g., `main`) — Railway redeploys automatically.
2. Watch **Logs** in the Railway dashboard for:
   - `Database connected successfully` — DB env vars are correct.
   - `running on http://localhost:<PORT>` — server started.
   - Any `ENOENT` or `EACCES` errors → volume not mounted or `UPLOAD_PATH`
     not set.

---

## 4. Local Dev — No Changes Required

The `UPLOAD_PATH` fallback ensures that local development continues to
write files into the existing `uploads/` directory. No `.env` change is
needed locally unless you want to test the volume path.

---

## 5. Quick Checklist Before Every Deploy

- [ ] `UPLOAD_PATH` variable set in Railway
- [ ] Railway Volume attached and mount path matches `UPLOAD_PATH`
- [ ] All DB vars populated
- [ ] `CLIENT_URL` set and added to CORS `origin` array
- [ ] `JWT_SECRET` set (min 32 random chars)
- [ ] Migrations have been run on the DB
