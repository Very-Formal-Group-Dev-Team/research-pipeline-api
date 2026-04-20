const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const controller = require('./notifications.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(requireAuth);

router.get('/', asyncHandler(controller.list));
router.patch('/read-all', asyncHandler(controller.markAllRead));
router.patch('/:id/read', asyncHandler(controller.markRead));

module.exports = router;
