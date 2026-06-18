const db = require('../../../config/db');
const notificationsService = require('../notifications/notifications.service');
const { isProjectLocked, getProjectById } = require('../projects/projects.service');
const coordinatorService = require('../coordinator/coordinator.service');

const NOTE_MIN_LENGTH = 20;
const NOTE_MAX_LENGTH = 500;

function mapReviewRequestRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    paper_version_id: row.paper_version_id,
    version_number: row.version_number,
    commit_message: row.commit_message,
    file_name: row.file_name,
    requested_by: row.requested_by,
    requester_name: row.requester_name,
    note: row.note,
    status: row.status,
    requested_at: row.requested_at,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    withdrawn_at: row.withdrawn_at,
    project_title: row.project_title,
  };
}

async function isAcceptedStudentMember(projectId, userId) {
  const { rows } = await db.query(
    `SELECT id FROM project_members
     WHERE project_id = ? AND user_id = ? AND status = 'accepted'
       AND role IN ('leader', 'member')
     LIMIT 1`,
    [projectId, userId],
  );
  return rows.length > 0;
}

async function isAcceptedAdviser(projectId, userId) {
  const { rows } = await db.query(
    `SELECT id FROM project_members
     WHERE project_id = ? AND user_id = ? AND status = 'accepted' AND role = 'adviser'
     LIMIT 1`,
    [projectId, userId],
  );
  return rows.length > 0;
}

async function isAcceptedProjectMember(projectId, userId) {
  const { rows } = await db.query(
    `SELECT id FROM project_members
     WHERE project_id = ? AND user_id = ? AND status = 'accepted'
     LIMIT 1`,
    [projectId, userId],
  );
  return rows.length > 0;
}

async function hasAcceptedAdviser(projectId) {
  const { rows } = await db.query(
    `SELECT id FROM project_members
     WHERE project_id = ? AND status = 'accepted' AND role = 'adviser'
     LIMIT 1`,
    [projectId],
  );
  return rows.length > 0;
}

async function getLatestRealUploadVersion(projectId) {
  const { rows } = await db.query(
    `SELECT id, version_number, commit_message, file_name, is_generated
     FROM paper_versions
     WHERE project_id = ? AND is_generated = 0
     ORDER BY version_number DESC
     LIMIT 1`,
    [projectId],
  );
  return rows[0] || null;
}

async function getActiveReviewRequest(projectId) {
  const { rows } = await db.query(
    `SELECT prr.*, pv.version_number, pv.commit_message, pv.file_name,
            u.full_name AS requester_name, p.title AS project_title
     FROM paper_review_requests prr
     JOIN paper_versions pv ON pv.id = prr.paper_version_id
     JOIN users u ON u.id = prr.requested_by
     JOIN projects p ON p.id = prr.project_id
     WHERE prr.project_id = ? AND prr.status = 'pending'
     LIMIT 1`,
    [projectId],
  );
  return mapReviewRequestRow(rows[0]);
}

async function getAdviserIds(projectId) {
  const { rows } = await db.query(
    `SELECT user_id FROM project_members
     WHERE project_id = ? AND status = 'accepted' AND role = 'adviser'`,
    [projectId],
  );
  return rows.map((row) => row.user_id).filter(Boolean);
}

async function notifyAdvisersReviewRequested({
  projectId,
  projectTitle,
  requesterName,
  versionNumber,
  commitMessage,
  requestId,
  paperVersionId,
  excludeUserId,
}) {
  const adviserIds = await getAdviserIds(projectId);
  const recipients = adviserIds.filter((id) => id && id !== excludeUserId);
  if (!recipients.length) return;

  const message = `${requesterName} requested your review on "${projectTitle}" (version ${versionNumber}): ${commitMessage}`;

  await Promise.all(
    recipients.map((userId) =>
      notificationsService.createNotification({
        userId,
        type: 'review_requested',
        title: 'Review requested',
        message,
        metadata: {
          projectId,
          paperVersionId,
          versionNumber,
          requestId,
        },
      }),
    ),
  );
}

async function getReviewRequestForMember(projectId, userId) {
  const isMember = await isAcceptedProjectMember(projectId, userId);
  const canView = isMember || (await coordinatorService.coordinatorCanViewProject(userId, projectId));
  if (!canView) {
    return { error: 'You are not a member of this project', status: 403 };
  }

  const data = await getActiveReviewRequest(projectId);
  return { data };
}

async function requestReview(projectId, versionId, userId, note) {
  const project = await getProjectById(projectId);
  if (!project) {
    return { error: 'Project not found', status: 404 };
  }

  if (isProjectLocked(project)) {
    return { error: 'Project is locked', status: 403 };
  }

  if (!(await isAcceptedStudentMember(projectId, userId))) {
    return { error: 'Only student members can request a review', status: 403 };
  }

  if (!(await hasAcceptedAdviser(projectId))) {
    return { error: 'Add an adviser to this project before requesting a review', status: 400 };
  }

  const latest = await getLatestRealUploadVersion(projectId);
  if (!latest) {
    return { error: 'No uploaded document is available for review', status: 400 };
  }

  if (latest.id !== versionId) {
    return { error: 'You can only request review on the latest uploaded version', status: 400 };
  }

  if (Number(latest.is_generated) === 1) {
    return { error: 'Template versions cannot be submitted for review', status: 400 };
  }

  const { rows: versionRows } = await db.query(
    `SELECT id FROM paper_versions WHERE id = ? AND project_id = ? LIMIT 1`,
    [versionId, projectId],
  );
  if (!versionRows.length) {
    return { error: 'Version not found', status: 404 };
  }

  const trimmedNote = note ? String(note).trim().slice(0, NOTE_MAX_LENGTH) : '';
  if (trimmedNote.length < NOTE_MIN_LENGTH) {
    return {
      error: `Focus note is required and must be at least ${NOTE_MIN_LENGTH} characters`,
      status: 400,
    };
  }

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    const [userRows] = await conn.execute(
      'SELECT full_name FROM users WHERE id = ? LIMIT 1',
      [userId],
    );
    const requesterName = userRows[0]?.full_name || 'A team member';

    await conn.execute(
      `UPDATE paper_review_requests
       SET status = 'superseded'
       WHERE project_id = ? AND status = 'pending'`,
      [projectId],
    );

    await conn.execute(
      `INSERT INTO paper_review_requests
         (project_id, paper_version_id, requested_by, note, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [projectId, versionId, userId, trimmedNote],
    );

    const [newRows] = await conn.execute(
      `SELECT id FROM paper_review_requests
       WHERE project_id = ? AND status = 'pending'
       ORDER BY requested_at DESC
       LIMIT 1`,
      [projectId],
    );
    const requestId = newRows[0]?.id;

    await conn.commit();

    await notifyAdvisersReviewRequested({
      projectId,
      projectTitle: project.title,
      requesterName,
      versionNumber: latest.version_number,
      commitMessage: latest.commit_message,
      requestId,
      paperVersionId: versionId,
      excludeUserId: userId,
    });

    const data = await getActiveReviewRequest(projectId);
    return { data };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function withdrawReviewRequest(projectId, userId) {
  const project = await getProjectById(projectId);
  if (!project) {
    return { error: 'Project not found', status: 404 };
  }

  if (isProjectLocked(project)) {
    return { error: 'Project is locked', status: 403 };
  }

  if (!(await isAcceptedStudentMember(projectId, userId))) {
    return { error: 'Only student members can withdraw a review request', status: 403 };
  }

  const active = await getActiveReviewRequest(projectId);
  if (!active) {
    return { error: 'No active review request for this project', status: 404 };
  }

  await db.query(
    `UPDATE paper_review_requests
     SET status = 'withdrawn', withdrawn_at = NOW()
     WHERE id = ? AND status = 'pending'`,
    [active.id],
  );

  return { data: { success: true } };
}

async function completeReviewRequest(projectId, userId, { force = false } = {}) {
  const project = await getProjectById(projectId);
  if (!project) {
    return { error: 'Project not found', status: 404 };
  }

  if (!(await isAcceptedAdviser(projectId, userId))) {
    return { error: 'Only project advisers can mark a review as complete', status: 403 };
  }

  const active = await getActiveReviewRequest(projectId);
  if (!active) {
    return { error: 'No active review request for this project', status: 404 };
  }

  const commentCounts = await require('../paper_comments/paper_comments.service')
    .getOpenCommentCountsForReview(projectId, active.paper_version_id);
  const unresolved = commentCounts.open + commentCounts.needs_revision;
  if (unresolved > 0 && !force) {
    return {
      error: 'Unresolved comments remain on this version',
      status: 409,
      data: {
        requiresConfirmation: true,
        commentCounts,
      },
    };
  }

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE paper_review_requests
       SET status = 'reviewed', reviewed_by = ?, reviewed_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [userId, active.id],
    );

    const [adviserRows] = await conn.execute(
      'SELECT full_name FROM users WHERE id = ? LIMIT 1',
      [userId],
    );
    const adviserName = adviserRows[0]?.full_name || 'Your adviser';

    await require('../paper_comments/paper_comments.service').linkCommentsToReviewOnComplete(
      projectId,
      active.id,
      active.paper_version_id,
    );

    await conn.commit();

    await notificationsService.createNotification({
      userId: active.requested_by,
      type: 'review_completed',
      title: 'Document reviewed',
      message: `${adviserName} reviewed your document for "${project.title}" (version ${active.version_number}).`,
      metadata: {
        projectId,
        paperVersionId: active.paper_version_id,
        versionNumber: active.version_number,
        requestId: active.id,
      },
    });

    return { data: { success: true, commentCounts } };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getReviewCommentSummary(projectId, userId) {
  const result = await getReviewRequestForMember(projectId, userId);
  if (result.error) {
    return result;
  }
  const active = result.data;
  if (!active) {
    return { data: { reviewRequest: null, commentCounts: null } };
  }
  const commentCounts = await require('../paper_comments/paper_comments.service')
    .getOpenCommentCountsForReview(projectId, active.paper_version_id);
  return { data: { reviewRequest: active, commentCounts } };
}

async function getPendingReviewsForAdviser(userId) {
  const { rows } = await db.query(
    `SELECT prr.id, prr.project_id, prr.paper_version_id, prr.requested_by, prr.note,
            prr.requested_at, pv.version_number, pv.commit_message, pv.file_name,
            p.title AS project_title, u.full_name AS requester_name
     FROM paper_review_requests prr
     JOIN paper_versions pv ON pv.id = prr.paper_version_id
     JOIN projects p ON p.id = prr.project_id
     JOIN users u ON u.id = prr.requested_by
     JOIN project_members pm ON pm.project_id = prr.project_id
       AND pm.user_id = ?
       AND pm.role = 'adviser'
       AND pm.status = 'accepted'
     WHERE prr.status = 'pending'
     ORDER BY prr.requested_at DESC`,
    [userId],
  );

  return rows.map((row) => ({
    id: row.id,
    project_id: row.project_id,
    project_title: row.project_title,
    paper_version_id: row.paper_version_id,
    version_number: row.version_number,
    commit_message: row.commit_message,
    file_name: row.file_name,
    requested_by: row.requested_by,
    requester_name: row.requester_name,
    note: row.note,
    requested_at: row.requested_at,
  }));
}

module.exports = {
  getActiveReviewRequest,
  getReviewRequestForMember,
  getReviewCommentSummary,
  requestReview,
  withdrawReviewRequest,
  completeReviewRequest,
  getPendingReviewsForAdviser,
};
