const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const controller = require('./schedule.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(requireAuth);
router.get('/me', asyncHandler(controller.getMySchedule));

module.exports = router;
