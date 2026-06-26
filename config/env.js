const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  resolveWhisperPython,
  formatWhisperPythonLabel,
  isWhisperPythonReady,
} = require('./whisperPython');

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

function validateEnv() {
  const jwtSecret = process.env.JWT_SECRET;
  if (typeof jwtSecret !== 'string' || jwtSecret.trim().length === 0) {
    throw new Error('JWT_SECRET must be set. Add it to your .env file.');
  }

  if (isProduction) {
    const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
    const missing = required.filter((name) => {
      const value = process.env[name];
      return typeof value !== 'string' || value.trim().length === 0;
    });

    if (missing.length > 0) {
      throw new Error(`Missing required environment variables in production: ${missing.join(', ')}`);
    }

    if (jwtSecret.trim().length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters in production');
    }
  }
}

const jitsiBaseUrl = (process.env.JITSI_BASE_URL || 'https://localhost:8443').trim().replace(/\/+$/, '');

function normalizeServiceUrl(value) {
  if (!value) return null;
  const raw = String(value).trim().replace(/\/+$/, '');
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

const transcriptionModelUrl = normalizeServiceUrl(process.env.TRANSCRIPTION_MODEL_URL);
const whisperModel = (process.env.WHISPER_MODEL || 'base').trim() || 'base';
const whisperPython = resolveWhisperPython();
const whisperPythonLabel = formatWhisperPythonLabel(whisperPython);
const whisperPythonReady = whisperPython ? isWhisperPythonReady(whisperPython) : false;
const whisperPythonPath = whisperPython?.command || null;

if (!isProduction) {
  if (transcriptionModelUrl) {
    console.log(`[whisper] Using transcription service: ${transcriptionModelUrl}`);
  } else if (whisperPythonReady && whisperPythonPath) {
    console.log(`[whisper] Using local Python: ${whisperPythonPath}`);
  } else {
    const installHint = process.env.WHISPER_PYTHON?.trim() || (process.platform === 'win32' ? 'python3' : 'python3');
    console.warn(`[whisper] Transcription unavailable. Set TRANSCRIPTION_MODEL_URL or install faster-whisper with: ${installHint} -m pip install -r scripts/requirements-transcription.txt`);
    if (process.env.WHISPER_PYTHON) {
      console.warn(`[whisper] WHISPER_PYTHON=${process.env.WHISPER_PYTHON} did not pass validation.`);
    }
  }
}

module.exports = {
  isProduction,
  normalizeOrigin,
  corsOrigins,
  uploadBase,
  trustProxy,
  jitsiBaseUrl,
  transcriptionModelUrl,
  whisperModel,
  whisperPython,
  whisperPythonLabel,
  whisperPythonPath,
  whisperPythonReady,
  validateEnv,
};
