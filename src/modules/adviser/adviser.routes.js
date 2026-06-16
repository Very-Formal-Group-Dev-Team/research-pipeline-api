const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const controller = require('./adviser.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(requireAuth);
router.use(asyncHandler(controller.requireAdviser));

router.get('/rubrics', asyncHandler(controller.listRubrics));
router.get('/pending-reviews', asyncHandler(controller.listPendingReviews));
router.get('/rubrics/:rubricId', asyncHandler(controller.getRubric));
router.post('/rubrics', asyncHandler(controller.createRubric));
router.put('/rubrics/:rubricId', asyncHandler(controller.updateRubric));
router.delete('/rubrics/:rubricId', asyncHandler(controller.deleteRubric));

module.exports = router;
