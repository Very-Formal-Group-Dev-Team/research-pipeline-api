const db = require('../../../config/db');

async function createBranch(projectId, name, fromVersionId) {
  const { rows: vRows } = await db.query(
    'SELECT id FROM paper_versions WHERE id = ? AND project_id = ? LIMIT 1',
    [fromVersionId, projectId],
  );
  if (!vRows[0]) {
    const err = new Error('Version not found');
    err.status = 404;
    throw err;
  }

  try {
    await db.query(
      `INSERT INTO branches (id, project_id, name, head_version_id, created_from_version_id)
       VALUES (UUID(), ?, ?, ?, ?)`,
      [projectId, name, fromVersionId, fromVersionId],
    );
  } catch (dbErr) {
    if (dbErr.code === 'ER_DUP_ENTRY') {
      const err = new Error(`Branch "${name}" already exists`);
      err.status = 409;
      throw err;
    }
    throw dbErr;
  }

  const { rows } = await db.query(
    'SELECT * FROM branches WHERE project_id = ? AND name = ? LIMIT 1',
    [projectId, name],
  );
  return rows[0];
}

async function listBranches(projectId) {
  const { rows } = await db.query(
    `SELECT b.*,
            pv.commit_message AS head_commit_message,
            pv.created_at    AS head_commit_date,
            pv.version_number AS head_version_number,
            u.full_name       AS head_uploader_name,
            u.avatar_url      AS head_uploader_avatar
     FROM branches b
     LEFT JOIN paper_versions pv ON pv.id = b.head_version_id
     LEFT JOIN users u ON u.id = pv.uploaded_by
     WHERE b.project_id = ?
     ORDER BY (b.name = 'main') DESC, b.created_at ASC`,
    [projectId],
  );
  return rows;
}

async function getBranch(projectId, name) {
  const { rows } = await db.query(
    `SELECT b.*,
            pv.commit_message AS head_commit_message,
            pv.created_at    AS head_commit_date,
            pv.version_number AS head_version_number,
            u.full_name       AS head_uploader_name,
            u.avatar_url      AS head_uploader_avatar
     FROM branches b
     LEFT JOIN paper_versions pv ON pv.id = b.head_version_id
     LEFT JOIN users u ON u.id = pv.uploaded_by
     WHERE b.project_id = ? AND b.name = ?
     LIMIT 1`,
    [projectId, name],
  );
  return rows[0] || null;
}

async function deleteBranch(projectId, name) {
  if (name === 'main') {
    const err = new Error('The "main" branch cannot be deleted');
    err.status = 400;
    throw err;
  }

  const { rows } = await db.query(
    'SELECT id FROM branches WHERE project_id = ? AND name = ? LIMIT 1',
    [projectId, name],
  );
  if (!rows[0]) {
    const err = new Error('Branch not found');
    err.status = 404;
    throw err;
  }

  await db.query('DELETE FROM branches WHERE id = ?', [rows[0].id]);
}

module.exports = { createBranch, listBranches, getBranch, deleteBranch };
