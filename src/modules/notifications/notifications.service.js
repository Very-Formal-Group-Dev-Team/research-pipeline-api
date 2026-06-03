const db = require('../../../config/db');

const NOTIFICATION_TYPES = new Set([
  'invitation',
  'schedule',
  'defense_approved',
  'defense_rejected',
  'defense_moved',
  'event',
]);

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

module.exports = {
  createNotification,
  getNotificationsForUser,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteProjectInvitationNotifications,
};
