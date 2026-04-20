const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const {
  createAvatarUpload,
  getUploadErrorStatus,
  getUploadErrorMessage,
} = require('../../middleware/multer');
const { getProfile, patchProfile, uploadAvatar } = require('./user.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(requireAuth);

function handleAvatarUpload(req, res, next) {
  const upload = createAvatarUpload();
  upload(req, res, (err) => {
    if (err) {
      return res.status(getUploadErrorStatus(err)).json({ error: getUploadErrorMessage(err) });
    }
    next();
  });
}

router.get('/profile', asyncHandler(getProfile));
router.patch('/profile', asyncHandler(patchProfile));
router.post('/avatar', handleAvatarUpload, asyncHandler(uploadAvatar));

module.exports = router;
