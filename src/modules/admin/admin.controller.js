const adminService = require('./admin.service');
const institutionsService = require('../institutions/institutions.service');

async function listInstitutions(_req, res) {
  const result = await adminService.listInstitutions();
  return res.json(result.data);
}

async function createInstitution(req, res) {
  const result = await adminService.createInstitution(req.body || {});
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  return res.status(201).json(result.data);
}

async function updateInstitution(req, res) {
  const institutionId = req.params.institutionId;
  const body = req.body || {};
  const payload = {};

  if (typeof body.name === 'string') payload.name = body.name;
  if (typeof body.code === 'string') payload.code = body.code;
  if (typeof body.isActive === 'boolean') payload.isActive = body.isActive;

  const result = await adminService.updateInstitution(institutionId, payload);
  if (result.error) {
    const status = result.error === 'Institution not found' ? 404 : 400;
    return res.status(status).json({ error: result.error });
  }
  return res.json(result.data);
}

async function listPrograms(req, res) {
  const institutionId = req.params.institutionId;
  const institution = await institutionsService.getInstitutionById(institutionId);
  if (!institution) {
    return res.status(404).json({ error: 'Institution not found' });
  }

  const result = await adminService.listPrograms(institutionId);
  if (result.error) {
    return res.status(404).json({ error: result.error });
  }
  return res.json(result.data);
}

async function createProgram(req, res) {
  const institutionId = req.params.institutionId;
  const result = await adminService.createProgram(institutionId, req.body || {});
  if (result.error) {
    const status = result.error === 'Institution not found' ? 404 : 400;
    return res.status(status).json({ error: result.error });
  }
  return res.status(201).json(result.data);
}

async function updateProgram(req, res) {
  const { institutionId, programId } = req.params;
  const body = req.body || {};
  const payload = {};

  if (typeof body.name === 'string') payload.name = body.name;
  if (typeof body.code === 'string') payload.code = body.code;
  if (typeof body.description === 'string') payload.description = body.description;
  if (typeof body.isActive === 'boolean') payload.isActive = body.isActive;

  const result = await adminService.updateProgram(institutionId, programId, payload);
  if (result.error) {
    const status = result.error === 'Program not found' ? 404 : 400;
    return res.status(status).json({ error: result.error });
  }
  return res.json(result.data);
}

module.exports = {
  listInstitutions,
  createInstitution,
  updateInstitution,
  listPrograms,
  createProgram,
  updateProgram,
};
