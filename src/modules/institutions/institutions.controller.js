const db = require('../../../config/db');
const institutionsService = require('./institutions.service');

async function searchInstitutions(req, res) {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const institutions = await institutionsService.searchInstitutions(query, { activeOnly: true });
  return res.json(institutions);
}

async function getMyInstitutionPrograms(req, res) {
  const { rows } = await db.query(
    'SELECT institution_id FROM user_roles WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [req.user.id],
  );

  const institutionId = rows[0]?.institution_id;
  if (!institutionId) {
    return res.status(400).json({ error: 'No institution linked to your account' });
  }

  await institutionsService.materializeLegacyPrograms(institutionId);

  const result = await institutionsService.getProgramsByInstitutionId(institutionId, {
    activeOnly: true,
  });
  if (result.error) {
    return res.status(404).json({ error: result.error });
  }

  return res.json(result.data);
}

async function getMyInstitutionCourses(req, res) {
  const { rows } = await db.query(
    'SELECT institution_id FROM user_roles WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [req.user.id],
  );

  const institutionId = rows[0]?.institution_id;
  if (!institutionId) {
    return res.status(400).json({ error: 'No institution linked to your account' });
  }

  const result = await institutionsService.getCoursesByInstitutionId(institutionId);
  if (result.error) {
    return res.status(404).json({ error: result.error });
  }

  return res.json(result.data);
}

module.exports = {
  searchInstitutions,
  getMyInstitutionCourses,
  getMyInstitutionPrograms,
};
