const db = require('../../../config/db');
const { getProjectDefenseSchedules } = require('../defenses/defenses.service');
const { getEventsForInstitution } = require('../events/events.service');

function statusLabelCase(alias) {
  return `
  CASE
    WHEN ${alias}.status = 'scheduled' THEN 'Scheduled'
    WHEN ${alias}.status = 'pending' THEN 'Pending'
    WHEN ${alias}.status = 'cancelled' THEN 'Cancelled'
    WHEN ${alias}.status = 'rescheduled' THEN 'Rescheduled'
    WHEN ${alias}.status = 'completed' THEN 'Completed'
    ELSE ${alias}.status
  END AS status_label`;
}

async function getUserInstitutionIds(userId) {
  const { rows } = await db.query(
    `SELECT DISTINCT institution_id
     FROM user_roles
     WHERE user_id = ?
       AND institution_id IS NOT NULL`,
    [userId]
  );
  return rows.map((row) => row.institution_id).filter(Boolean);
}

async function getEventsForUser(userId) {
  const institutionIds = await getUserInstitutionIds(userId);
  if (!institutionIds.length) return [];

  const placeholders = institutionIds.map(() => '?').join(', ');
  const { rows } = await db.query(
    `SELECT e.*, u.full_name AS created_by_name
     FROM events e
     LEFT JOIN users u ON e.created_by = u.id
     WHERE e.institution_id IN (${placeholders})
       AND e.status != 'cancelled'
     ORDER BY e.start_time ASC`,
    institutionIds
  );
  return rows;
}

/**
 * All adviser-booked meetings for projects the user belongs to (every status).
 * Used for meeting lists with status filters; calendar uses getProjectDefenseSchedules.
 */
async function getMeetingsForMember(userId) {
  const { rows } = await db.query(
    `SELECT m.id,
            m.project_id,
            p.title AS project_title,
            p.project_code,
            m.defense_type,
            m.meeting_title,
            m.scheduled_at AS start_time,
            COALESCE(m.end_time, m.scheduled_at) AS end_time,
            m.location,
            m.venue,
            m.modality,
            m.status,
            m.created_by,
            m.meeting_room,
            m.meeting_url,
            m.meeting_provider,
            'meeting' AS schedule_source,
            ${statusLabelCase('m')},
            u.full_name AS created_by_name,
            (
              SELECT u2.full_name
              FROM project_members pm2
              INNER JOIN users u2 ON u2.id = pm2.user_id
              WHERE pm2.project_id = m.project_id
                AND pm2.role = 'adviser'
                AND pm2.status = 'accepted'
              ORDER BY pm2.invited_at ASC
              LIMIT 1
            ) AS adviser_name,
            m.created_at
     FROM meetings m
     INNER JOIN projects p ON m.project_id = p.id
     INNER JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ? AND pm.status = 'accepted'
     LEFT JOIN users u ON m.created_by = u.id
     ORDER BY m.scheduled_at DESC, m.created_at DESC`,
    [userId]
  );
  return rows;
}

async function getMySchedule(userId) {
  const [combined, meetings, events] = await Promise.all([
    getProjectDefenseSchedules(userId),
    getMeetingsForMember(userId),
    getEventsForUser(userId),
  ]);

  const defenses = combined.filter((row) => row.schedule_source !== 'meeting');
  return { defenses, meetings, events };
}

module.exports = {
  getMySchedule,
  getEventsForUser,
  getMeetingsForMember,
};
