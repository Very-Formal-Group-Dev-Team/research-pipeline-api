# student-research-api Production Deployment

## Runtime Baseline

- Node.js 20+ (enforced via package.json engines)
- Production mode: set NODE_ENV=production
- Start command: npm start (or pnpm start)

## Required Environment Variables

- DB_HOST
- DB_PORT
- DB_NAME
- DB_USER
- DB_PASSWORD
- JWT_SECRET (at least 32 chars in production)

## Recommended Environment Variables

- CLIENT_URL: primary frontend URL (for CORS)
- CORS_ORIGINS: comma-separated allowed origins
- WEB_ORIGIN: fallback frontend origin for auth flows
- API_ORIGIN: backend public URL used for OAuth callback construction
- TRUST_PROXY: true/false/hop-count when behind reverse proxy
- UPLOAD_PATH: persistent upload path, e.g. /mnt/uploads on Railway

## Railway Notes

1. Add a Railway Volume mounted at /mnt/uploads.
2. Set UPLOAD_PATH=/mnt/uploads.
3. Configure CLIENT_URL and CORS_ORIGINS to your deployed frontend URLs.
4. Keep PORT unmanaged (Railway injects it automatically).
5. Run migrations once after first deployment:

	pnpm run migrate

## Health Check

- Endpoint: GET /health
- Response: JSON with status, uptime, timestamp

## Production Readiness Checklist

- Helmet enabled for security headers.
- CORS restricted to explicit origins.
- Upload directories support persistent volume paths.
- Graceful shutdown handles SIGINT/SIGTERM and closes DB pool.
- 404 and error responses are normalized as JSON.
