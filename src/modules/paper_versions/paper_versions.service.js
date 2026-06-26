const db = require('../../../config/db');
const notificationsService = require('../notifications/notifications.service');

/** Return the next version number for a project (max + 1, or 1 if none). */
async function getNextVersionNumber(projectId) {
  const { rows } = await db.query(
    'SELECT COALESCE(MAX(version_number), 0) AS max_v FROM paper_versions WHERE project_id = ?',
    [projectId],
  );
  return (rows[0]?.max_v ?? 0) + 1;
}

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

/** Insert a new paper version row. */
async function createPaperVersion({ projectId, fileUrl, fileName, fileSize, mimeType, commitMessage, tag, uploadedBy, isGenerated }) {
  const connection = await db.pool.getConnection();
  let versionNumber;

  try {
    await connection.beginTransaction();

    const [maxRows] = await connection.execute(
      'SELECT COALESCE(MAX(version_number), 0) AS max_v FROM paper_versions WHERE project_id = ? FOR UPDATE',
      [projectId],
    );
    versionNumber = (maxRows[0]?.max_v ?? 0) + 1;

    await connection.execute(
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

    await connection.execute('UPDATE projects SET updated_at = NOW() WHERE id = ?', [projectId]);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

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

module.exports = { createPaperVersion, getPaperVersions, getPaperVersionById, getPreviousVersion, isProjectMember, getProjectTemplateData };
