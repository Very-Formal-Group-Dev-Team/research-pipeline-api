const adminService = require('./admin.service');
const institutionsService = require('../institutions/institutions.service');
const { listAuditLogs } = require('../audit/audit.service');

async function listInstitutions(_req, res) {
  const result = await adminService.listInstitutions();
  return res.json(result.data);
}

async function createInstitution(req, res) {
  const result = await adminService.createInstitution(req.user.id, req.body || {});
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

  const result = await adminService.updateInstitution(req.user.id, institutionId, payload);
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

async function listUsers(req, res) {
  const { search, role, institutionId, status, page, limit } = req.query || {};
  const result = await adminService.listUsers({
    search: typeof search === 'string' ? search : null,
    role: typeof role === 'string' ? role : null,
    institutionId: typeof institutionId === 'string' ? institutionId : null,
    status: typeof status === 'string' ? status : null,
    page,
    limit,
  });
  return res.json(result);
}

async function getUser(req, res) {
  const user = await adminService.getUserById(req.params.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.json(user);
}

async function updateUser(req, res) {
  const body = req.body || {};
  const payload = {};

  if (typeof body.role === 'string') payload.role = body.role;
  if (typeof body.institutionId === 'string') payload.institutionId = body.institutionId;
  if (typeof body.status === 'number') payload.status = body.status;
  if (typeof body.isActive === 'boolean') payload.status = body.isActive ? 1 : 0;

  const result = await adminService.updateUser(req.user.id, req.params.userId, payload);
  if (result.error) {
    const status = result.status || 400;
    return res.status(status).json({ error: result.error });
  }
  return res.json(result.data);
}

async function listAuditLog(req, res) {
  const { action, actorUserId, institutionId, from, to, page, limit } = req.query || {};
  const result = await listAuditLogs({
    action: typeof action === 'string' ? action : null,
    actorUserId: typeof actorUserId === 'string' ? actorUserId : null,
    institutionId: typeof institutionId === 'string' ? institutionId : null,
    from: typeof from === 'string' ? from : null,
    to: typeof to === 'string' ? to : null,
    page,
    limit,
  });
  return res.json(result);
}

module.exports = {
  listInstitutions,
  createInstitution,
  updateInstitution,
  listPrograms,
  createProgram,
  updateProgram,
  listUsers,
  getUser,
  updateUser,
  listAuditLog,
};
