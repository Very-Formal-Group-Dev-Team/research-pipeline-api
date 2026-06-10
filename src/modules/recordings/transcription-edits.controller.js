const {
  getTranscriptionEdit,
  saveTranscriptionEdit,
  mergeTranscriptionLines,
  assignTranscriptionSpeaker,
  downloadTranscriptionEdit,
} = require('./transcription-edits.service');

async function getTranscriptionEditHandler(req, res) {
  const result = await getTranscriptionEdit(req.user.id, req.params.id, req.params.recordingId);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function putTranscriptionEditHandler(req, res) {
  const result = await saveTranscriptionEdit(
    req.user.id,
    req.params.id,
    req.params.recordingId,
    req.body || {},
  );
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function postMergeTranscriptionLinesHandler(req, res) {
  const lineIds = req.body?.line_ids ?? req.body?.lineIds ?? [];
  const speakers = req.body?.speakers ?? null;
  const result = await mergeTranscriptionLines(
    req.user.id,
    req.params.id,
    req.params.recordingId,
    Array.isArray(lineIds) ? lineIds : [],
    speakers,
  );
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function postAssignTranscriptionSpeakerHandler(req, res) {
  const lineIds = req.body?.line_ids ?? req.body?.lineIds ?? [];
  const speakerId = req.body?.speaker_id ?? req.body?.speakerId ?? null;
  const speakers = req.body?.speakers ?? null;
  const result = await assignTranscriptionSpeaker(
    req.user.id,
    req.params.id,
    req.params.recordingId,
    Array.isArray(lineIds) ? lineIds : [],
    speakerId,
    speakers,
  );
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function getTranscriptionEditDownloadHandler(req, res) {
  const result = await downloadTranscriptionEdit(req.user.id, req.params.id, req.params.recordingId);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${result.data.filename}"`);
  return res.send(result.data.text);
}

module.exports = {
  getTranscriptionEditHandler,
  putTranscriptionEditHandler,
  postMergeTranscriptionLinesHandler,
  postAssignTranscriptionSpeakerHandler,
  getTranscriptionEditDownloadHandler,
};
