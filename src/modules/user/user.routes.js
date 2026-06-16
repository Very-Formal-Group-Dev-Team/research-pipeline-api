const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const {
  createAvatarUpload,
  getUploadErrorStatus,
  getUploadErrorMessage,
} = require('../../middleware/multer');
const { getProfile, patchProfile, uploadAvatar, getNotificationPreferences, patchNotificationPreferences, getDisplayPrefs, patchDisplayPrefs } = require('./user.controller');

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
router.get('/notification-preferences', asyncHandler(getNotificationPreferences));
router.patch('/notification-preferences', asyncHandler(patchNotificationPreferences));
router.get('/display-preferences', asyncHandler(getDisplayPrefs));
router.patch('/display-preferences', asyncHandler(patchDisplayPrefs));
router.post('/avatar', handleAvatarUpload, asyncHandler(uploadAvatar));

module.exports = router;
