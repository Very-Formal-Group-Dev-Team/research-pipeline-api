const db = require('../../../config/db');
const { getProjectDefenseSchedules } = require('../defenses/defenses.service');
const { getEventsForInstitution } = require('../events/events.service');

const STATUS_LABEL_CASE = `
  CASE
    WHEN d.status = 'scheduled' THEN 'Scheduled'
    WHEN d.status = 'pending' THEN 'Pending'
    WHEN d.status = 'cancelled' THEN 'Cancelled'
    WHEN d.status = 'rescheduled' THEN 'Rescheduled'
    WHEN d.status = 'completed' THEN 'Completed'
    ELSE d.status
  END AS status_label`;

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

async function getMeetingsForMember(userId) {
  const { rows } = await db.query(
    `SELECT d.id,
            d.project_id,
            p.title AS project_title,
            p.project_code,
            d.defense_type,
            d.scheduled_at AS start_time,
            COALESCE(d.end_time, d.scheduled_at) AS end_time,
            d.location,
            d.modality,
            d.status,
            d.created_by,
            ${STATUS_LABEL_CASE},
            u.full_name AS created_by_name,
            d.created_at
     FROM meetings d
     INNER JOIN projects p ON d.project_id = p.id
     INNER JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     LEFT JOIN users u ON d.created_by = u.id
     ORDER BY d.scheduled_at DESC, d.created_at DESC`,
    [userId]
  );
  return rows;
}

function splitScheduleRows(rows) {
  const defenses = [];
  const meetings = [];
  for (const row of rows) {
    if (row.schedule_source === 'meeting') {
      meetings.push(row);
    } else {
      defenses.push(row);
    }
  }
  return { defenses, meetings };
}

async function getMySchedule(userId) {
  const [combined, events] = await Promise.all([
    getProjectDefenseSchedules(userId),
    getEventsForUser(userId),
  ]);

  const { defenses, meetings } = splitScheduleRows(combined);
  return { defenses, meetings, events };
}

module.exports = {
  getMySchedule,
  getEventsForUser,
  getMeetingsForMember,
};
