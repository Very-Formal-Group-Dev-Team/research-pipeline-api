const paperBranchesService = require('./paper_branches.service');
const paperVersionsService = require('./paper_versions.service');
const coordinatorService = require('../coordinator/coordinator.service');

async function userCanViewBranches(userId, projectId) {
  const isMember = await paperVersionsService.isProjectMember(projectId, userId);
  if (isMember) return true;
  return coordinatorService.coordinatorCanViewProject(userId, projectId);
}

/** POST /projects/:id/branches */
async function create(req, res) {
  const projectId = req.params.id;

  const isMember = await paperVersionsService.isProjectMember(projectId, req.user.id);
  if (!isMember) {
    return res.status(403).json({ error: 'You are not a member of this project' });
  }

  const { name, fromVersionId } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!fromVersionId) {
    return res.status(400).json({ error: 'fromVersionId is required' });
  }

  try {
    const branch = await paperBranchesService.createBranch(projectId, name.trim(), fromVersionId);
    return res.status(201).json(branch);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
}

/** GET /projects/:id/branches */
async function list(req, res) {
  const projectId = req.params.id;

  const canView = await userCanViewBranches(req.user.id, projectId);
  if (!canView) {
    return res.status(403).json({ error: 'You are not a member of this project' });
  }

  const branches = await paperBranchesService.listBranches(projectId);
  return res.json(branches);
}

/** GET /projects/:id/branches/:branchName */
async function getOne(req, res) {
  const { id: projectId, branchName } = req.params;

  const canView = await userCanViewBranches(req.user.id, projectId);
  if (!canView) {
    return res.status(403).json({ error: 'You are not a member of this project' });
  }

  const branch = await paperBranchesService.getBranch(projectId, branchName);
  if (!branch) {
    return res.status(404).json({ error: 'Branch not found' });
  }
  return res.json(branch);
}

/** DELETE /projects/:id/branches/:branchName */
async function remove(req, res) {
  const { id: projectId, branchName } = req.params;

  const isMember = await paperVersionsService.isProjectMember(projectId, req.user.id);
  if (!isMember) {
    return res.status(403).json({ error: 'You are not a member of this project' });
  }

  try {
    await paperBranchesService.deleteBranch(projectId, branchName);
    return res.status(204).end();
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
}

module.exports = { create, list, getOne, remove };
