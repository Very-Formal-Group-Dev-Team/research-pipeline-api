const paperMergeService = require('./paper_merge.service');
const paperVersionsService = require('./paper_versions.service');

/**
 * POST /projects/:id/merge/preview
 * Body: { sourceBranch, targetBranch }
 *
 * Runs the merge algorithm without committing. Returns either:
 *   { type: 'already-merged' }
 *   { type: 'fast-forward', sourceHeadId }
 *   { type: 'conflict', paragraphs, ancestorVersionId, sourceVersionId, targetVersionId }
 *   { type: 'clean', paragraphs }   — merge would succeed with no conflicts
 */
async function preview(req, res) {
  const projectId = req.params.id;

  const isMember = await paperVersionsService.isProjectMember(projectId, req.user.id);
  if (!isMember) {
    return res.status(403).json({ error: 'You are not a member of this project' });
  }

  const { sourceBranch, targetBranch } = req.body;
  if (!sourceBranch || !sourceBranch.trim()) {
    return res.status(400).json({ error: 'sourceBranch is required' });
  }
  if (!targetBranch || !targetBranch.trim()) {
    return res.status(400).json({ error: 'targetBranch is required' });
  }

  try {
    const result = await paperMergeService.mergeBranches(
      projectId,
      sourceBranch.trim(),
      targetBranch.trim(),
      req.user.id,
      null,
      { dryRun: true },
    );

    if (result.type === 'conflict') {
      return res.status(409).json(result);
    }

    return res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
}

/**
 * POST /projects/:id/merge/commit
 * Body: { sourceBranch, targetBranch, resolutions?, commitMessage? }
 *
 * Runs the merge and writes the commit. Returns either:
 *   { type: 'already-merged' }
 *   { type: 'fast-forward', sourceHeadId }
 *   { type: 'conflict', paragraphs, ancestorVersionId, sourceVersionId, targetVersionId }
 *   { type: 'merged', versionId, versionNumber }
 */
async function commit(req, res) {
  const projectId = req.params.id;

  const isMember = await paperVersionsService.isProjectMember(projectId, req.user.id);
  if (!isMember) {
    return res.status(403).json({ error: 'You are not a member of this project' });
  }

  const { sourceBranch, targetBranch, resolutions } = req.body;
  if (!sourceBranch || !sourceBranch.trim()) {
    return res.status(400).json({ error: 'sourceBranch is required' });
  }
  if (!targetBranch || !targetBranch.trim()) {
    return res.status(400).json({ error: 'targetBranch is required' });
  }
  if (resolutions !== undefined && !Array.isArray(resolutions)) {
    return res.status(400).json({ error: 'resolutions must be an array when provided' });
  }

  try {
    const result = await paperMergeService.mergeBranches(
      projectId,
      sourceBranch.trim(),
      targetBranch.trim(),
      req.user.id,
      resolutions ?? null,
    );

    if (result.type === 'already-merged' || result.type === 'fast-forward') {
      return res.json(result);
    }

    if (result.type === 'conflict') {
      return res.status(409).json(result);
    }

    return res.status(201).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
}

module.exports = { preview, commit };
