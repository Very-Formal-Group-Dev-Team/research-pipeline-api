const express = require('express');
const controller = require('./public.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Public (no auth required)
router.get('/stats', asyncHandler(controller.getStats));

module.exports = router;

