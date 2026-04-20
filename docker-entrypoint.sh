#!/bin/sh
set -e

echo "==> docker-entrypoint: starting..."

# 1) Validate required environment variables
MISSING=""
for VAR in DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD; do
  eval VAL="\$$VAR"
  if [ -z "$VAL" ]; then
    MISSING="$MISSING $VAR"
  fi
done

if [ -n "$MISSING" ]; then
  echo "ERROR: Missing required env vars:$MISSING" >&2
  exit 1
fi

# 2) Run database migrations
echo "==> Running migrations..."
node scripts/run-migrations.js
echo "==> Migrations complete."

mkdir -p /app/uploads/avatars
chown -R node:node /app/uploads

# 3) Start the app
if [ "${NODE_ENV:-development}" = "production" ]; then
  echo "==> Starting server (production)..."
  exec node src/server.js
else
  echo "==> Starting server (development with nodemon)..."
  exec npx nodemon src/server.js
fi