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
  getTranscriptionHandler,
  getTranscriptionDownloadHandler,
  postStartRecording,
  postCompleteRecording,
  postTranscribeRecording,
  deleteRecordingHandler,
  restoreRecordingHandler,
  purgeRecordingHandler,
  patchRecordingHandler,
  getScheduleRecordings,
  getMyRecordings,
  getRecordingDetailHandler,
  uploadRecordingFiles,
  getTranscriptionEditHandler,
  putTranscriptionEditHandler,
  postMergeTranscriptionLinesHandler,
  postAssignTranscriptionSpeakerHandler,
  getTranscriptionEditDownloadHandler,
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
router.get('/recordings/mine', asyncHandler(getMyRecordings));
router.get('/me', asyncHandler(getMyDefenses));
router.get('/my-projects', asyncHandler(getMyProjectDefenses));
router.get('/project/:projectId', asyncHandler(getProjectMeetings));
router.get('/:id/meeting-session', asyncHandler(getDefenseMeetingSessionHandler));
router.put('/:id/panel-evaluations', asyncHandler(putDefensePanelEvaluations));
router.get('/:id/transcription/download', asyncHandler(getTranscriptionDownloadHandler));
router.get('/:id/transcription', asyncHandler(getTranscriptionHandler));
router.get('/:id/recordings', asyncHandler(getScheduleRecordings));
router.post('/:id/recordings/:recordingId/transcription-edit/merge', asyncHandler(postMergeTranscriptionLinesHandler));
router.post('/:id/recordings/:recordingId/transcription-edit/assign', asyncHandler(postAssignTranscriptionSpeakerHandler));
router.get('/:id/recordings/:recordingId/transcription-edit/download', asyncHandler(getTranscriptionEditDownloadHandler));
router.get('/:id/recordings/:recordingId/transcription-edit', asyncHandler(getTranscriptionEditHandler));
router.put('/:id/recordings/:recordingId/transcription-edit', asyncHandler(putTranscriptionEditHandler));
router.get('/:id/recordings/:recordingId', asyncHandler(getRecordingDetailHandler));
router.post('/:id/recordings/start', asyncHandler(postStartRecording));
router.post(
  '/:id/recordings/:recordingId/complete',
  uploadRecordingFiles,
  asyncHandler(postCompleteRecording),
);
router.post('/:id/recordings/:recordingId/transcribe', asyncHandler(postTranscribeRecording));
router.patch('/:id/recordings/:recordingId/restore', asyncHandler(restoreRecordingHandler));
router.delete('/:id/recordings/:recordingId/purge', asyncHandler(purgeRecordingHandler));
router.patch('/:id/recordings/:recordingId', asyncHandler(patchRecordingHandler));
router.delete('/:id/recordings/:recordingId', asyncHandler(deleteRecordingHandler));
router.get('/:id', asyncHandler(getMeetingById));
router.patch('/:id', requireDashboardRole('adviser'), asyncHandler(patchUpdateMeeting));
router.patch('/:id/complete', requireDashboardRole('adviser'), asyncHandler(patchCompleteMeeting));
router.patch('/:id/restore', requireDashboardRole('adviser'), asyncHandler(patchRestoreMeeting));
router.patch('/:id/cancel', requireDashboardRole('adviser'), asyncHandler(patchCancelDefense));
router.patch('/:id/reschedule', requireDashboardRole('adviser'), asyncHandler(patchRescheduleDefense));

module.exports = router;
