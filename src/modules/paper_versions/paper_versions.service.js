const { randomUUID } = require('crypto');
const db = require('../../../config/db');
const notificationsService = require('../notifications/notifications.service');
const { resolveFilePath, extractText } = require('./paper_text.util');

/** Bump project.updated_at (timeline "Last updated" on project detail pages). */
async function touchProjectUpdatedAt(projectId) {
  await db.query('UPDATE projects SET updated_at = NOW() WHERE id = ?', [projectId]);
}

async function notifyStudentMembersOfPaperCommit({
  projectId,
  versionNumber,
  commitMessage,
  uploadedBy,
  fileName,
}) {
  const { rows: contextRows } = await db.query(
    `SELECT p.title, u.full_name AS uploader_name
     FROM projects p
     JOIN users u ON u.id = ?
     WHERE p.id = ?
     LIMIT 1`,
    [uploadedBy, projectId],
  );

  const projectTitle = contextRows[0]?.title || 'your project';
  const uploaderName = contextRows[0]?.uploader_name || 'A team member';

  const { rows: memberRows } = await db.query(
    `SELECT user_id
     FROM project_members
     WHERE project_id = ?
       AND status = 'accepted'
       AND role IN ('leader', 'member')
       AND user_id != ?`,
    [projectId, uploadedBy],
  );

  const recipients = memberRows.map((row) => row.user_id).filter(Boolean);
  if (!recipients.length) return;

  const message = `${uploaderName} committed version ${versionNumber} to "${projectTitle}": ${commitMessage}`;

  await Promise.all(
    recipients.map((userId) =>
      notificationsService.createNotification({
        userId,
        type: 'paper_version_committed',
        title: 'New document commit',
        message,
        metadata: {
          projectId,
          versionNumber,
          commitMessage,
          uploadedBy,
          fileName,
        },
      }),
    ),
  );
}

/** Insert a new paper version row.
 *
 * branchId      – target branch id; omit to auto-resolve the project's "main" branch.
 * parentVersionId – explicit parent; omit to use the branch's current head.
 *
 * version_number is assigned inside a transaction with SELECT…FOR UPDATE on the branch
 * row so concurrent commits to the same branch cannot produce duplicate numbers.
 */
async function createPaperVersion({
  projectId,
  fileUrl,
  fileName,
  fileSize,
  mimeType,
  commitMessage,
  tag,
  uploadedBy,
  isGenerated,
  branchId,
  parentVersionId,
}) {
  let contentText = null;
  try {
    const filePath = resolveFilePath(fileUrl);
    contentText = await extractText(filePath);
  } catch {
    // non-critical — proceed without stored text
  }

  const newVersionId = randomUUID();
  let versionNumber;

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    let resolvedBranchId = branchId || null;
    let resolvedParentVersionId = parentVersionId !== undefined ? parentVersionId : undefined;

    if (!resolvedBranchId) {
      await conn.execute(
        'INSERT IGNORE INTO branches (id, project_id, name) VALUES (?, ?, ?)',
        [randomUUID(), projectId, 'main'],
      );
    }

    const [branchRows] = await conn.execute(
      resolvedBranchId
        ? 'SELECT id, head_version_id FROM branches WHERE id = ? LIMIT 1 FOR UPDATE'
        : 'SELECT id, head_version_id FROM branches WHERE project_id = ? AND name = ? LIMIT 1 FOR UPDATE',
      resolvedBranchId ? [resolvedBranchId] : [projectId, 'main'],
    );

    if (!branchRows[0]) {
      throw new Error(`Branch not found for project ${projectId}`);
    }

    resolvedBranchId = branchRows[0].id;
    if (resolvedParentVersionId === undefined) {
      resolvedParentVersionId = branchRows[0].head_version_id || null;
    }

    const [countRows] = await conn.execute(
      'SELECT COALESCE(MAX(version_number), 0) AS max_v FROM paper_versions WHERE branch_id = ?',
      [resolvedBranchId],
    );
    versionNumber = (countRows[0]?.max_v ?? 0) + 1;

    await conn.execute(
      `INSERT INTO paper_versions
         (id, project_id, version_number, file_url, file_name, file_size, mime_type,
          commit_message, tag, uploaded_by, is_generated,
          branch_id, parent_version_id, content_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newVersionId,
        projectId,
        versionNumber,
        fileUrl,
        fileName,
        fileSize,
        mimeType || null,
        commitMessage,
        tag || null,
        uploadedBy,
        isGenerated ? 1 : 0,
        resolvedBranchId,
        resolvedParentVersionId || null,
        contentText,
      ],
    );

    await conn.execute(
      'UPDATE branches SET head_version_id = ? WHERE id = ?',
      [newVersionId, resolvedBranchId],
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await touchProjectUpdatedAt(projectId);

  await notifyStudentMembersOfPaperCommit({
    projectId,
    versionNumber,
    commitMessage,
    uploadedBy,
    fileName,
  });

  return versionNumber;
}

/** Return all versions for a project, newest first. */
async function getPaperVersions(projectId) {
  const { rows } = await db.query(
    `SELECT pv.*, u.full_name AS uploader_name, u.avatar_url AS uploader_avatar
     FROM paper_versions pv
     JOIN users u ON u.id = pv.uploaded_by
     WHERE pv.project_id = ?
     ORDER BY pv.version_number DESC`,
    [projectId],
  );
  return rows;
}

/** Return a single version by id, scoped to a project for safety. */
async function getPaperVersionById(projectId, versionId) {
  const { rows } = await db.query(
    `SELECT pv.*, u.full_name AS uploader_name
     FROM paper_versions pv
     JOIN users u ON u.id = pv.uploaded_by
     WHERE pv.id = ? AND pv.project_id = ?
     LIMIT 1`,
    [versionId, projectId],
  );
  return rows[0] || null;
}

async function getProjectTemplateData(projectId) {
  const { rows } = await db.query(
    `SELECT p.*, i.name AS institution_name, creator.full_name AS creator_name, creator.email AS creator_email
     FROM projects p
     LEFT JOIN institutions i ON i.id = p.institution_id
     LEFT JOIN users creator ON creator.id = p.created_by
     WHERE p.id = ?
     LIMIT 1`,
    [projectId],
  );

  const project = rows[0] || null;
  if (!project) {
    return null;
  }

  const { rows: memberRows } = await db.query(
    `SELECT pm.role, pm.status, u.full_name, u.email
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ? AND pm.status = 'accepted'
     ORDER BY CASE pm.role WHEN 'leader' THEN 0 WHEN 'adviser' THEN 1 ELSE 2 END, pm.invited_at ASC`,
    [projectId],
  );

  return {
    project,
    members: memberRows,
    institution: project.institution_name ? { name: project.institution_name } : null,
  };
}

/** Check whether the current user is a member of the project. */
async function isProjectMember(projectId, userId) {
  const { rows } = await db.query(
    `SELECT id FROM project_members
     WHERE project_id = ? AND user_id = ? AND status = 'accepted'
     LIMIT 1`,
    [projectId, userId],
  );
  return rows.length > 0;
}

async function getPreviousVersion(projectId, versionNumber) {
  const { rows } = await db.query(
    `SELECT pv.*, u.full_name AS uploader_name
     FROM paper_versions pv
     JOIN users u ON u.id = pv.uploaded_by
     WHERE pv.project_id = ? AND pv.version_number < ?
     ORDER BY pv.version_number DESC
     LIMIT 1`,
    [projectId, versionNumber],
  );
  return rows[0] || null;
}

/** Walk parent_version_id pointers from versionId to the root.
 * Returns rows ordered from the given version to the oldest ancestor.
 * Not currently wired to any endpoint — available for future branch/diff features.
 */
async function getVersionAncestry(versionId) {
  const chain = [];
  let currentId = versionId;
  const seen = new Set();
  const MAX_DEPTH = 1000;

  while (currentId && chain.length < MAX_DEPTH) {
    if (seen.has(currentId)) break;
    seen.add(currentId);

    const { rows } = await db.query(
      `SELECT id, project_id, branch_id, version_number, parent_version_id,
              commit_message, tag, uploaded_by, created_at
       FROM paper_versions
       WHERE id = ?
       LIMIT 1`,
      [currentId],
    );

    if (!rows[0]) break;
    chain.push(rows[0]);
    currentId = rows[0].parent_version_id || null;
  }

  return chain;
}

module.exports = {
  createPaperVersion,
  getPaperVersions,
  getPaperVersionById,
  getPreviousVersion,
  getVersionAncestry,
  isProjectMember,
  getProjectTemplateData,
};
