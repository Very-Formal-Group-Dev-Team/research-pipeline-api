const db = require('../../../config/db');
const { createNotification } = require('../notifications/notifications.service');
const { getScheduleWindow } = require('../defenses/defenses.service');

function normalizeEventRow(row) {
  if (!row) return row;
  return {
    ...row,
    start_time: row.start_time,
    end_time: row.end_time,
  };
}

async function getInstitutionMemberIds(institutionId, queryRunner) {
  const sql = `SELECT DISTINCT user_id
               FROM user_roles
               WHERE institution_id = ?
                 AND role IN ('student', 'adviser', 'coordinator')`;
  const params = [institutionId];

  if (typeof queryRunner.execute === 'function') {
    const [rows] = await queryRunner.execute(sql, params);
    return rows.map((row) => row.user_id).filter(Boolean);
  }

  const { rows } = await queryRunner.query(sql, params);
  return rows.map((row) => row.user_id).filter(Boolean);
}

async function notifyInstitutionMembers({
  institutionId,
  excludeUserId = null,
  type,
  title,
  message,
  metadata,
  conn = null,
}) {
  const queryRunner = conn || db;
  const userIds = await getInstitutionMemberIds(institutionId, queryRunner);
  const recipients = userIds.filter((id) => id && id !== excludeUserId);
  if (!recipients.length) return;

  await Promise.all(
    recipients.map((userId) =>
      createNotification({
        userId,
        type,
        title,
        message,
        metadata,
        conn,
      })
    )
  );
}

async function getEventsForInstitution(institutionId) {
  const { rows } = await db.query(
    `SELECT e.*, u.full_name AS created_by_name
     FROM events e
     LEFT JOIN users u ON e.created_by = u.id
     WHERE e.institution_id = ?
     ORDER BY e.start_time DESC`,
    [institutionId]
  );
  return rows.map(normalizeEventRow);
}

async function createInstitutionEvent(institutionId, userId, payload) {
  const { title, description, location, modality } = payload;
  const scheduleWindow = getScheduleWindow(payload);

  if (!title || typeof title !== 'string' || !title.trim()) {
    return { error: 'title is required' };
  }
  if (scheduleWindow.error) return { error: scheduleWindow.error };
  if (!location || typeof location !== 'string' || !location.trim()) {
    return { error: 'location is required' };
  }

  const normalizedTitle = title.trim().slice(0, 255);
  const normalizedLocation = location.trim().slice(0, 512);
  const normalizedDescription =
    description && typeof description === 'string' ? description.trim().slice(0, 5000) : null;
  const normalizedModality = ['Online', 'In-Person', 'Hybrid'].includes(modality)
    ? modality
    : 'Online';

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    const [overlapRows] = await conn.execute(
      `SELECT id, title, start_time, end_time
       FROM events
       WHERE institution_id = ?
         AND status = 'scheduled'
         AND start_time < ?
         AND end_time > ?`,
      [
        institutionId,
        scheduleWindow.end.dbValue,
        scheduleWindow.start.dbValue,
      ]
    );

    if (overlapRows.length) {
      await conn.rollback();
      return {
        error: 'Schedule overlap detected with another institution event',
        status: 409,
      };
    }

    const [idRows] = await conn.execute('SELECT UUID() AS id');
    const eventId = idRows[0].id;

    await conn.execute(
      `INSERT INTO events (
        id, institution_id, title, description, start_time, end_time,
        location, modality, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
      [
        eventId,
        institutionId,
        normalizedTitle,
        normalizedDescription,
        scheduleWindow.start.dbValue,
        scheduleWindow.end.dbValue,
        normalizedLocation,
        normalizedModality,
        userId,
      ]
    );

    const [rows] = await conn.execute(
      `SELECT e.*, u.full_name AS created_by_name
       FROM events e
       LEFT JOIN users u ON e.created_by = u.id
       WHERE e.id = ?
       LIMIT 1`,
      [eventId]
    );

    const event = rows[0];
    const startLabel = scheduleWindow.start.dateValue.toLocaleString();

    await notifyInstitutionMembers({
      institutionId,
      excludeUserId: userId,
      type: 'event',
      title: 'New institution event',
      message: `"${normalizedTitle}" is scheduled for ${startLabel} at ${normalizedLocation}.`,
      metadata: { eventId, institutionId, status: 'scheduled' },
      conn,
    });

    await conn.commit();
    return { data: normalizeEventRow(event) };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function cancelInstitutionEvent(eventId, institutionId, userId) {
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      'SELECT * FROM events WHERE id = ? AND institution_id = ? LIMIT 1',
      [eventId, institutionId]
    );
    const event = rows[0];
    if (!event) {
      await conn.rollback();
      return { error: 'Event not found', status: 404 };
    }
    if (event.status === 'cancelled') {
      await conn.rollback();
      return { data: normalizeEventRow(event) };
    }

    await conn.execute(
      `UPDATE events SET status = 'cancelled', updated_at = NOW() WHERE id = ?`,
      [eventId]
    );

    const [updatedRows] = await conn.execute(
      `SELECT e.*, u.full_name AS created_by_name
       FROM events e
       LEFT JOIN users u ON e.created_by = u.id
       WHERE e.id = ?
       LIMIT 1`,
      [eventId]
    );

    await notifyInstitutionMembers({
      institutionId,
      excludeUserId: userId,
      type: 'event',
      title: 'Institution event cancelled',
      message: `"${event.title}" was cancelled.`,
      metadata: { eventId, institutionId, status: 'cancelled' },
      conn,
    });

    await conn.commit();
    return { data: normalizeEventRow(updatedRows[0]) };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  getEventsForInstitution,
  createInstitutionEvent,
  cancelInstitutionEvent,
};
