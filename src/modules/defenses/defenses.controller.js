const {
  createDefense,
  getDefensesByUser,
  getDefensesForMember,
  getMeetingsForProject,
  userHasProjectMeetingAccess,
  getProjectDefenseSchedules,
  cancelDefense,
  rescheduleDefense,
  getAdviserMeetingById,
  updateMeeting,
  completeMeeting,
  restoreMeeting,
  getDefenseMeetingSession,
  saveDefensePanelEvaluations,
} = require('./defenses.service');
const {
  getTranscriptionHandler,
  getTranscriptionDownloadHandler,
} = require('../transcriptions/transcriptions.controller');
const {
  postStartRecording,
  postCompleteRecording,
  postTranscribeRecording,
  deleteRecordingHandler,
  getScheduleRecordings,
  getMyRecordings,
  getRecordingDetailHandler,
  uploadRecordingFiles,
} = require('../recordings/recordings.controller');

async function postDefense(req, res) {
  const body = req.body || {};
  const waitForSlotRaw = body.wait_for_slot ?? body.waitForSlot;
  const waitForSlot = waitForSlotRaw === true || waitForSlotRaw === 'true' || waitForSlotRaw === 1 || waitForSlotRaw === '1';

  const result = await createDefense(req.user.id, {
    ...body,
    wait_for_slot: waitForSlot,
    booking_side: 'adviser',
  });
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  // Return conflict info so the frontend can prompt the user
  if (result.conflict) {
    return res.status(409).json(result);
  }
  return res.status(201).json(result.data);
}

async function postDefenseProposal(req, res) {
  const body = req.body || {};
  const waitForSlotRaw = body.wait_for_slot ?? body.waitForSlot;
  const waitForSlot = waitForSlotRaw === true || waitForSlotRaw === 'true' || waitForSlotRaw === 1 || waitForSlotRaw === '1';

  const result = await createDefense(req.user.id, {
    ...body,
    wait_for_slot: waitForSlot,
    booking_side: 'adviser',
  });

  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  if (result.conflict) {
    return res.status(409).json(result);
  }

  return res.status(201).json(result.data);
}

async function getMyDefenses(req, res) {
  const defenses = await getDefensesByUser(req.user.id);
  return res.json(defenses);
}

async function patchCancelDefense(req, res) {
  const result = await cancelDefense(req.user.id, req.params.id);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json({
    success: true,
    message: 'Meeting cancelled',
    defense: result.data,
  });
}

async function patchRescheduleDefense(req, res) {
  const result = await rescheduleDefense(req.user.id, req.params.id, req.body || {});
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  if (result.conflict) {
    return res.status(409).json(result);
  }
  return res.json({
    success: true,
    message: 'Meeting rescheduled',
    defense: result.data,
  });
}

async function getMyProjectDefenses(req, res) {
  const defenses = await getProjectDefenseSchedules(req.user.id);
  return res.json(defenses);
}

async function getMeetingById(req, res) {
  try {
    const result = await getAdviserMeetingById(req.user.id, req.params.id);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    return res.json(result.data);
  } catch (err) {
    console.error('defenses.controller – getMeetingById error:', err);
    return res.status(500).json({ error: 'Failed to fetch meeting' });
  }
}

async function patchUpdateMeeting(req, res) {
  const result = await updateMeeting(req.user.id, req.params.id, req.body || {});
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  if (result.conflict) {
    return res.status(409).json(result);
  }
  return res.json({
    success: true,
    message: 'Meeting updated',
    defense: result.data,
  });
}

async function patchCompleteMeeting(req, res) {
  const result = await completeMeeting(req.user.id, req.params.id);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json({
    success: true,
    message: 'Meeting marked complete',
    defense: result.data,
  });
}

async function patchRestoreMeeting(req, res) {
  const result = await restoreMeeting(req.user.id, req.params.id);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json({
    success: true,
    message: 'Meeting restored to scheduled',
    defense: result.data,
  });
}

async function getDefenseMeetingSessionHandler(req, res) {
  try {
    const result = await getDefenseMeetingSession(req.user.id, req.params.id);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    return res.json(result.data);
  } catch (err) {
    console.error('defenses.controller – getDefenseMeetingSession error:', err);
    return res.status(500).json({ error: 'Failed to load defense meeting session' });
  }
}

async function putDefensePanelEvaluations(req, res) {
  try {
    const result = await saveDefensePanelEvaluations(req.user.id, req.params.id, req.body || {});
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    return res.json(result.data);
  } catch (err) {
    console.error('defenses.controller – putDefensePanelEvaluations error:', err);
    return res.status(500).json({ error: 'Failed to save panel evaluations' });
  }
}

async function getProjectMeetings(req, res) {
  try {
    const projectId = req.params.projectId;
    const canView = await userHasProjectMeetingAccess(req.user.id, projectId);
    if (!canView) {
      return res.status(403).json({ error: 'You are not allowed to view meetings for this project' });
    }

    const meetings = await getMeetingsForProject(projectId);
    return res.json(meetings);
  } catch (err) {
    console.error('defenses.controller – getProjectMeetings error:', err);
    return res.status(500).json({ error: 'Failed to fetch project meetings' });
  }
}

module.exports = {
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
  getScheduleRecordings,
  getMyRecordings,
  getRecordingDetailHandler,
  uploadRecordingFiles,
  patchUpdateMeeting,
  patchCompleteMeeting,
  patchRestoreMeeting,
  patchCancelDefense,
  patchRescheduleDefense,
};