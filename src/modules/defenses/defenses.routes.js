const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const {
  postDefense,
  postDefenseProposal,
  getMyDefenses,
  getMyProjectDefenses,
  getProjectMeetings,
  getMeetingById,
  patchUpdateMeeting,
  patchCompleteMeeting,
  patchCancelDefense,
  patchRescheduleDefense,
} = require('./defenses.controller');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

router.use(requireAuth);

router.post('/', asyncHandler(postDefense));
router.post('/propose', asyncHandler(postDefenseProposal));
router.get('/me', asyncHandler(getMyDefenses));
router.get('/my-projects', asyncHandler(getMyProjectDefenses));
router.get('/project/:projectId', asyncHandler(getProjectMeetings));
router.get('/:id', asyncHandler(getMeetingById));
router.patch('/:id', asyncHandler(patchUpdateMeeting));
router.patch('/:id/complete', asyncHandler(patchCompleteMeeting));
router.patch('/:id/cancel', asyncHandler(patchCancelDefense));
router.patch('/:id/reschedule', asyncHandler(patchRescheduleDefense));

module.exports = router;
