const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const controller = require('./paper_merge.controller');

const router = express.Router({ mergeParams: true });

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(requireAuth);

router.post('/preview', asyncHandler(controller.preview));
router.post('/commit', asyncHandler(controller.commit));

module.exports = router;
