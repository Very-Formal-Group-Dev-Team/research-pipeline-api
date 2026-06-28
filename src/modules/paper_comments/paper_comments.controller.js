const paperCommentsService = require('./paper_comments.service');

async function list(req, res) {
  const projectId = req.params.id;
  const { versionId, status } = req.query;
  const result = await paperCommentsService.listComments(projectId, req.user.id, {
    versionId: versionId ? String(versionId) : undefined,
    status: status ? String(status) : undefined,
  });
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function summary(req, res) {
  const projectId = req.params.id;
  const result = await paperCommentsService.getCommentSummary(projectId, req.user.id);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function create(req, res) {
  const projectId = req.params.id;
  const { versionId, anchor, body, parentId } = req.body || {};
  if (!versionId) {
    return res.status(400).json({ error: 'versionId is required' });
  }
  const result = await paperCommentsService.createComment(projectId, req.user.id, {
    versionId: String(versionId),
    anchor,
    body,
    parentId: parentId ? String(parentId) : undefined,
  });
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.status(result.status || 201).json(result.data);
}

async function update(req, res) {
  const { id: projectId, commentId } = req.params;
  const { body, visibility } = req.body || {};
  const result = await paperCommentsService.updateComment(projectId, commentId, req.user.id, {
    body,
    visibility,
  });
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function resolve(req, res) {
  const { id: projectId, commentId } = req.params;
  const result = await paperCommentsService.resolveComment(projectId, commentId, req.user.id);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function requestRevision(req, res) {
  const { id: projectId, commentId } = req.params;
  const result = await paperCommentsService.requestRevision(projectId, commentId, req.user.id);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function reopen(req, res) {
  const { id: projectId, commentId } = req.params;
  const result = await paperCommentsService.reopenComment(projectId, commentId, req.user.id);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

async function remove(req, res) {
  const { id: projectId, commentId } = req.params;
  const result = await paperCommentsService.deleteComment(projectId, commentId, req.user.id);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
}

module.exports = {
  list,
  summary,
  create,
  update,
  resolve,
  requestRevision,
  reopen,
  remove,
};
