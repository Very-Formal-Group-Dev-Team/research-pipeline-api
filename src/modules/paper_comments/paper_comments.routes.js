const express = require('express');
const controller = require('./paper_comments.controller');

const router = express.Router({ mergeParams: true });

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.get('/summary', asyncHandler(controller.summary));
router.get('/', asyncHandler(controller.list));
router.post('/', asyncHandler(controller.create));
router.patch('/:commentId', asyncHandler(controller.update));
router.post('/:commentId/resolve', asyncHandler(controller.resolve));
router.post('/:commentId/request-revision', asyncHandler(controller.requestRevision));
router.post('/:commentId/reopen', asyncHandler(controller.reopen));

module.exports = router;
