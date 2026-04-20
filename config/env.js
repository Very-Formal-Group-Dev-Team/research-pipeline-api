const path = require('path');
const fs = require('fs');

const isProduction = process.env.NODE_ENV === 'production';

function normalizeOrigin(value) {
  if (!value) return null;

  const raw = String(value).trim().replace(/\/+$/, '');
  if (!raw) return null;

  // Accept common deployment values entered without a protocol.
  const withProtocol = /^https?:\/\//i.test(raw)
    ? raw
    : `${/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(raw) ? 'http' : 'https'}://${raw}`;

  try {
    const parsed = new URL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseCsv(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);
}

function parseTrustProxy(value) {
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;

  const asNumber = Number.parseInt(normalized, 10);
  return Number.isNaN(asNumber) ? false : asNumber;
}

const corsOrigins = Array.from(new Set([
  ...parseCsv(process.env.CORS_ORIGINS),
  normalizeOrigin(process.env.CLIENT_URL),
  normalizeOrigin(process.env.WEB_ORIGIN),
  ...(isProduction ? [] : ['http://localhost:3000', 'http://localhost:3001'].map(normalizeOrigin)),
].filter(Boolean)));

function resolveUploadBase() {
  if (process.env.UPLOAD_PATH) {
    return path.resolve(process.env.UPLOAD_PATH);
  }

  // Railway volume default mount point.
  const railwayVolumePath = '/mnt/uploads';
  if (isProduction && fs.existsSync(railwayVolumePath)) {
    return railwayVolumePath;
  }

  return path.join(__dirname, '..', 'uploads');
}

const uploadBase = resolveUploadBase();

const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);

function validateProductionEnv() {
  if (!isProduction) return;

  const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET'];
  const missing = required.filter((name) => {
    const value = process.env[name];
    return typeof value !== 'string' || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables in production: ${missing.join(', ')}`);
  }

  if (process.env.JWT_SECRET.trim().length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }
}

module.exports = {
  isProduction,
  normalizeOrigin,
  corsOrigins,
  uploadBase,
  trustProxy,
  validateProductionEnv,
};