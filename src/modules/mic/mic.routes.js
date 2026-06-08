const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { postMicAudio, uploadMicAudio } = require('./mic.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.post('/audio', requireAuth, uploadMicAudio, asyncHandler(postMicAudio));

module.exports = router;
