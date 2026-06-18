const paperReviewsService = require('./paper_reviews.service');

async function getReviewRequest(req, res) {
  const projectId = req.params.id;
  const result = await paperReviewsService.getReviewRequestForMember(projectId, req.user.id);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function requestReview(req, res) {
  const projectId = req.params.id;
  const versionId = req.params.versionId;
  const note = req.body?.note;
  const result = await paperReviewsService.requestReview(projectId, versionId, req.user.id, note);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.status(201).json(result.data);
}

async function withdrawReviewRequest(req, res) {
  const projectId = req.params.id;
  const result = await paperReviewsService.withdrawReviewRequest(projectId, req.user.id);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function completeReviewRequest(req, res) {
  const projectId = req.params.id;
  const force = Boolean(req.body?.force);
  const result = await paperReviewsService.completeReviewRequest(projectId, req.user.id, { force });
  if (result.error) {
    if (result.status === 409 && result.data) {
      return res.status(409).json(result.data);
    }
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function listPendingReviews(req, res) {
  const rows = await paperReviewsService.getPendingReviewsForAdviser(req.user.id);
  return res.json(rows);
}

module.exports = {
  getReviewRequest,
  requestReview,
  withdrawReviewRequest,
  completeReviewRequest,
  listPendingReviews,
};
