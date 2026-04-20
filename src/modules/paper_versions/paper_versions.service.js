const db = require('../../../config/db');

/** Return the next version number for a project (max + 1, or 1 if none). */
async function getNextVersionNumber(projectId) {
  const { rows } = await db.query(
    'SELECT COALESCE(MAX(version_number), 0) AS max_v FROM paper_versions WHERE project_id = ?',
    [projectId],
  );
  return (rows[0]?.max_v ?? 0) + 1;
}

/** Insert a new paper version row. */
async function createPaperVersion({ projectId, fileUrl, fileName, fileSize, mimeType, commitMessage, tag, uploadedBy, isGenerated }) {
  const versionNumber = await getNextVersionNumber(projectId);

  await db.query(
    `INSERT INTO paper_versions
       (project_id, version_number, file_url, file_name, file_size, mime_type,
        commit_message, tag, uploaded_by, is_generated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
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
    ],
  );

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

module.exports = { createPaperVersion, getPaperVersions, getPaperVersionById, getPreviousVersion, isProjectMember };
