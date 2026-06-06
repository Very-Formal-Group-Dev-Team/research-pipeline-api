const db = require('../../../config/db');

const NOTIFICATION_TYPES = new Set([
  'invitation',
  'schedule',
  'defense_approved',
  'defense_rejected',
  'defense_moved',
  'event',
  'project_stage_updated',
  'join_request',
  'member_left',
  'ownership_transferred',
]);

function parseNotificationMetadata(metadata) {
  if (!metadata) return null;
  if (typeof metadata === 'object') return metadata;
  try {
    return JSON.parse(metadata);
  } catch {
    return null;
  }
}

async function findUnreadProjectStageNotification({ userId, projectId, conn = null }) {
  const sql = `
    SELECT id, metadata
    FROM notifications
    WHERE user_id = ?
      AND type = 'project_stage_updated'
      AND is_read = 0
      AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.projectId')) = ?
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (conn) {
    const [rows] = await conn.execute(sql, [userId, projectId]);
    return rows[0] || null;
  }

  const { rows } = await db.query(sql, [userId, projectId]);
  return rows[0] || null;
}

function buildProjectStageNotificationMessage({
  adviserName,
  projectTitle,
  newStage,
  previousStage,
  formatStageLabel,
}) {
  const label = typeof formatStageLabel === 'function'
    ? formatStageLabel
    : (stage) => stage;
  const newLabel = label(newStage);
  const previousLabel = label(previousStage);
  if (previousStage && previousStage !== newStage) {
    return `${adviserName} updated the research stage for "${projectTitle}" to ${newLabel} (was ${previousLabel}).`;
  }
  return `${adviserName} updated the research stage for "${projectTitle}" to ${newLabel}.`;
}

/**
 * Create or refresh a single unread stage notification per user + project.
 * Preserves the original previousStage from the first unread alert in a burst.
 */
async function upsertUnreadProjectStageNotification({
  userId,
  projectId,
  title,
  adviserName,
  projectTitle,
  newStage,
  previousStage,
  updatedByUserId,
  formatStageLabel,
  conn = null,
}) {
  const existing = await findUnreadProjectStageNotification({ userId, projectId, conn });
  const existingMeta = existing ? parseNotificationMetadata(existing.metadata) : null;
  const baselinePreviousStage = existingMeta?.previousStage ?? previousStage;

  const message = buildProjectStageNotificationMessage({
    adviserName,
    projectTitle,
    newStage,
    previousStage: baselinePreviousStage,
    formatStageLabel,
  });

  const metadata = {
    projectId,
    previousStage: baselinePreviousStage,
    newStage,
    updatedByUserId,
  };

  if (existing) {
    const metadataJson = JSON.stringify(metadata);
    const updateSql = `
      UPDATE notifications
      SET title = ?, message = ?, metadata = ?, created_at = NOW()
      WHERE id = ?
    `;
    const params = [title, message, metadataJson, existing.id];

    if (conn) {
      await conn.execute(updateSql, params);
    } else {
      await db.query(updateSql, params);
    }

    return { action: 'updated', id: existing.id };
  }

  await createNotification({
    userId,
    type: 'project_stage_updated',
    title,
    message,
    metadata,
    conn,
  });

  return { action: 'created' };
}

async function createNotification({ userId, type, title, message, metadata, conn = null }) {
  const notificationType = NOTIFICATION_TYPES.has(type) ? type : 'invitation';

  const sql = `INSERT INTO notifications (user_id, type, title, message, metadata)
     VALUES (?, ?, ?, ?, ?)`;
  const params = [userId, notificationType, title, message, metadata ? JSON.stringify(metadata) : null];

  if (conn) {
    // Use execute (prepared statement) to stay consistent with the caller's transaction
    await conn.execute(sql, params);
  } else {
    await db.query(sql, params);
  }
}

async function getNotificationsForUser(userId, { limit = 50 } = {}) {
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 50;
  const { rows } = await db.query(
    `SELECT id, user_id, type, title, message, metadata, is_read, read_at, created_at
     FROM notifications
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ${safeLimit}`,
    [userId]
  );

  return rows.map((row) => {
    let parsedMetadata = row.metadata || null;
    if (typeof row.metadata === 'string') {
      try {
        parsedMetadata = JSON.parse(row.metadata);
      } catch {
        parsedMetadata = null;
      }
    }

    return {
      ...row,
      metadata: parsedMetadata,
      is_read: Boolean(row.is_read),
    };
  });
}

async function markNotificationAsRead(notificationId, userId) {
  const { rows } = await db.query(
    `UPDATE notifications
     SET is_read = 1, read_at = NOW()
     WHERE id = ? AND user_id = ?`,
    [notificationId, userId]
  );
  return rows;
}

async function markAllNotificationsAsRead(userId) {
  const { rows } = await db.query(
    `UPDATE notifications
     SET is_read = 1, read_at = NOW()
     WHERE user_id = ? AND is_read = 0`,
    [userId]
  );
  return rows;
}

/** Remove pending project-invitation alerts for a user (e.g. when an invite is reverted). */
async function deleteProjectInvitationNotifications({ userId, projectId, invitationId, conn = null }) {
  const queryRunner = conn || db;
  const params = [userId, invitationId, projectId];

  if (conn) {
    await conn.execute(
      `DELETE FROM notifications
       WHERE user_id = ?
         AND type = 'invitation'
         AND (
           JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.invitationId')) = ?
           OR (
             JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.projectId')) = ?
             AND title = 'Project invitation'
           )
         )`,
      params,
    );
    return;
  }

  await queryRunner.query(
    `DELETE FROM notifications
     WHERE user_id = ?
       AND type = 'invitation'
       AND (
         JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.invitationId')) = ?
         OR (
           JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.projectId')) = ?
           AND title = 'Project invitation'
         )
       )`,
    params,
  );
}

/** Remove join-request alerts for a project leader when a request is resolved. */
async function deleteJoinRequestNotifications({ userId, projectId, memberId, conn = null }) {
  const queryRunner = conn || db;
  const params = [userId, memberId, projectId];

  const sql = `DELETE FROM notifications
     WHERE user_id = ?
       AND type = 'join_request'
       AND (
         JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.memberId')) = ?
         OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.projectId')) = ?
       )`;

  if (conn) {
    await conn.execute(sql, params);
    return;
  }

  await queryRunner.query(sql, params);
}

module.exports = {
  createNotification,
  findUnreadProjectStageNotification,
  upsertUnreadProjectStageNotification,
  getNotificationsForUser,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteProjectInvitationNotifications,
  deleteJoinRequestNotifications,
};
