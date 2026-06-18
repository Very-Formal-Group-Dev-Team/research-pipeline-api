const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const controller = require('./paper_branches.controller');

const router = express.Router({ mergeParams: true });

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(requireAuth);

router.get('/', asyncHandler(controller.list));
router.post('/', asyncHandler(controller.create));
router.get('/:branchName', asyncHandler(controller.getOne));
router.delete('/:branchName', asyncHandler(controller.remove));

module.exports = router;
