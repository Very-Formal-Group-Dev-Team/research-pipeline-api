const {
  processAudioUpload,
  ensureTranscriptionAudioDir,
} = require('../transcriptions/transcriptions.service');
const {
  createAudioUpload,
  getUploadErrorMessage,
  getUploadErrorStatus,
} = require('../../middleware/multer');

const audioUpload = createAudioUpload();

async function postMicAudio(req, res) {
  const scheduleId = String(req.body?.schedule_id || req.body?.scheduleId || '').trim();
  if (!scheduleId) {
    return res.status(400).json({ error: 'schedule_id is required' });
  }

  if (!req.file?.path) {
    return res.status(400).json({ error: 'Audio file is required (field: audio)' });
  }

  const deviceKey = req.body?.device_key ?? req.body?.device ?? req.body?.deviceKey ?? null;
  const result = await processAudioUpload(req.user.id, scheduleId, req.file.path, deviceKey);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

function uploadMicAudio(req, res, next) {
  ensureTranscriptionAudioDir();
  audioUpload(req, res, (err) => {
    if (err) {
      const status = getUploadErrorStatus(err);
      return res.status(status).json({ error: getUploadErrorMessage(err) });
    }
    return next();
  });
}

module.exports = {
  postMicAudio,
  uploadMicAudio,
};
