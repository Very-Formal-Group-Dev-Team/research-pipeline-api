const adviserService = require('./adviser.service');
const paperReviewsController = require('../paper_reviews/paper_reviews.controller');

async function requireAdviser(req, res, next) {
  const institution = await adviserService.getInstitutionByAdviser(req.user.id);
  if (!institution) {
    return res.status(403).json({ error: 'Not an adviser or no institution assigned' });
  }
  req.institution = institution;
  next();
}

async function listRubrics(req, res) {
  const rubrics = await adviserService.listAdviserRubrics(req.institution.id, req.user.id);
  return res.json(rubrics);
}

async function getRubric(req, res) {
  const result = await adviserService.getAdviserRubricById(
    req.institution.id,
    req.user.id,
    req.params.rubricId
  );
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function createRubric(req, res) {
  const result = await adviserService.createAdviserRubric(
    req.institution.id,
    req.user.id,
    req.body
  );
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.status(201).json(result.data);
}

async function updateRubric(req, res) {
  const result = await adviserService.updateAdviserRubric(
    req.institution.id,
    req.user.id,
    req.params.rubricId,
    req.body
  );
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function deleteRubric(req, res) {
  const result = await adviserService.deleteAdviserRubric(
    req.institution.id,
    req.user.id,
    req.params.rubricId
  );
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function listPendingReviews(req, res) {
  return paperReviewsController.listPendingReviews(req, res);
}

module.exports = {
  requireAdviser,
  listRubrics,
  getRubric,
  createRubric,
  updateRubric,
  deleteRubric,
  listPendingReviews,
};
