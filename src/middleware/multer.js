const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { uploadBase } = require('../../config/env');

const AVATARS_DIR = path.join(uploadBase, 'avatars');
const FILES_DIR = path.join(uploadBase, 'files');
const TRANSCRIPTION_AUDIO_DIR = path.join(uploadBase, 'transcription-audio');
const MEETING_RECORDINGS_DIR = path.join(uploadBase, 'meeting-recordings');

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    }

    // Ensure folder can be traversed and written by the app process.
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);

    // Probe write to fail early if volume is mounted read-only or full.
    const probeFile = path.join(dir, `.upload-probe-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probeFile, 'ok');
    fs.unlinkSync(probeFile);
  } catch (err) {
    console.error('Failed to create or access upload directory', dir, err);
    err.code = err.code || 'UPLOAD_DIR_UNAVAILABLE';
    throw err;
  }
}

function makeFilename(req, file, fallbackExt) {
  const userId = req.user?.id || 'unknown';
  const ext = path.extname(file.originalname).toLowerCase() || fallbackExt;
  const unique = crypto.randomBytes(8).toString('hex');
  return `${userId}-${Date.now()}-${unique}${ext}`;
}

function getUploadErrorStatus(err) {
  if (!err) return 400;
  if (err.code === 'LIMIT_FILE_SIZE') return 413;

  const diskCodes = ['EACCES', 'EPERM', 'EROFS', 'ENOSPC', 'UPLOAD_DIR_UNAVAILABLE'];
  if (diskCodes.includes(err.code)) return 500;

  return 400;
}

function getUploadErrorMessage(err) {
  const status = getUploadErrorStatus(err);
  if (status === 500) {
    return 'Failed to write file to disk. Please try again later.';
  }
  return err?.message || 'File upload failed';
}

function createAvatarUpload() {
  ensureDir(AVATARS_DIR);

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        ensureDir(AVATARS_DIR);
        cb(null, AVATARS_DIR);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      cb(null, makeFilename(req, file, '.jpg'));
    },
  });

  const fileFilter = (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const mimetype = (file.mimetype || '').toLowerCase();
    if (!mimetype) return cb(new Error('Missing mimetype'));
    if (allowed.includes(mimetype)) {
      // also check extension
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (!ext || !['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        return cb(new Error('Invalid file extension'));
      }
      cb(null, true);
    } else {
      cb(new Error('Only JPG, JPEG, PNG, and WEBP images are allowed'));
    }
  };

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 },
  }).single('avatar');
}

function createDocumentUpload() {
  ensureDir(FILES_DIR);

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        ensureDir(FILES_DIR);
        cb(null, FILES_DIR);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      cb(null, makeFilename(req, file, '.pdf'));
    },
  });

  const fileFilter = (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    const mimetype = (file.mimetype || '').toLowerCase();
    if (!mimetype) return cb(new Error('Missing mimetype'));
    if (allowed.includes(mimetype)) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (!ext || !['.pdf', '.doc', '.docx'].includes(ext)) {
        return cb(new Error('Invalid file extension'));
      }
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, and DOCX files are allowed'));
    }
  };

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  }).single('file');
}

function createAudioUpload() {
  ensureDir(TRANSCRIPTION_AUDIO_DIR);

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        ensureDir(TRANSCRIPTION_AUDIO_DIR);
        cb(null, TRANSCRIPTION_AUDIO_DIR);
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.wav';
      const unique = crypto.randomBytes(8).toString('hex');
      cb(null, `mic-${Date.now()}-${unique}${ext}`);
    },
  });

  const fileFilter = (_req, file, cb) => {
    const allowed = [
      'audio/wav',
      'audio/x-wav',
      'audio/webm',
      'audio/ogg',
      'audio/mpeg',
      'audio/mp4',
      'audio/x-m4a',
      'application/octet-stream',
    ];
    const mimetype = (file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExt = ['.wav', '.webm', '.ogg', '.mp3', '.m4a', '.mp4'];

    if (allowed.includes(mimetype) || allowedExt.includes(ext)) {
      cb(null, true);
      return;
    }

    cb(new Error('Only WAV, WEBM, OGG, MP3, and M4A audio files are allowed'));
  };

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: 25 * 1024 * 1024 },
  }).single('audio');
}

function createRecordingUpload() {
  ensureDir(MEETING_RECORDINGS_DIR);

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        ensureDir(MEETING_RECORDINGS_DIR);
        cb(null, MEETING_RECORDINGS_DIR);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.webm';
      cb(null, makeFilename(req, file, ext));
    },
  });

  const fileFilter = (_req, file, cb) => {
    const allowed = [
      'video/webm',
      'video/mp4',
      'video/x-matroska',
      'audio/webm',
      'audio/mp4',
      'application/octet-stream',
    ];
    const mimetype = (file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExt = ['.webm', '.mp4', '.mkv', '.m4a'];

    if (allowed.includes(mimetype) || allowedExt.includes(ext)) {
      cb(null, true);
      return;
    }

    cb(new Error('Only WEBM, MP4, and MKV recordings are allowed'));
  };

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: 500 * 1024 * 1024 },
  }).single('recording');
}

function createRecordingCompleteUpload() {
  ensureDir(MEETING_RECORDINGS_DIR);

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        ensureDir(MEETING_RECORDINGS_DIR);
        cb(null, MEETING_RECORDINGS_DIR);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || (
        file.fieldname === 'audio' ? '.webm' : '.webm'
      );
      const prefix = file.fieldname === 'audio' ? 'audio' : 'video';
      const unique = crypto.randomBytes(8).toString('hex');
      const userId = req.user?.id || 'unknown';
      cb(null, `${prefix}-${userId}-${Date.now()}-${unique}${ext}`);
    },
  });

  const fileFilter = (_req, file, cb) => {
    const mimetype = (file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();

    if (file.fieldname === 'audio') {
      const allowedAudio = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'application/octet-stream'];
      const allowedExt = ['.webm', '.ogg', '.wav', '.mp4', '.m4a'];
      if (allowedAudio.includes(mimetype) || allowedExt.includes(ext)) {
        cb(null, true);
        return;
      }
      cb(new Error('Only WEBM, OGG, WAV, and MP4 audio files are allowed'));
      return;
    }

    const allowedVideo = ['video/webm', 'video/mp4', 'video/x-matroska', 'application/octet-stream'];
    const allowedExt = ['.webm', '.mp4', '.mkv'];
    if (allowedVideo.includes(mimetype) || allowedExt.includes(ext)) {
      cb(null, true);
      return;
    }

    cb(new Error('Only WEBM, MP4, and MKV recordings are allowed'));
  };

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: 500 * 1024 * 1024 },
  }).fields([
    { name: 'recording', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
  ]);
}

module.exports = {
  createAvatarUpload,
  createDocumentUpload,
  createAudioUpload,
  createRecordingUpload,
  createRecordingCompleteUpload,
  getUploadErrorStatus,
  getUploadErrorMessage,
};
