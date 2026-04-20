const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const {
  createAvatarUpload,
  getUploadErrorStatus,
  getUploadErrorMessage,
} = require('../../middleware/multer');
const { uploadAvatar, uploadCropped } = require('./upload.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function handleAvatarUpload(req, res, next) {
  const upload = createAvatarUpload();
  upload(req, res, (err) => {
    if (err) {
      return res.status(getUploadErrorStatus(err)).json({ error: getUploadErrorMessage(err) });
    }
    next();
  });
}

router.post('/avatar', requireAuth, handleAvatarUpload, asyncHandler(uploadAvatar));
// Accept a cropped image as base64 JSON payload
router.post('/avatar-cropped', requireAuth, asyncHandler(uploadCropped));

module.exports = router;
