const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const {
  getMe,
  getMyProfileExists,
  getMyRole,
  getUserById,
  patchMe,
  postCompleteProfile,
  searchUsers,
} = require('./users.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(requireAuth);

router.get('/search', asyncHandler(searchUsers));
router.get('/me', asyncHandler(getMe));
router.get('/me/exists', asyncHandler(getMyProfileExists));
router.get('/me/role', asyncHandler(getMyRole));
router.patch('/me', asyncHandler(patchMe));
router.post('/complete-profile', asyncHandler(postCompleteProfile));
router.get('/:userId', asyncHandler(getUserById));

module.exports = router;
