const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const {
  register,
  login,
  getMe,
  logout,
  oAuthRedirect,
  googleCallback,
  verifyEmail,
  resendVerification,
  changePassword,
  forgotPassword,
  resetPassword,
} = require('./auth.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.post('/register', asyncHandler(register));
router.post('/login', asyncHandler(login));
router.post('/logout', asyncHandler(logout));
router.post('/verify-email', asyncHandler(verifyEmail));
router.post('/resend-verification', asyncHandler(resendVerification));
router.get('/me', requireAuth, asyncHandler(getMe));
router.post('/change-password', requireAuth, asyncHandler(changePassword));
router.post('/forgot-password', asyncHandler(forgotPassword));
router.post('/reset-password', asyncHandler(resetPassword));
router.post('/oauth', asyncHandler(oAuthRedirect));
router.get('/google/callback', asyncHandler(googleCallback));

module.exports = router;
