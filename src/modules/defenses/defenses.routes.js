const express = require('express');
const { requireAuth, requireDashboardRole } = require('../../middleware/auth');
const {
  postDefense,
  postDefenseProposal,
  getMyDefenses,
  getMyProjectDefenses,
  getProjectMeetings,
  getMeetingById,
  getDefenseMeetingSessionHandler,
  putDefensePanelEvaluations,
  patchUpdateMeeting,
  patchCompleteMeeting,
  patchRestoreMeeting,
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

router.post('/', requireDashboardRole('adviser'), asyncHandler(postDefense));
router.post('/propose', requireDashboardRole('adviser'), asyncHandler(postDefenseProposal));
router.get('/me', asyncHandler(getMyDefenses));
router.get('/my-projects', asyncHandler(getMyProjectDefenses));
router.get('/project/:projectId', asyncHandler(getProjectMeetings));
router.get('/:id/meeting-session', asyncHandler(getDefenseMeetingSessionHandler));
router.put('/:id/panel-evaluations', asyncHandler(putDefensePanelEvaluations));
router.get('/:id', asyncHandler(getMeetingById));
router.patch('/:id', requireDashboardRole('adviser'), asyncHandler(patchUpdateMeeting));
router.patch('/:id/complete', requireDashboardRole('adviser'), asyncHandler(patchCompleteMeeting));
router.patch('/:id/restore', requireDashboardRole('adviser'), asyncHandler(patchRestoreMeeting));
router.patch('/:id/cancel', requireDashboardRole('adviser'), asyncHandler(patchCancelDefense));
router.patch('/:id/reschedule', requireDashboardRole('adviser'), asyncHandler(patchRescheduleDefense));

module.exports = router;
