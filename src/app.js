const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const {
  corsOrigins,
  uploadBase,
  trustProxy,
  isProduction,
  normalizeOrigin,
} = require('../config/env');
const usersRouter = require('./modules/users/users.routes');
const userRouter = require('./modules/user/user.routes');
const authRouter = require('./modules/auth/auth.routes');
const uploadRouter = require('./modules/upload/upload.routes');
const projectsRouter = require('./modules/projects/projects.routes');
const notificationsRouter = require('./modules/notifications/notifications.routes');
const defensesRouter = require('./modules/defenses/defenses.routes');
const coordinatorRouter = require('./modules/coordinator/coordinator.routes');
const fileOperationsRouter = require('./modules/file_operations/file_operations.routes');
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', trustProxy);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser and same-origin requests with no Origin header.
    if (!origin) {
      callback(null, true);
      return;
    }

    const requestOrigin = normalizeOrigin(origin);
    if (requestOrigin && corsOrigins.includes(requestOrigin)) {
      callback(null, true);
      return;
    }

    if (!isProduction) {
      console.warn('[cors] Denied origin:', origin, 'Allowed:', corsOrigins);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' })); // For parsing application/json (allow base64 payloads)
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // For parsing application/x-www-form-urlencoded
const legacyUploadBase = path.join(__dirname, '..', 'uploads');

const AVATAR_FALLBACK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2n8AAAAASUVORK5CYII=',
  'base64',
);

function trySendAvatar(baseDir, filename, res) {
  const avatarPath = path.join(baseDir, 'avatars', filename);
  if (!fs.existsSync(avatarPath)) return false;
  res.sendFile(avatarPath);
  return true;
}

// Return a tiny placeholder image when the avatar file no longer exists.
app.get('/uploads/avatars/:filename', (req, res, next) => {
  const filename = req.params.filename || '';
  const safeFilename = path.basename(filename);

  if (!safeFilename || safeFilename !== filename) {
    return next();
  }

  if (trySendAvatar(uploadBase, safeFilename, res)) {
    return;
  }

  if (legacyUploadBase !== uploadBase && trySendAvatar(legacyUploadBase, safeFilename, res)) {
    return;
  }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', isProduction ? 'public, max-age=300' : 'no-store');
  res.status(200).send(AVATAR_FALLBACK_PNG);
});

app.use('/uploads', express.static(uploadBase, {
  maxAge: isProduction ? '1d' : 0,
}));

if (legacyUploadBase !== uploadBase) {
  app.use('/uploads', express.static(legacyUploadBase, {
    maxAge: isProduction ? '1d' : 0,
  }));
}

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/api/users', usersRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/defenses', defensesRouter);
app.use('/api/coordinator', coordinatorRouter);
app.use('/api', fileOperationsRouter);
app.use('/api/file-operations', fileOperationsRouter);

app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS origin denied' });
  }

  if (isProduction) {
    console.error('[error]', err.message);
  } else {
    console.error(err);
  }

  if (err.name === 'MulterError' || err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: err.message || 'File upload error' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

module.exports = app;
