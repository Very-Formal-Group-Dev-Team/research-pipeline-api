const path = require('path');
const {
  startRecording,
  completeRecording,
  transcribeRecording,
  deleteRecording,
  listScheduleRecordings,
  listAccessibleRecordings,
  getRecordingDetail,
} = require('./recordings.service');
const {
  createRecordingCompleteUpload,
  getUploadErrorMessage,
  getUploadErrorStatus,
} = require('../../middleware/multer');

const recordingCompleteUpload = createRecordingCompleteUpload();

async function postStartRecording(req, res) {
  const scheduleId = req.params.id;
  const result = await startRecording(req.user.id, scheduleId);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.status(201).json(result.data);
}

async function postCompleteRecording(req, res) {
  const scheduleId = req.params.id;
  const recordingId = req.params.recordingId;
  const videoFile = req.files?.recording?.[0];
  const audioFile = req.files?.audio?.[0];

  if (!videoFile?.path) {
    return res.status(400).json({ error: 'Recording file is required (field: recording)' });
  }

  const fileUrl = `/uploads/meeting-recordings/${path.basename(videoFile.path)}`;
  const audioUrl = audioFile?.path
    ? `/uploads/meeting-recordings/${path.basename(audioFile.path)}`
    : null;
  const durationMs = req.body?.duration_ms ?? req.body?.durationMs ?? null;

  const result = await completeRecording(req.user.id, scheduleId, recordingId, {
    file_url: fileUrl,
    audio_url: audioUrl,
    file_size: videoFile.size,
    mime_type: videoFile.mimetype || 'video/webm',
    duration_ms: durationMs,
  });

  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function postTranscribeRecording(req, res) {
  const scheduleId = req.params.id;
  const recordingId = req.params.recordingId;
  const result = await transcribeRecording(req.user.id, scheduleId, recordingId);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function deleteRecordingHandler(req, res) {
  const scheduleId = req.params.id;
  const recordingId = req.params.recordingId;
  const result = await deleteRecording(req.user.id, scheduleId, recordingId);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function getScheduleRecordings(req, res) {
  const scheduleId = req.params.id;
  const result = await listScheduleRecordings(req.user.id, scheduleId);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function getMyRecordings(req, res) {
  const result = await listAccessibleRecordings(req.user.id);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function getRecordingDetailHandler(req, res) {
  const scheduleId = req.params.id;
  const recordingId = req.params.recordingId;
  const result = await getRecordingDetail(req.user.id, scheduleId, recordingId);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

function uploadRecordingFiles(req, res, next) {
  recordingCompleteUpload(req, res, (err) => {
    if (err) {
      const status = getUploadErrorStatus(err);
      return res.status(status).json({ error: getUploadErrorMessage(err) });
    }
    return next();
  });
}

module.exports = {
  postStartRecording,
  postCompleteRecording,
  postTranscribeRecording,
  deleteRecordingHandler,
  getScheduleRecordings,
  getMyRecordings,
  getRecordingDetailHandler,
  uploadRecordingFiles,
};
