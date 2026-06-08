const {
  getTranscription,
  getTranscriptionDownload,
} = require('./transcriptions.service');

async function getTranscriptionHandler(req, res) {
  const scheduleId = req.params.id;
  const result = await getTranscription(req.user.id, scheduleId);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function getTranscriptionDownloadHandler(req, res) {
  const scheduleId = req.params.id;
  const result = await getTranscriptionDownload(req.user.id, scheduleId);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  const { filename, body } = result.data;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(body || '');
}

module.exports = {
  getTranscriptionHandler,
  getTranscriptionDownloadHandler,
};
