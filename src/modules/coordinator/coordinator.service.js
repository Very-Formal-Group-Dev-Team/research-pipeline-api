const crypto = require('crypto');
const db = require('../../../config/db');
const { createNotification } = require('../notifications/notifications.service');
const { validateScheduleConstraints, getScheduleWindow } = require('../defenses/defenses.service');
const {
  JITSI_DEFENSE_PREFIX,
  createJitsiMeetingFields,
  appendMeetingLinkToMessage,
} = require('../../lib/jitsi');

let defenseScheduleExprCache = null;

async function getInstitutionUserIdsByRoles(institutionId, roles, queryRunner = db) {
  if (!institutionId || !Array.isArray(roles) || !roles.length) return [];
  const placeholders = roles.map(() => '?').join(', ');
  const sql = `SELECT DISTINCT user_id
               FROM user_roles
               WHERE institution_id = ?
                 AND role IN (${placeholders})`;
  const params = [institutionId, ...roles];

  if (typeof queryRunner.execute === 'function') {
    const [rows] = await queryRunner.execute(sql, params);
    return rows.map((row) => row.user_id).filter(Boolean);
  }

  const { rows } = await queryRunner.query(sql, params);
  return rows.map((row) => row.user_id).filter(Boolean);
}

async function notifyUsers(userIds, payload, conn = null) {
  const recipients = Array.from(new Set((userIds || []).filter(Boolean)));
  if (!recipients.length) return;

  await Promise.all(
    recipients.map((userId) => createNotification({
      userId,
      type: 'schedule',
      ...payload,
      conn,
    }))
  );
}

async function notifyInstitutionCoordinators({ institutionId, excludeUserId, payload, conn = null }) {
  const userIds = await getInstitutionUserIdsByRoles(institutionId, ['coordinator'], conn || db);
  const recipients = userIds.filter((userId) => userId !== excludeUserId);
  await notifyUsers(recipients, payload, conn);
}

/** Projects/defenses visible to a coordinator (institution id, linked course, or course-assigned advisers). */
function coordinatorProjectScopeSql(projectAlias = 'p', courseAlias = 'c') {
  return `(
    ${projectAlias}.institution_id = ?
    OR ${courseAlias}.institution_id = ?
    OR EXISTS (
      SELECT 1
      FROM project_members pm_scope
      INNER JOIN course_advisers ca_scope ON ca_scope.user_id = pm_scope.user_id
      INNER JOIN courses c_scope ON c_scope.id = ca_scope.course_id AND c_scope.institution_id = ?
      WHERE pm_scope.project_id = ${projectAlias}.id
        AND pm_scope.role = 'adviser'
        AND pm_scope.status = 'accepted'
    )
  )`;
}

function coordinatorProjectScopeBinds(institutionId) {
  return [institutionId, institutionId, institutionId];
}

async function getDefenseScheduleExpr() {
  if (defenseScheduleExprCache) {
    return defenseScheduleExprCache;
  }

  const { rows } = await db.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'defenses'`
  );

  const columns = new Set(rows.map((row) => row.COLUMN_NAME));
  const scheduleCandidates = [];

  if (columns.has('scheduled_at')) scheduleCandidates.push('d.scheduled_at');
  if (columns.has('verified_schedule')) scheduleCandidates.push('d.verified_schedule');
  if (columns.has('proposed_schedule')) scheduleCandidates.push('d.proposed_schedule');
  scheduleCandidates.push('d.created_at');

  defenseScheduleExprCache = scheduleCandidates.length === 1
    ? scheduleCandidates[0]
    : `COALESCE(${scheduleCandidates.join(', ')})`;

  return defenseScheduleExprCache;
}

function normalizeDefenseTimeRange(row) {
  const start = row.start_time || row.scheduled_at || null;
  const end = row.end_time || start;

  return {
    ...row,
    start_time: start,
    end_time: end,
  };
}

function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (value == null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateToDbUtc(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function normalizeDateTimeInput(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      dbValue: formatDateToDbUtc(value),
      dateValue: value,
    };
  }

  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Keep local wall-clock values unchanged for DATETIME columns.
  const localNoZone = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/;
  const localMatch = trimmed.match(localNoZone);
  if (localMatch) {
    const datePart = localMatch[1];
    const timePart = localMatch[2];
    const secondsPart = localMatch[3] || ':00';
    const parsed = toDate(`${datePart}T${timePart}${secondsPart}`);
    if (!parsed) return null;

    return {
      dbValue: `${datePart} ${timePart}${secondsPart}`,
      dateValue: parsed,
    };
  }

  const parsed = toDate(trimmed);
  if (!parsed) return null;

  return {
    dbValue: formatDateToDbUtc(parsed),
    dateValue: parsed,
  };
}

function computeOverlapMinutes(rangeStart, rangeEnd, candidateStart, candidateEnd) {
  const overlapStart = Math.max(rangeStart.getTime(), candidateStart.getTime());
  const overlapEnd = Math.min(rangeEnd.getTime(), candidateEnd.getTime());
  if (overlapEnd <= overlapStart) return 0;
  return Math.round((overlapEnd - overlapStart) / 60000);
}

function buildCoordinatorConflictPayload(conflicts, startDate, endDate) {
  const candidateTotalMinutes = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));

  const normalizedConflicts = conflicts.map((conflict) => {
    const overlapMinutes = computeOverlapMinutes(conflict.start_date, conflict.end_date, startDate, endDate);
    return {
      domain: conflict.domain,
      defense_id: conflict.defense_id,
      project_id: conflict.project_id,
      start_time: conflict.start_time,
      end_time: conflict.end_time,
      overlap_minutes: overlapMinutes,
      remaining_minutes: Math.max(0, candidateTotalMinutes - overlapMinutes),
    };
  });

  const maxOverlapMinutes = normalizedConflicts.reduce(
    (max, conflict) => Math.max(max, conflict.overlap_minutes || 0),
    0
  );

  return {
    conflict: true,
    conflicts: normalizedConflicts,
    max_overlap_minutes: maxOverlapMinutes,
    candidate_total_minutes: candidateTotalMinutes,
    effective_minutes: Math.max(0, candidateTotalMinutes - maxOverlapMinutes),
    message: 'Schedule overlap detected with approved or booked defenses.',
  };
}

const INACTIVE_DEFENSE_STATUSES = ['cancelled', 'rejected', 'completed'];

function buildConflictQueryExtras({ tableAlias = '', excludeDefenseIds = [], excludeProjectIds = [] } = {}) {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  const parts = [`${prefix}status NOT IN (${INACTIVE_DEFENSE_STATUSES.map(() => '?').join(', ')})`];
  const params = [...INACTIVE_DEFENSE_STATUSES];

  if (excludeDefenseIds.length) {
    parts.push(`${prefix}id NOT IN (${excludeDefenseIds.map(() => '?').join(', ')})`);
    params.push(...excludeDefenseIds);
  }

  if (excludeProjectIds.length) {
    parts.push(`${prefix}project_id NOT IN (${excludeProjectIds.map(() => '?').join(', ')})`);
    params.push(...excludeProjectIds);
  }

  return {
    sql: parts.join(' AND '),
    params,
  };
}

function rangesOverlap(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return false;
  return startA < endB && endA > startB;
}

function normalizePanelistIds(payload) {
  const raw = payload?.panelistIds ?? payload?.panelist_ids ?? [];
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.map(String).filter(Boolean)));
}

function normalizeProjectIds(payload) {
  const raw = payload?.projectIds ?? payload?.project_ids ?? [];
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.map(String).filter(Boolean)));
}

async function validateInstitutionPanelists(institutionId, panelistIds, queryRunner = db) {
  if (!panelistIds.length) return { data: [] };

  const placeholders = panelistIds.map(() => '?').join(', ');
  const sql = `SELECT DISTINCT u.id, u.full_name
               FROM users u
               INNER JOIN user_roles ur ON ur.user_id = u.id
               WHERE ur.institution_id = ?
                 AND ur.role IN ('adviser', 'coordinator')
                 AND u.id IN (${placeholders})`;
  const params = [institutionId, ...panelistIds];

  let rows;
  if (typeof queryRunner.execute === 'function') {
    [rows] = await queryRunner.execute(sql, params);
  } else {
    ({ rows } = await queryRunner.query(sql, params));
  }

  if (rows.length !== panelistIds.length) {
    return {
      error: 'One or more panelists are not advisers or coordinators in your institution',
      status: 400,
    };
  }

  return { data: rows };
}

async function assignDefensePanelists(conn, defenseId, panelistIds) {
  for (const userId of panelistIds) {
    await conn.execute(
      `INSERT INTO defense_panelists (id, defense_id, user_id)
       VALUES (UUID(), ?, ?)
       ON DUPLICATE KEY UPDATE assigned_at = CURRENT_TIMESTAMP`,
      [defenseId, userId]
    );
  }
}

const DEFENSE_PANELIST_NAMES_SQL = `(
  SELECT GROUP_CONCAT(u3.full_name ORDER BY u3.full_name SEPARATOR ', ')
  FROM defense_panelists dp
  INNER JOIN users u3 ON u3.id = dp.user_id
  WHERE dp.defense_id = d.id
) AS panelist_names`;

async function getCoordinatorApprovalConflicts({
  defenseId = null,
  projectId,
  memberIds,
  location,
  startAt,
  endAt,
  queryRunner,
  excludeDefenseIds = [],
  excludeProjectIds = [],
}) {
  // Parse input times
  const startNorm = normalizeDateTimeInput(startAt);
  const endNorm = normalizeDateTimeInput(endAt);
  if (!startNorm || !endNorm) return [];

  const startDate = startNorm.dateValue;
  const endDate = endNorm.dateValue;

  const allConflicts = [];

  // Check for overlapping defenses in the same project (active defenses only)
  const [projectRows] = await queryRunner.execute(
    `SELECT id, project_id,
            scheduled_at AS start_time,
            COALESCE(end_time, scheduled_at) AS end_time,
            status
     FROM defenses
     WHERE (? IS NULL OR id <> ?)
       AND project_id = ?
       AND status NOT IN (${INACTIVE_DEFENSE_STATUSES.map(() => '?').join(', ')})
       AND scheduled_at IS NOT NULL
       AND scheduled_at < ?
       AND COALESCE(end_time, scheduled_at) > ?`,
    [defenseId, defenseId, projectId, ...INACTIVE_DEFENSE_STATUSES, endNorm.dbValue, startNorm.dbValue]
  );

  for (const row of projectRows) {
    allConflicts.push({
      domain: 'project',
      defense_id: row.id,
      project_id: row.project_id,
      start_time: row.start_time,
      end_time: row.end_time,
      status: row.status,
      start_date: toDate(row.start_time),
      end_date: toDate(row.end_time || row.start_time),
    });
  }

  // Check for room conflicts (active defenses only; skip intra-batch course bookings)
  if (location && String(location).toLowerCase() !== 'online') {
    const roomExtras = buildConflictQueryExtras({ excludeDefenseIds, excludeProjectIds });
    const [locationRows] = await queryRunner.execute(
      `SELECT id, project_id,
              scheduled_at AS start_time,
              COALESCE(end_time, scheduled_at) AS end_time,
              status
       FROM defenses
       WHERE (? IS NULL OR id <> ?)
         AND ${roomExtras.sql}
         AND scheduled_at IS NOT NULL
         AND COALESCE(venue, location) = ?
         AND scheduled_at < ?
         AND COALESCE(end_time, scheduled_at) > ?`,
      [defenseId, defenseId, ...roomExtras.params, location, endNorm.dbValue, startNorm.dbValue]
    );

    for (const row of locationRows) {
      allConflicts.push({
        domain: 'room',
        defense_id: row.id,
        project_id: row.project_id,
        start_time: row.start_time,
        end_time: row.end_time,
        status: row.status,
        start_date: toDate(row.start_time),
        end_date: toDate(row.end_time || row.start_time),
      });
    }
  }

  // Check for participant conflicts (active defenses only; skip intra-batch course bookings)
  if (memberIds.length) {
    const memberPlaceholders = memberIds.map(() => '?').join(', ');
    const participantExtras = buildConflictQueryExtras({
      tableAlias: 'd',
      excludeDefenseIds,
      excludeProjectIds,
    });
    const [participantRows] = await queryRunner.execute(
      `SELECT DISTINCT d.id, d.project_id,
              d.scheduled_at AS start_time,
              COALESCE(d.end_time, d.scheduled_at) AS end_time,
              d.status
       FROM defenses d
       WHERE (? IS NULL OR d.id <> ?)
         AND ${participantExtras.sql}
         AND d.scheduled_at IS NOT NULL
         AND (
           EXISTS (
             SELECT 1
             FROM project_members pm
             WHERE pm.project_id = d.project_id
               AND pm.status = 'accepted'
               AND pm.user_id IN (${memberPlaceholders})
           )
           OR EXISTS (
             SELECT 1
             FROM defense_panelists dp
             WHERE dp.defense_id = d.id
               AND dp.user_id IN (${memberPlaceholders})
           )
         )
         AND d.scheduled_at < ?
         AND COALESCE(d.end_time, d.scheduled_at) > ?`,
      [
        defenseId,
        defenseId,
        ...participantExtras.params,
        ...memberIds,
        ...memberIds,
        endNorm.dbValue,
        startNorm.dbValue,
      ]
    );

    for (const row of participantRows) {
      allConflicts.push({
        domain: 'participant',
        defense_id: row.id,
        project_id: row.project_id,
        start_time: row.start_time,
        end_time: row.end_time,
        status: row.status,
        start_date: toDate(row.start_time),
        end_date: toDate(row.end_time || row.start_time),
      });
    }
  }

  const deduped = Array.from(new Map(allConflicts.map((item) => [item.defense_id, item])).values());
  return deduped.filter((item) => rangesOverlap(item.start_date, item.end_date, startDate, endDate));
}

// ─── Institution Management ─────────────────────────────────────────────────

async function getInstitutionByCoordinator(userId) {
  const { rows } = await db.query(
    `SELECT i.*
     FROM institutions i
     INNER JOIN user_roles ur ON ur.institution_id = i.id
     WHERE ur.user_id = ? AND ur.role = 'coordinator'
     ORDER BY ur.created_at DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function getInstitutionById(institutionId) {
  const { rows } = await db.query(
    'SELECT * FROM institutions WHERE id = ? LIMIT 1',
    [institutionId]
  );
  return rows[0] || null;
}

async function getAdvisersInInstitution(institutionId) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.full_name, u.avatar_url, ur.role, ur.created_at AS role_assigned_at
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     WHERE ur.institution_id = ? AND ur.role = 'adviser'
     ORDER BY u.full_name ASC`,
    [institutionId]
  );
  return rows;
}

async function getPanelistsInInstitution(institutionId) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.full_name, u.avatar_url,
            MIN(ur.role) AS role,
            MIN(ur.created_at) AS role_assigned_at
     FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     WHERE ur.institution_id = ?
       AND ur.role IN ('adviser', 'coordinator')
     GROUP BY u.id, u.email, u.full_name, u.avatar_url
     ORDER BY u.full_name ASC`,
    [institutionId]
  );
  return rows;
}

async function addAdviserToInstitution(institutionId, adviserId, courseId, coordinatorId) {
  if (!courseId) {
    return { error: 'courseId is required' };
  }

  const { rows: courseCountRows } = await db.query(
    'SELECT COUNT(*) AS count FROM courses WHERE institution_id = ?',
    [institutionId]
  );

  const courseCount = Number(courseCountRows[0]?.count || 0);
  if (courseCount === 0) {
    return { error: 'Create at least one course before inviting advisers.' };
  }

  const course = await getCourseById(courseId);
  if (!course || course.institution_id !== institutionId) {
    return { error: 'Course not found in your institution' };
  }

  // Verify the adviser exists and has adviser role
  const { rows: roleRows } = await db.query(
    `SELECT ur.id, ur.institution_id
     FROM user_roles ur
     WHERE ur.user_id = ? AND ur.role = 'adviser'
     ORDER BY ur.created_at DESC LIMIT 1`,
    [adviserId]
  );

  if (!roleRows[0]) {
    return { error: 'User is not an adviser' };
  }

  if (roleRows[0].institution_id !== institutionId) {
    await db.query(
      'UPDATE user_roles SET institution_id = ? WHERE id = ?',
      [institutionId, roleRows[0].id]
    );
  }

  await db.query(
    `INSERT INTO course_advisers (id, course_id, user_id)
     VALUES (UUID(), ?, ?)
     ON DUPLICATE KEY UPDATE assigned_at = CURRENT_TIMESTAMP`,
    [courseId, adviserId]
  );

  const assignmentResult = await db.query(
    `INSERT INTO project_members (id, project_id, user_id, role, status, invited_at, responded_at)
     SELECT UUID(), p.id, ?, 'adviser', 'accepted', NOW(), NOW()
     FROM projects p
     WHERE p.institution_id = ?
       AND (
         p.course_id = ?
         OR EXISTS (
           SELECT 1
           FROM project_members pm
           WHERE pm.project_id = p.id
             AND pm.user_id = ?
             AND pm.role = 'adviser'
             AND pm.status = 'accepted'
         )
       )
       AND NOT EXISTS (
         SELECT 1
         FROM project_members pm
         WHERE pm.project_id = p.id
           AND pm.user_id = ?
           AND pm.role = 'adviser'
       )`,
    [adviserId, institutionId, courseId, adviserId, adviserId]
  );

  await db.query(
    `UPDATE projects p
     SET p.course_id = ?
     WHERE p.institution_id = ?
       AND p.course_id IS NULL
       AND EXISTS (
         SELECT 1
         FROM project_members pm
         WHERE pm.project_id = p.id
           AND pm.user_id = ?
           AND pm.role = 'adviser'
           AND pm.status = 'accepted'
       )`,
    [courseId, institutionId, adviserId]
  );

  const { rows: coordinatorRows } = await db.query(
    'SELECT full_name FROM users WHERE id = ? LIMIT 1',
    [coordinatorId]
  );
  const coordinatorName = coordinatorRows[0]?.full_name || 'A coordinator';

  await createNotification({
    userId: adviserId,
    type: 'invitation',
    title: 'You were assigned to an institution course',
    message: `${coordinatorName} assigned you as adviser for course ${course.course_name} (${course.code}).`,
    metadata: {
      institutionId,
      courseId,
      courseCode: course.code,
      assignedProjects: assignmentResult.rows?.affectedRows || 0,
      assignedBy: coordinatorId,
    },
  });

  return {
    data: {
      success: true,
      course_id: courseId,
      assigned_projects: assignmentResult.rows?.affectedRows || 0,
    },
  };
}

async function removeAdviserFromCourse(institutionId, courseId, adviserId) {
  const course = await getCourseById(courseId);
  if (!course || course.institution_id !== institutionId) {
    return { error: 'Course not found in your institution', status: 404 };
  }

  const { rows: roleRows } = await db.query(
    `SELECT ur.id FROM user_roles ur
     WHERE ur.user_id = ? AND ur.role = 'adviser' AND ur.institution_id = ?
     LIMIT 1`,
    [adviserId, institutionId]
  );
  if (!roleRows.length) {
    return { error: 'Adviser not found in your institution', status: 404 };
  }

  await db.query(
    'DELETE FROM course_advisers WHERE course_id = ? AND user_id = ?',
    [courseId, adviserId]
  );

  const result = await db.query(
    `DELETE pm FROM project_members pm
     INNER JOIN projects p ON p.id = pm.project_id
     WHERE pm.user_id = ?
       AND pm.role = 'adviser'
       AND p.institution_id = ?
       AND p.course_id = ?`,
    [adviserId, institutionId, courseId]
  );

  return {
    data: {
      success: true,
      removed_assignments: result.rows?.affectedRows ?? 0,
    },
  };
}

async function removeAdviserFromInstitution(institutionId, adviserId, coordinatorId = null) {
  const { rows } = await db.query(
    `UPDATE user_roles SET institution_id = NULL
     WHERE user_id = ? AND role = 'adviser' AND institution_id = ?`,
    [adviserId, institutionId]
  );

  if (rows?.affectedRows > 0) {
    const { rows: coordinatorRows } = coordinatorId
      ? await db.query('SELECT full_name FROM users WHERE id = ? LIMIT 1', [coordinatorId])
      : { rows: [] };
    const coordinatorName = coordinatorRows[0]?.full_name || 'A coordinator';

    await createNotification({
      userId: adviserId,
      type: 'invitation',
      title: 'Institution adviser assignment removed',
      message: `${coordinatorName} removed your adviser assignment for the institution.`,
      metadata: {
        institutionId,
        removedBy: coordinatorId,
      },
    });
  }

  return rows;
}

// ─── Course Management ──────────────────────────────────────────────────────

async function getCoursesByInstitution(institutionId) {
  const { rows } = await db.query(
    `SELECT * FROM courses
     WHERE institution_id = ?
     ORDER BY course_name ASC`,
    [institutionId]
  );
  return rows;
}

async function getCoursesWithAdvisersByInstitution(institutionId) {
  const courses = await getCoursesByInstitution(institutionId);
  if (!courses.length) return [];

  const { rows: adviserRows } = await db.query(
    `SELECT DISTINCT course_id, id, email, full_name, avatar_url
     FROM (
       SELECT ca.course_id, u.id, u.email, u.full_name, u.avatar_url
       FROM course_advisers ca
       INNER JOIN courses c ON c.id = ca.course_id
       INNER JOIN users u ON u.id = ca.user_id
       WHERE c.institution_id = ?
       UNION
       SELECT p.course_id, u.id, u.email, u.full_name, u.avatar_url
       FROM project_members pm
       INNER JOIN projects p ON p.id = pm.project_id
       INNER JOIN users u ON u.id = pm.user_id
       WHERE p.institution_id = ?
         AND p.course_id IS NOT NULL
         AND pm.role = 'adviser'
         AND pm.status = 'accepted'
     ) advisers
     WHERE course_id IS NOT NULL
     ORDER BY full_name ASC`,
    [institutionId, institutionId]
  );

  const advisersByCourse = new Map();
  for (const row of adviserRows) {
    if (!advisersByCourse.has(row.course_id)) {
      advisersByCourse.set(row.course_id, []);
    }
    const list = advisersByCourse.get(row.course_id);
    if (!list.some((a) => a.id === row.id)) {
      list.push({
        id: row.id,
        email: row.email,
        full_name: row.full_name,
        avatar_url: row.avatar_url,
      });
    }
  }

  return courses.map((course) => ({
    ...course,
    advisers: advisersByCourse.get(course.id) || [],
  }));
}

async function getCourseById(courseId) {
  const { rows } = await db.query(
    'SELECT * FROM courses WHERE id = ? LIMIT 1',
    [courseId]
  );
  return rows[0] || null;
}

/** Projects directly assigned to a course via projects.course_id (one course per project). */
async function getProjectsForCourseInInstitution(institutionId, courseId) {
  const { rows } = await db.query(
    `SELECT p.id, p.title, p.project_code
     FROM projects p
     INNER JOIN courses c ON c.id = p.course_id AND c.institution_id = ?
     WHERE p.course_id = ?
     ORDER BY p.title ASC`,
    [institutionId, courseId]
  );
  return rows;
}

async function createCourse(institutionId, { courseName, code, description }) {
  // Check for duplicate code within institution
  const { rows: existing } = await db.query(
    'SELECT id FROM courses WHERE institution_id = ? AND code = ? LIMIT 1',
    [institutionId, code]
  );
  if (existing[0]) {
    return { error: 'A course with this code already exists in your institution' };
  }

  await db.query(
    `INSERT INTO courses (id, institution_id, course_name, code, description)
     VALUES (UUID(), ?, ?, ?, ?)`,
    [institutionId, courseName, code, description || null]
  );

  const { rows } = await db.query(
    `SELECT * FROM courses WHERE institution_id = ? AND code = ? LIMIT 1`,
    [institutionId, code]
  );

  await notifyInstitutionCoordinators({
    institutionId,
    payload: {
      title: 'Course created',
      message: `Course ${rows[0]?.course_name || courseName} (${rows[0]?.code || code}) was created in your institution.`,
      metadata: {
        institutionId,
        courseId: rows[0]?.id || null,
        code,
        event: 'course_created',
      },
    },
  });

  return { data: rows[0] };
}

async function updateCourse(courseId, institutionId, { courseName, code, description }) {
  const course = await getCourseById(courseId);
  if (!course || course.institution_id !== institutionId) {
    return { error: 'Course not found in your institution' };
  }

  if (code && code !== course.code) {
    const { rows: dup } = await db.query(
      'SELECT id FROM courses WHERE institution_id = ? AND code = ? AND id != ? LIMIT 1',
      [institutionId, code, courseId]
    );
    if (dup[0]) {
      return { error: 'A course with this code already exists in your institution' };
    }
  }

  await db.query(
    `UPDATE courses SET course_name = ?, code = ?, description = ? WHERE id = ?`,
    [courseName || course.course_name, code || course.code, description !== undefined ? description : course.description, courseId]
  );

  const updated = await getCourseById(courseId);

  await notifyInstitutionCoordinators({
    institutionId,
    payload: {
      title: 'Course updated',
      message: `Course ${updated?.course_name || course.course_name} (${updated?.code || course.code}) was updated.`,
      metadata: {
        institutionId,
        courseId,
        event: 'course_updated',
      },
    },
  });

  return { data: updated };
}

async function deleteCourse(courseId, institutionId) {
  const course = await getCourseById(courseId);
  if (!course || course.institution_id !== institutionId) {
    return { error: 'Course not found in your institution' };
  }

  await db.query('DELETE FROM courses WHERE id = ?', [courseId]);

  await notifyInstitutionCoordinators({
    institutionId,
    payload: {
      title: 'Course deleted',
      message: `Course ${course.course_name} (${course.code}) was deleted from your institution.`,
      metadata: {
        institutionId,
        courseId,
        event: 'course_deleted',
      },
    },
  });

  return { data: { success: true } };
}

// ─── Defense Verification ───────────────────────────────────────────────────

async function getPendingDefenses(institutionId) {
  const scheduleExpr = await getDefenseScheduleExpr();

  const { rows } = await db.query(
    `SELECT d.*, p.title AS project_title, p.project_code,
            ${scheduleExpr} AS scheduled_at,
            ${scheduleExpr} AS start_time,
            COALESCE(d.end_time, ${scheduleExpr}) AS end_time,
            u.full_name AS created_by_name,
            ${DEFENSE_PANELIST_NAMES_SQL}
     FROM defenses d
     INNER JOIN projects p ON d.project_id = p.id
     LEFT JOIN courses c ON p.course_id = c.id
     LEFT JOIN users u ON d.created_by = u.id
     WHERE ${coordinatorProjectScopeSql('p', 'c')}
       AND d.status = 'pending'
     ORDER BY ${scheduleExpr} ASC`,
    coordinatorProjectScopeBinds(institutionId)
  );
  return rows.map(normalizeDefenseTimeRange);
}

async function getAllDefensesForInstitution(institutionId) {
  const scheduleExpr = await getDefenseScheduleExpr();

  const { rows } = await db.query(
    `SELECT d.*, p.title AS project_title, p.project_code,
            ${scheduleExpr} AS scheduled_at,
            ${scheduleExpr} AS start_time,
            COALESCE(d.end_time, ${scheduleExpr}) AS end_time,
            u.full_name AS created_by_name,
            (
              SELECT u2.full_name
              FROM project_members pm2
              INNER JOIN users u2 ON u2.id = pm2.user_id
              WHERE pm2.project_id = d.project_id
                AND pm2.role = 'adviser'
                AND pm2.status = 'accepted'
              ORDER BY pm2.invited_at ASC
              LIMIT 1
            ) AS adviser_name,
            ${DEFENSE_PANELIST_NAMES_SQL}
     FROM defenses d
     INNER JOIN projects p ON d.project_id = p.id
     LEFT JOIN courses c ON p.course_id = c.id
     LEFT JOIN users u ON d.created_by = u.id
     WHERE ${coordinatorProjectScopeSql('p', 'c')}
     ORDER BY ${scheduleExpr} DESC`,
    coordinatorProjectScopeBinds(institutionId)
  );
  return rows.map(normalizeDefenseTimeRange);
}

async function verifyDefense(
  defenseId,
  coordinatorId,
  { venue, location, modality, verifiedSchedule, verifiedEndTime, notes, forceApprove, holdDefense }
) {
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    // Get current defense with project info
    const [defenseRows] = await conn.execute(
      `SELECT d.*, p.title AS project_title
       FROM defenses d
       LEFT JOIN projects p ON d.project_id = p.id
       WHERE d.id = ? LIMIT 1`,
      [defenseId]
    );
    const defense = defenseRows[0];
    if (!defense) {
      await conn.rollback();
      return { error: 'Defense not found' };
    }

    const proposedStart = verifiedSchedule || defense.scheduled_at;
    const proposedEnd = verifiedEndTime || defense.end_time || proposedStart;

    const proposedStartDate = toDate(proposedStart);
    const proposedEndDate = toDate(proposedEnd);
    if (!proposedStartDate || !proposedEndDate || proposedEndDate <= proposedStartDate) {
      await conn.rollback();
      return { error: 'Invalid schedule range' };
    }

    const [memberRows] = await conn.execute(
      `SELECT user_id
       FROM project_members
       WHERE project_id = ?
         AND status = 'accepted'`,
      [defense.project_id]
    );

    const targetLocation = venue || location || defense.venue || defense.location || null;
    const resolvedModality = modality || defense.modality || 'Online';
    const resolvedVenue = venue ?? defense.venue ?? null;
    const resolvedLocation = location ?? defense.location ?? null;
    const conflicts = await getCoordinatorApprovalConflicts({
      defenseId,
      projectId: defense.project_id,
      memberIds: memberRows.map((member) => member.user_id),
      location: targetLocation,
      startAt: proposedStart,
      endAt: proposedEnd,
      queryRunner: conn,
    });

    if (conflicts.length && !forceApprove && !holdDefense) {
      await conn.rollback();
      return {
        data: buildCoordinatorConflictPayload(conflicts, proposedStartDate, proposedEndDate),
      };
    }

    // Determine status based on holdDefense flag and schedule changes
    let newStatus = 'scheduled';
    let notifType = 'defense_approved';
    
    if (holdDefense) {
      newStatus = 'pending';
      notifType = 'defense_pending';
    } else if (forceApprove) {
      newStatus = 'scheduled';
      notifType = 'defense_approved';
    } else {
      // No conflict and no special handling - schedule immediately
      const scheduleMoved = verifiedSchedule && verifiedSchedule !== defense.scheduled_at?.toISOString?.();
      const activeStatuses = ['scheduled', 'moved', 'approved'];
      if (activeStatuses.includes(defense.status)) {
        newStatus = scheduleMoved ? 'moved' : defense.status;
      } else {
        newStatus = scheduleMoved ? 'moved' : 'scheduled';
      }
      notifType = scheduleMoved ? 'defense_moved' : 'defense_approved';
    }

    const jitsi = createJitsiMeetingFields({
      prefix: JITSI_DEFENSE_PREFIX,
      recordId: defenseId,
      modality: resolvedModality,
    });

    // Update defense schedule and status without requiring verification columns.
    await conn.execute(
      `UPDATE defenses
       SET venue = ?,
           location = ?,
           modality = ?,
           scheduled_at = ?,
           end_time = ?,
           verified_schedule = ?,
           status = ?,
           meeting_room = ?,
           meeting_url = ?,
           meeting_provider = ?
       WHERE id = ?`,
      [
        resolvedVenue,
        resolvedLocation,
        resolvedModality,
        proposedStart,
        proposedEnd,
        proposedStart,
        newStatus,
        jitsi.meeting_room,
        jitsi.meeting_url,
        jitsi.meeting_provider,
        defenseId,
      ]
    );

    // Create verification audit record
    await conn.execute(
      `INSERT INTO defense_verifications (id, defense_id, verified_by, previous_schedule, new_schedule, previous_venue, new_venue, notes)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)`,
      [
        defenseId,
        coordinatorId,
        defense.scheduled_at,
        proposedStart,
        defense.venue || defense.location,
        resolvedVenue || resolvedLocation,
        notes || null,
      ]
    );

    // Notify all project members
    const members = memberRows;

    const finalSchedule = proposedStart;
    const dateStr = new Date(finalSchedule).toLocaleDateString();
    const timeStr = new Date(finalSchedule).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let notifTitle = 'Defense Approved';
    let notifMessage = `The ${defense.defense_type} defense for "${defense.project_title}" has been approved for ${dateStr} at ${timeStr} (${resolvedModality}).`;

    if (holdDefense) {
      notifTitle = 'Defense Held in Queue';
      notifMessage = `The ${defense.defense_type} defense for "${defense.project_title}" has been queued and will be scheduled when time slots become available. Proposed schedule: ${dateStr} at ${timeStr} (${resolvedModality}).`;
    } else if (forceApprove && conflicts.length) {
      notifTitle = 'Defense Confirmed Despite Conflicts';
      notifMessage = `The ${defense.defense_type} defense for "${defense.project_title}" has been confirmed for ${dateStr} at ${timeStr} (${resolvedModality}).`;
    }

    const notifMessageWithLink = appendMeetingLinkToMessage(notifMessage, jitsi.meeting_url);

    for (const member of members) {
      await createNotification({
        userId: member.user_id,
        type: notifType,
        title: notifTitle,
        message: notifMessageWithLink,
        metadata: {
          defenseId,
          projectId: defense.project_id,
          schedule: finalSchedule,
          modality: resolvedModality,
          meetingUrl: jitsi.meeting_url,
          meetingRoom: jitsi.meeting_room,
        },
        conn,
      });
    }

    await conn.commit();

    // Return updated defense
    const { rows } = await db.query('SELECT * FROM defenses WHERE id = ? LIMIT 1', [defenseId]);
    return { data: rows[0] };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function rejectDefense(defenseId, coordinatorId, { notes }) {
  const { rows: defenseRows } = await db.query(
    `SELECT d.*, p.title AS project_title
     FROM defenses d
     LEFT JOIN projects p ON d.project_id = p.id
     WHERE d.id = ? LIMIT 1`,
    [defenseId]
  );
  const defense = defenseRows[0];
  if (!defense) {
    return { error: 'Defense not found' };
  }

  await db.query(
    `UPDATE defenses SET status = 'rejected' WHERE id = ?`,
    [defenseId]
  );

  if (notes) {
    await db.query(
      `INSERT INTO defense_verifications (id, defense_id, verified_by, notes)
       VALUES (UUID(), ?, ?, ?)`,
      [defenseId, coordinatorId, notes]
    );
  }

  // Notify all project members
  const { rows: members } = await db.query(
    'SELECT user_id FROM project_members WHERE project_id = ?',
    [defense.project_id]
  );

  const notifTitle = 'Defense Proposal Rejected';
  const notifMessage = `The ${defense.defense_type} defense proposal for "${defense.project_title}" has been rejected.${notes ? ' Reason: ' + notes : ''}`;

  for (const member of members) {
    await createNotification({
      userId: member.user_id,
      type: 'defense_rejected',
      title: notifTitle,
      message: notifMessage,
      metadata: { defenseId, projectId: defense.project_id },
    });
  }

  return { data: { success: true } };
}

async function setDefenseVenue(defenseId, coordinatorId, venue) {
  const { rows } = await db.query(
    'SELECT * FROM defenses WHERE id = ? LIMIT 1',
    [defenseId]
  );
  if (!rows[0]) {
    return { error: 'Defense not found' };
  }

  await db.query(
    'UPDATE defenses SET venue = ? WHERE id = ?',
    [venue, defenseId]
  );

  return { data: { success: true } };
}

const DEFENSE_UNDO_REVERT_STATUSES = ['scheduled', 'moved', 'approved'];

async function getCoordinatorDefenseById(defenseId, institutionId) {
  const { rows } = await db.query(
    `SELECT d.id, d.status
     FROM defenses d
     JOIN projects p ON p.id = d.project_id
     LEFT JOIN courses c ON p.course_id = c.id
     WHERE d.id = ? AND ${coordinatorProjectScopeSql('p', 'c')}
     LIMIT 1`,
    [defenseId, ...coordinatorProjectScopeBinds(institutionId)]
  );
  return rows[0] || null;
}

async function cancelCoordinatorDefense(defenseId, institutionId) {
  const defense = await getCoordinatorDefenseById(defenseId, institutionId);
  if (!defense) {
    return { error: 'Defense not found', status: 404 };
  }
  if (defense.status === 'cancelled') {
    return { data: { success: true, previousStatus: defense.status } };
  }
  if (defense.status === 'completed') {
    return { error: 'Cannot cancel a completed defense', status: 409 };
  }
  if (defense.status === 'pending') {
    return { error: 'Reject pending defenses instead of cancelling', status: 409 };
  }
  if (defense.status === 'rejected') {
    return { error: 'Defense is already rejected', status: 409 };
  }

  const previousStatus = defense.status;
  await db.query(`UPDATE defenses SET status = 'cancelled' WHERE id = ?`, [defenseId]);
  return { data: { success: true, previousStatus } };
}

async function completeCoordinatorDefense(defenseId, institutionId) {
  const defense = await getCoordinatorDefenseById(defenseId, institutionId);
  if (!defense) {
    return { error: 'Defense not found', status: 404 };
  }
  if (defense.status === 'completed') {
    return { data: { success: true, previousStatus: defense.status } };
  }
  if (defense.status === 'cancelled') {
    return { error: 'Cannot complete a cancelled defense', status: 409 };
  }
  if (defense.status === 'pending') {
    return { error: 'Approve or reject pending defenses first', status: 409 };
  }
  if (defense.status === 'rejected') {
    return { error: 'Cannot complete a rejected defense', status: 409 };
  }

  const previousStatus = defense.status;
  await db.query(`UPDATE defenses SET status = 'completed' WHERE id = ?`, [defenseId]);
  return { data: { success: true, previousStatus } };
}

async function revertCoordinatorDefense(defenseId, institutionId, previousStatus) {
  const defense = await getCoordinatorDefenseById(defenseId, institutionId);
  if (!defense) {
    return { error: 'Defense not found', status: 404 };
  }
  if (defense.status !== 'cancelled' && defense.status !== 'completed') {
    return { error: 'Only cancelled or completed defenses can be reverted', status: 409 };
  }

  const restoreStatus = DEFENSE_UNDO_REVERT_STATUSES.includes(previousStatus)
    ? previousStatus
    : 'scheduled';

  await db.query(`UPDATE defenses SET status = ? WHERE id = ?`, [restoreStatus, defenseId]);
  return { data: { success: true, status: restoreStatus } };
}

/** @deprecated Use cancelCoordinatorDefense — kept as alias for existing DELETE route */
async function deleteDefense(defenseId, institutionId) {
  return cancelCoordinatorDefense(defenseId, institutionId);
}

// ─── Dashboard Stats ────────────────────────────────────────────────────────

/**
 * Distinct projects with at least one accepted adviser from course_advisers.
 * Shared projects (multiple advisers) are counted once.
 */
async function countProjectsUnderCourseAdvisers(institutionId) {
  const { rows } = await db.query(
    `SELECT COUNT(DISTINCT pm.project_id) AS count
     FROM course_advisers ca
     INNER JOIN courses c ON c.id = ca.course_id AND c.institution_id = ?
     INNER JOIN project_members pm
       ON pm.user_id = ca.user_id
      AND pm.role = 'adviser'
      AND pm.status = 'accepted'`,
    [institutionId],
  );
  return Number(rows[0]?.count || 0);
}

async function getCoordinatorStats(institutionId) {
  const [projectsCount, advisersResult, defensesResult, coursesResult] = await Promise.all([
    countProjectsUnderCourseAdvisers(institutionId),
    db.query(
      `SELECT COUNT(DISTINCT ca.user_id) AS count
       FROM course_advisers ca
       INNER JOIN courses c ON c.id = ca.course_id
       WHERE c.institution_id = ?`,
      [institutionId],
    ),
    db.query(
      `SELECT COUNT(*) AS count FROM defenses d
       INNER JOIN projects p ON d.project_id = p.id
       LEFT JOIN courses c ON p.course_id = c.id
       WHERE ${coordinatorProjectScopeSql('p', 'c')}
         AND d.status = 'pending'`,
      coordinatorProjectScopeBinds(institutionId)
    ),
    db.query(
      'SELECT COUNT(*) AS count FROM courses WHERE institution_id = ?',
      [institutionId]
    ),
  ]);

  return {
    totalProjects: projectsCount,
    totalAdvisers: advisersResult.rows[0]?.count || 0,
    pendingDefenses: defensesResult.rows[0]?.count || 0,
    totalCourses: coursesResult.rows[0]?.count || 0,
  };
}

async function createDefenseForCourse(institutionId, coordinatorId, payload) {
  const {
    courseId,
    defenseType,
    scheduledAt,
    date,
    startTime,
    endTime,
    location,
    venue,
    modality,
    forceSchedule,
    holdDefense,
  } = payload;
  const resolvedModality = modality || 'Online';

  if (!courseId) return { error: 'courseId is required' };
  if (!defenseType || !['proposal', 'midterm', 'final'].includes(defenseType)) {
    return { error: 'defenseType must be one of: proposal, midterm, final' };
  }
  if (!location) return { error: 'location is required' };

  const startInput = scheduledAt || (date && startTime ? `${date}T${startTime}` : null);
  const endInput = date && endTime ? `${date}T${endTime}` : null;
  const scheduleWindow = getScheduleWindow({ start_time: startInput, end_time: endInput });
  if (scheduleWindow.error) return { error: scheduleWindow.error };

  const normalizedStart = scheduleWindow.start;
  const normalizedEnd = scheduleWindow.end;

  const course = await getCourseById(courseId);
  if (!course || course.institution_id !== institutionId) {
    return { error: 'Course not found in your institution' };
  }

  // Fetch all projects in the course with their adviser (from project_members).
  // Use GROUP BY to ensure one row per project even if multiple adviser members exist.
  // Falls back to project creator if no accepted adviser member exists.
  const courseProjects = await getProjectsForCourseInInstitution(institutionId, courseId);
  if (!courseProjects.length) {
    return { error: 'No projects found for this course.' };
  }

  const projectIds = courseProjects.map((p) => p.id);
  const placeholders = projectIds.map(() => '?').join(', ');
  const { rows: projectAdviserRows } = await db.query(
    `SELECT p.id, p.title, p.project_code,
            COALESCE(MIN(pm.user_id), p.created_by) AS adviser_id
     FROM projects p
     LEFT JOIN project_members pm
       ON pm.project_id = p.id
      AND pm.role = 'adviser'
      AND pm.status = 'accepted'
     WHERE p.id IN (${placeholders})
     GROUP BY p.id, p.title, p.project_code, p.created_by`,
    projectIds
  );

  const conn = await db.pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await conn.beginTransaction();

    // ── Overlap check (skip if coordinator chose to force or hold) ────────
    if (!forceSchedule && !holdDefense) {
      const candidateTotalMinutes = Math.round(
        (normalizedEnd.dateValue.getTime() - normalizedStart.dateValue.getTime()) / 60000
      );

      // Check defenses table
      const [overlapRows] = await conn.execute(
        `SELECT id, project_id,
                DATE_FORMAT(scheduled_at, '%Y-%m-%d %H:%i') AS slot_start,
                DATE_FORMAT(COALESCE(end_time, scheduled_at), '%Y-%m-%d %H:%i') AS slot_end,
                TIMESTAMPDIFF(MINUTE,
                  GREATEST(scheduled_at, ?),
                  LEAST(COALESCE(end_time, scheduled_at), ?)
                ) AS overlap_minutes
         FROM defenses
         WHERE scheduled_at < ?
           AND COALESCE(end_time, scheduled_at) > ?
           AND status NOT IN ('rejected', 'cancelled')
         LIMIT 5`,
        [normalizedStart.dbValue, normalizedEnd.dbValue, normalizedEnd.dbValue, normalizedStart.dbValue]
      );

      // Check meetings table
      const [meetingOverlapRows] = await conn.execute(
        `SELECT id, project_id,
                DATE_FORMAT(scheduled_at, '%Y-%m-%d %H:%i') AS slot_start,
                DATE_FORMAT(COALESCE(end_time, scheduled_at), '%Y-%m-%d %H:%i') AS slot_end,
                TIMESTAMPDIFF(MINUTE,
                  GREATEST(scheduled_at, ?),
                  LEAST(COALESCE(end_time, scheduled_at), ?)
                ) AS overlap_minutes
         FROM meetings
         WHERE scheduled_at < ?
           AND COALESCE(end_time, scheduled_at) > ?
           AND status NOT IN ('rejected', 'cancelled')
         LIMIT 5`,
        [normalizedStart.dbValue, normalizedEnd.dbValue, normalizedEnd.dbValue, normalizedStart.dbValue]
      );

      const allOverlaps = [...overlapRows, ...meetingOverlapRows];

      if (allOverlaps.length > 0) {
        await conn.rollback();

        const maxOverlapMinutes = allOverlaps.reduce(
          (max, r) => Math.max(max, r.overlap_minutes || 0), 0
        );
        const effectiveMinutes = Math.max(0, candidateTotalMinutes - maxOverlapMinutes);

        return {
          conflict: true,
          conflicts: allOverlaps.map((r) => ({
            defense_id: r.id,
            project_id: r.project_id,
            start_time: r.slot_start,
            end_time: r.slot_end,
            overlap_minutes: r.overlap_minutes || 0,
          })),
          max_overlap_minutes: maxOverlapMinutes,
          candidate_total_minutes: candidateTotalMinutes,
          effective_minutes: effectiveMinutes,
          message: 'Schedule overlap detected. Choose how to proceed.',
          status: 409,
        };
      }
    }

    // ── Insert one defense per project ────────────────────────────────────
    const insertStatus = holdDefense ? 'pending' : 'scheduled';
    const createdDefenses = [];
    const notifiedProjects = new Set();

    for (const row of projectAdviserRows) {
      const [idRows] = await conn.execute('SELECT UUID() AS id');
      const defenseId = idRows[0].id;
      const jitsi = createJitsiMeetingFields({
        prefix: JITSI_DEFENSE_PREFIX,
        recordId: defenseId,
        modality: resolvedModality,
      });

      await conn.execute(
        `INSERT INTO defenses (
           id, project_id, defense_type, scheduled_at, end_time, location, venue, modality, status, created_by,
           meeting_room, meeting_url, meeting_provider
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          defenseId,
          row.id,
          defenseType,
          normalizedStart.dbValue,
          normalizedEnd.dbValue,
          location,
          venue || null,
          resolvedModality,
          insertStatus,
          coordinatorId,
          jitsi.meeting_room,
          jitsi.meeting_url,
          jitsi.meeting_provider,
        ]
      );

      const [defenseRows] = await conn.execute(
        'SELECT * FROM defenses WHERE id = ? LIMIT 1',
        [defenseId]
      );

      if (defenseRows[0]) {
        createdDefenses.push({ ...defenseRows[0], project_title: row.title, project_code: row.project_code });
      }

      if (notifiedProjects.has(row.id)) continue;
      notifiedProjects.add(row.id);

      const [members] = await conn.execute(
        'SELECT user_id FROM project_members WHERE project_id = ?',
        [row.id]
      );

      const notifTitle = holdDefense
        ? `${defenseType.charAt(0).toUpperCase() + defenseType.slice(1)} Defense Queued`
        : `${defenseType.charAt(0).toUpperCase() + defenseType.slice(1)} Defense Scheduled`;
      const notifMessage = appendMeetingLinkToMessage(
        holdDefense
          ? `A ${defenseType} defense for "${row.title}" has been queued and will be scheduled when the slot opens.`
          : `A ${defenseType} defense for "${row.title}" has been scheduled on ${normalizedStart.dateValue.toLocaleDateString()} at ${normalizedStart.dateValue.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
        jitsi.meeting_url
      );

      for (const member of members) {
        await createNotification({
          userId: member.user_id,
          type: 'schedule',
          title: notifTitle,
          message: notifMessage,
          metadata: {
            defenseId,
            projectId: row.id,
            meetingUrl: jitsi.meeting_url,
            meetingRoom: jitsi.meeting_room,
          },
          conn,
        });
      }
    }

    await conn.commit();
    return { data: { count: createdDefenses.length, defenses: createdDefenses, status: insertStatus } };
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

const COORDINATOR_RUBRIC_ROLE_FILTER = "(r.role = 'coordinator' OR r.role IS NULL)";

function normalizeCriterionDescription(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function normalizeRubricCriteria(criteria) {
  if (!Array.isArray(criteria)) return [];
  return criteria.map((row, index) => ({
    criterion_name: String(row.criterion_name || row.criterionName || '').trim(),
    description: normalizeCriterionDescription(row.description),
    weight: Number(row.weight),
    order: Number.isFinite(Number(row.order)) ? Number(row.order) : index,
  }));
}

function validateRubricCriteria(criteria) {
  const normalized = normalizeRubricCriteria(criteria);
  if (!normalized.length) {
    return { error: 'At least one criterion is required' };
  }

  let total = 0;
  for (const row of normalized) {
    if (!row.criterion_name) {
      return { error: 'Each criterion must have a name' };
    }
    if (!Number.isFinite(row.weight) || row.weight <= 0) {
      return { error: 'Each weight must be a positive number' };
    }
    total += row.weight;
  }

  if (Math.abs(total - 100) > 0.01) {
    return { error: `Criterion weights must total 100% (current: ${Math.round(total * 100) / 100}%)` };
  }

  return { data: normalized };
}

async function getCoordinatorRubricById(institutionId, rubricId) {
  const { rows } = await db.query(
    `SELECT r.id, r.name, r.description, r.defense_type, r.role, r.created_by, r.created_at
     FROM rubrics r
     INNER JOIN user_roles ur ON ur.user_id = r.created_by
     WHERE r.id = ?
       AND ur.institution_id = ?
       AND ${COORDINATOR_RUBRIC_ROLE_FILTER}
     LIMIT 1`,
    [rubricId, institutionId]
  );

  if (!rows.length) {
    return { error: 'Rubric not found', status: 404 };
  }

  const { rows: criteria } = await db.query(
    `SELECT id, rubric_id, criterion_name, weight, description, max_score, \`order\`
     FROM rubric_criteria
     WHERE rubric_id = ?
     ORDER BY \`order\` ASC, criterion_name ASC`,
    [rubricId]
  );

  return { data: { ...rows[0], criteria } };
}

async function listRubrics(institutionId) {
  const { rows } = await db.query(
    `SELECT r.id, r.name, r.description, r.defense_type, r.role, r.created_at,
            COUNT(rc.id) AS criteria_count,
            COALESCE(SUM(rc.weight), 0) AS total_weight
     FROM rubrics r
     INNER JOIN user_roles ur ON ur.user_id = r.created_by
     LEFT JOIN rubric_criteria rc ON rc.rubric_id = r.id
     WHERE ur.institution_id = ?
       AND ${COORDINATOR_RUBRIC_ROLE_FILTER}
     GROUP BY r.id, r.name, r.description, r.defense_type, r.role, r.created_at
     ORDER BY r.defense_type ASC, r.name ASC`,
    [institutionId]
  );
  return rows;
}

async function createCoordinatorRubric(institutionId, userId, payload) {
  const name = String(payload.name || payload.rubricName || '').trim();
  const description = String(payload.description ?? '').trim();
  const defenseType = payload.defenseType || payload.defense_type;
  const criteriaInput = payload.criteria;

  if (!name) return { error: 'Rubric name is required', status: 400 };
  if (!description) return { error: 'Rubric description is required', status: 400 };
  if (!['proposal', 'midterm', 'final'].includes(defenseType)) {
    return { error: 'defenseType must be proposal, midterm, or final', status: 400 };
  }

  const criteriaResult = validateRubricCriteria(criteriaInput);
  if (criteriaResult.error) return { error: criteriaResult.error, status: 400 };

  const rubricId = crypto.randomUUID();
  const conn = await db.pool.getConnection();

  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO rubrics (id, name, description, defense_type, role, created_by)
       VALUES (?, ?, ?, ?, 'coordinator', ?)`,
      [rubricId, name, description, defenseType, userId]
    );

    for (const [index, row] of criteriaResult.data.entries()) {
      await conn.execute(
        `INSERT INTO rubric_criteria (id, rubric_id, criterion_name, description, weight, \`order\`)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          rubricId,
          row.criterion_name,
          row.description,
          row.weight,
          row.order ?? index,
        ]
      );
    }

    await conn.commit();
    return getCoordinatorRubricById(institutionId, rubricId);
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

async function updateCoordinatorRubric(institutionId, rubricId, payload) {
  const existing = await getCoordinatorRubricById(institutionId, rubricId);
  if (existing.error) return existing;

  const name = String(payload.name || payload.rubricName || existing.data.name).trim();
  const description = String(
    payload.description !== undefined ? payload.description : existing.data.description ?? ''
  ).trim();
  const defenseType = payload.defenseType || payload.defense_type || existing.data.defense_type;
  const criteriaInput = payload.criteria ?? existing.data.criteria;

  if (!name) return { error: 'Rubric name is required', status: 400 };
  if (!description) return { error: 'Rubric description is required', status: 400 };
  if (!['proposal', 'midterm', 'final'].includes(defenseType)) {
    return { error: 'defenseType must be proposal, midterm, or final', status: 400 };
  }

  const criteriaResult = validateRubricCriteria(criteriaInput);
  if (criteriaResult.error) return { error: criteriaResult.error, status: 400 };

  const conn = await db.pool.getConnection();

  try {
    await conn.beginTransaction();
    await conn.execute(
      'UPDATE rubrics SET name = ?, description = ?, defense_type = ? WHERE id = ?',
      [name, description, defenseType, rubricId]
    );
    await conn.execute('DELETE FROM rubric_criteria WHERE rubric_id = ?', [rubricId]);

    for (const [index, row] of criteriaResult.data.entries()) {
      await conn.execute(
        `INSERT INTO rubric_criteria (id, rubric_id, criterion_name, description, weight, \`order\`)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          rubricId,
          row.criterion_name,
          row.description,
          row.weight,
          row.order ?? index,
        ]
      );
    }

    await conn.commit();
    return getCoordinatorRubricById(institutionId, rubricId);
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteCoordinatorRubric(institutionId, rubricId) {
  const existing = await getCoordinatorRubricById(institutionId, rubricId);
  if (existing.error) return existing;

  const { rows: usageRows } = await db.query(
    'SELECT COUNT(*) AS usage_count FROM defenses WHERE rubric_id = ?',
    [rubricId]
  );
  if (usageRows[0]?.usage_count > 0) {
    return { error: 'Cannot delete a rubric that is assigned to a defense', status: 409 };
  }

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM rubric_criteria WHERE rubric_id = ?', [rubricId]);
    await conn.execute('DELETE FROM rubrics WHERE id = ?', [rubricId]);
    await conn.commit();
    return { data: { success: true } };
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

async function createCoordinatorDefenseBookingForCourse(institutionId, coordinatorId, payload) {
  const {
    courseId,
    course_id,
    rubricId,
    rubric_id,
    defenseType,
    defense_type,
    location,
    venue,
    modality,
    forceApprove,
    date,
    startTime,
    endTime,
    scheduledAt,
    start_time,
    end_time,
  } = payload || {};

  const resolvedCourseId = courseId || course_id;
  const resolvedRubricId = rubricId || rubric_id || null;
  const resolvedDefenseType = defenseType || defense_type;
  const panelistIds = normalizePanelistIds(payload);
  const projectIds = normalizeProjectIds(payload);
  const startInput = scheduledAt || start_time || (date && startTime ? `${date}T${startTime}` : null);
  const endInput = end_time || (date && endTime ? `${date}T${endTime}` : null);
  const scheduleWindow = getScheduleWindow({ start_time: startInput, end_time: endInput });

  if (!resolvedCourseId) return { error: 'courseId is required', status: 400 };
  if (!resolvedDefenseType || !['proposal', 'midterm', 'final'].includes(resolvedDefenseType)) {
    return { error: 'defenseType must be one of: proposal, midterm, final', status: 400 };
  }
  if (scheduleWindow.error) return { error: scheduleWindow.error, status: 400 };
  if (!location) return { error: 'location is required', status: 400 };

  const panelistValidation = await validateInstitutionPanelists(institutionId, panelistIds);
  if (panelistValidation.error) {
    return { error: panelistValidation.error, status: panelistValidation.status || 400 };
  }

  const course = await getCourseById(resolvedCourseId);
  if (!course || course.institution_id !== institutionId) {
    return { error: 'Course not found in your institution', status: 404 };
  }

  if (resolvedRubricId) {
    const { rows: rubricRows } = await db.query(
      `SELECT r.id
       FROM rubrics r
       INNER JOIN user_roles ur ON ur.user_id = r.created_by
       WHERE r.id = ? AND ur.institution_id = ?
       LIMIT 1`,
      [resolvedRubricId, institutionId]
    );
    if (!rubricRows.length) {
      return { error: 'Rubric not found in your institution', status: 404 };
    }
  }

  let projectRows = await getProjectsForCourseInInstitution(institutionId, resolvedCourseId);

  if (projectIds.length) {
    const allowedProjectIds = new Set(projectIds);
    projectRows = projectRows.filter((project) => allowedProjectIds.has(project.id));
    if (!projectRows.length) {
      return { error: 'No valid groups selected for this course.', status: 400 };
    }
  }

  if (!projectRows.length) {
    return { error: 'No projects found for this course.', status: 400 };
  }

  const normalizedStart = scheduleWindow.start;
  const normalizedEnd = scheduleWindow.end;
  const conn = await db.pool.getConnection();

  try {
    await conn.beginTransaction();
    const createdDefenses = [];
    const batchProjectIds = projectRows.map((p) => p.id);
    const batchDefenseIds = [];

    for (const project of projectRows) {
      const [memberRows] = await conn.execute(
        `SELECT user_id FROM project_members WHERE project_id = ? AND status = 'accepted'`,
        [project.id]
      );

      const participantIds = Array.from(
        new Set([...memberRows.map((m) => m.user_id), ...panelistIds])
      );
      const conflicts = await getCoordinatorApprovalConflicts({
        defenseId: null,
        projectId: project.id,
        memberIds: participantIds,
        location: venue || location,
        startAt: normalizedStart.dbValue,
        endAt: normalizedEnd.dbValue,
        queryRunner: conn,
        excludeProjectIds: batchProjectIds,
        excludeDefenseIds: batchDefenseIds,
      });

      if (conflicts.length && !forceApprove) {
        await conn.rollback();
        return {
          data: buildCoordinatorConflictPayload(conflicts, normalizedStart.dateValue, normalizedEnd.dateValue),
        };
      }

      const [idRows] = await conn.execute('SELECT UUID() AS id');
      const defenseId = idRows[0].id;
      const resolvedModalityForInsert = modality || 'Online';
      const jitsi = createJitsiMeetingFields({
        prefix: JITSI_DEFENSE_PREFIX,
        recordId: defenseId,
        modality: resolvedModalityForInsert,
      });

      await conn.execute(
        `INSERT INTO defenses (
          id, project_id, defense_type, rubric_id, scheduled_at, end_time, location, venue, modality,
          status, created_by, meeting_room, meeting_url, meeting_provider
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)`,
        [
          defenseId,
          project.id,
          resolvedDefenseType,
          resolvedRubricId,
          normalizedStart.dbValue,
          normalizedEnd.dbValue,
          location,
          venue || null,
          resolvedModalityForInsert,
          coordinatorId,
          jitsi.meeting_room,
          jitsi.meeting_url,
          jitsi.meeting_provider,
        ]
      );

      if (panelistIds.length) {
        await assignDefensePanelists(conn, defenseId, panelistIds);
      }

      createdDefenses.push({ id: defenseId, project_title: project.title, project_code: project.project_code });
      batchDefenseIds.push(defenseId);

      const defenseTypeLabel = `${resolvedDefenseType.charAt(0).toUpperCase() + resolvedDefenseType.slice(1)}`;
      const scheduleMessage = appendMeetingLinkToMessage(
        `The ${resolvedDefenseType} defense for "${project.title}" has been scheduled.`,
        jitsi.meeting_url
      );

      for (const member of memberRows) {
        await createNotification({
          userId: member.user_id,
          type: 'schedule',
          title: `${defenseTypeLabel} Defense Scheduled`,
          message: scheduleMessage,
          metadata: {
            defenseId,
            projectId: project.id,
            courseId: resolvedCourseId,
            meetingUrl: jitsi.meeting_url,
            meetingRoom: jitsi.meeting_room,
          },
          conn,
        });
      }

      for (const panelistId of panelistIds) {
        await createNotification({
          userId: panelistId,
          type: 'schedule',
          title: `${defenseTypeLabel} Defense Panel Assignment`,
          message: appendMeetingLinkToMessage(
            `You were assigned as a panelist for the ${resolvedDefenseType} defense of "${project.title}".`,
            jitsi.meeting_url
          ),
          metadata: {
            defenseId,
            projectId: project.id,
            courseId: resolvedCourseId,
            role: 'panelist',
            meetingUrl: jitsi.meeting_url,
            meetingRoom: jitsi.meeting_room,
          },
          conn,
        });
      }
    }

    await conn.commit();
    return { data: createdDefenses[0] || { count: createdDefenses.length } };
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

async function createCoordinatorDefenseBooking(institutionId, coordinatorId, payload) {
  const courseId = payload?.courseId || payload?.course_id;
  if (courseId) {
    return createCoordinatorDefenseBookingForCourse(institutionId, coordinatorId, payload);
  }

  const {
    projectId,
    project_id,
    rubricId,
    rubric_id,
    defenseType,
    defense_type,
    location,
    venue,
    modality,
    forceApprove,
    date,
    startTime,
    endTime,
    scheduledAt,
    start_time,
    end_time,
  } = payload || {};

  const resolvedProjectId = projectId || project_id;
  const resolvedRubricId = rubricId || rubric_id || null;
  const resolvedDefenseType = defenseType || defense_type;
  const panelistIds = normalizePanelistIds(payload);
  const startInput = scheduledAt || start_time || (date && startTime ? `${date}T${startTime}` : null);
  const endInput = end_time || (date && endTime ? `${date}T${endTime}` : null);
  const scheduleWindow = getScheduleWindow({ start_time: startInput, end_time: endInput });

  if (!resolvedProjectId) return { error: 'projectId or courseId is required', status: 400 };
  if (!resolvedDefenseType || !['proposal', 'midterm', 'final'].includes(resolvedDefenseType)) {
    return { error: 'defenseType must be one of: proposal, midterm, final', status: 400 };
  }
  if (scheduleWindow.error) return { error: scheduleWindow.error, status: 400 };
  if (!location) return { error: 'location is required', status: 400 };

  const panelistValidation = await validateInstitutionPanelists(institutionId, panelistIds);
  if (panelistValidation.error) {
    return { error: panelistValidation.error, status: panelistValidation.status || 400 };
  }

  const { rows: projectRows } = await db.query(
    `SELECT p.id, p.title, p.project_code
     FROM projects p
     LEFT JOIN courses c ON p.course_id = c.id
     WHERE p.id = ? AND ${coordinatorProjectScopeSql('p', 'c')}
     LIMIT 1`,
    [resolvedProjectId, ...coordinatorProjectScopeBinds(institutionId)]
  );

  const project = projectRows[0];
  if (!project) {
    return { error: 'Project not found in your institution', status: 404 };
  }

  if (resolvedRubricId) {
    const { rows: rubricRows } = await db.query(
      `SELECT r.id
       FROM rubrics r
       INNER JOIN user_roles ur ON ur.user_id = r.created_by
       WHERE r.id = ? AND ur.institution_id = ?
       LIMIT 1`,
      [resolvedRubricId, institutionId]
    );
    if (!rubricRows.length) {
      return { error: 'Rubric not found in your institution', status: 404 };
    }
  }

  const normalizedStart = scheduleWindow.start;
  const normalizedEnd = scheduleWindow.end;

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    const [memberRows] = await conn.execute(
      `SELECT user_id
       FROM project_members
       WHERE project_id = ?
         AND status = 'accepted'`,
      [resolvedProjectId]
    );

    const targetVenue = venue || location;
    const participantIds = Array.from(
      new Set([...memberRows.map((member) => member.user_id), ...panelistIds])
    );
    const conflicts = await getCoordinatorApprovalConflicts({
      defenseId: null,
      projectId: resolvedProjectId,
      memberIds: participantIds,
      location: targetVenue,
      startAt: normalizedStart.dbValue,
      endAt: normalizedEnd.dbValue,
      queryRunner: conn,
    });

    if (conflicts.length && !forceApprove) {
      await conn.rollback();
      return {
        data: buildCoordinatorConflictPayload(conflicts, normalizedStart.dateValue, normalizedEnd.dateValue),
      };
    }

    const [idRows] = await conn.execute('SELECT UUID() AS id');
    const defenseId = idRows[0].id;
    const resolvedModalityForInsert = modality || 'Online';
    const jitsi = createJitsiMeetingFields({
      prefix: JITSI_DEFENSE_PREFIX,
      recordId: defenseId,
      modality: resolvedModalityForInsert,
    });

    await conn.execute(
      `INSERT INTO defenses (
        id, project_id, defense_type, rubric_id, scheduled_at, end_time, location, venue, modality,
        status, created_by, meeting_room, meeting_url, meeting_provider
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)`,
      [
        defenseId,
        resolvedProjectId,
        resolvedDefenseType,
        resolvedRubricId,
        normalizedStart.dbValue,
        normalizedEnd.dbValue,
        location,
        venue || null,
        resolvedModalityForInsert,
        coordinatorId,
        jitsi.meeting_room,
        jitsi.meeting_url,
        jitsi.meeting_provider,
      ]
    );

    if (panelistIds.length) {
      await assignDefensePanelists(conn, defenseId, panelistIds);
    }

    const dateStr = normalizedStart.dateValue.toLocaleDateString();
    const timeStr = normalizedStart.dateValue.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const defenseTypeLabel = `${resolvedDefenseType.charAt(0).toUpperCase() + resolvedDefenseType.slice(1)}`;
    const notifTitle = `${defenseTypeLabel} Defense Scheduled`;
    const notifMessage = appendMeetingLinkToMessage(
      `The ${resolvedDefenseType} defense for "${project.title}" has been scheduled on ${dateStr} at ${timeStr}.`,
      jitsi.meeting_url
    );

    for (const member of memberRows) {
      await createNotification({
        userId: member.user_id,
        type: 'schedule',
        title: notifTitle,
        message: notifMessage,
        metadata: {
          defenseId,
          projectId: resolvedProjectId,
          schedule: normalizedStart.dbValue,
          meetingUrl: jitsi.meeting_url,
          meetingRoom: jitsi.meeting_room,
        },
        conn,
      });
    }

    for (const panelistId of panelistIds) {
      await createNotification({
        userId: panelistId,
        type: 'schedule',
        title: `${defenseTypeLabel} Defense Panel Assignment`,
        message: appendMeetingLinkToMessage(
          `You were assigned as a panelist for the ${resolvedDefenseType} defense of "${project.title}" on ${dateStr} at ${timeStr}.`,
          jitsi.meeting_url
        ),
        metadata: {
          defenseId,
          projectId: resolvedProjectId,
          role: 'panelist',
          schedule: normalizedStart.dbValue,
          meetingUrl: jitsi.meeting_url,
          meetingRoom: jitsi.meeting_room,
        },
        conn,
      });
    }

    await conn.commit();

    const { rows: createdRows } = await db.query(
      `SELECT d.*, p.title AS project_title, p.project_code,
              ${DEFENSE_PANELIST_NAMES_SQL}
       FROM defenses d
       JOIN projects p ON p.id = d.project_id
       WHERE d.id = ?
       LIMIT 1`,
      [defenseId]
    );

    return { data: createdRows[0] };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function getProjectsByInstitution(institutionId) {
  const { rows } = await db.query(
    `SELECT DISTINCT
       p.id, p.title, p.project_code, p.status, p.project_type, p.created_at, p.updated_at,
       p.course_id, p.course AS course_label,
       c.course_name, c.code AS course_code
     FROM projects p
     INNER JOIN project_members pm
       ON pm.project_id = p.id
      AND pm.role = 'adviser'
      AND pm.status = 'accepted'
     LEFT JOIN courses c ON c.id = p.course_id
     WHERE p.institution_id = ?
     ORDER BY p.created_at DESC`,
    [institutionId],
  );
  return rows;
}

async function getProjectsByAdviserInInstitution(institutionId) {
  const { rows } = await db.query(
    `SELECT
       u.id AS adviser_id, u.full_name AS adviser_name, u.email AS adviser_email, u.avatar_url AS adviser_avatar,
       p.id AS project_id, p.title AS project_title, p.project_code, p.status AS project_status,
       p.project_type, p.created_at AS project_created_at
     FROM users u
     INNER JOIN (
       SELECT ca.user_id
       FROM course_advisers ca
       INNER JOIN courses c ON c.id = ca.course_id AND c.institution_id = ?
       UNION
       SELECT pm.user_id
       FROM project_members pm
       INNER JOIN projects proj ON proj.id = pm.project_id
       WHERE pm.role = 'adviser'
         AND pm.status = 'accepted'
         AND proj.institution_id = ?
     ) scoped_advisers ON scoped_advisers.user_id = u.id
     LEFT JOIN project_members pm
       ON pm.user_id = u.id
      AND pm.role = 'adviser'
      AND pm.status = 'accepted'
     LEFT JOIN projects p
       ON p.id = pm.project_id
      AND p.institution_id = ?
     ORDER BY u.full_name ASC, p.title ASC`,
    [institutionId, institutionId, institutionId],
  );

  const adviserMap = new Map();
  for (const row of rows) {
    if (!adviserMap.has(row.adviser_id)) {
      adviserMap.set(row.adviser_id, {
        id: row.adviser_id,
        full_name: row.adviser_name,
        email: row.adviser_email,
        avatar_url: row.adviser_avatar,
        projects: [],
      });
    }
    if (row.project_id) {
      const adviserEntry = adviserMap.get(row.adviser_id);
      if (!adviserEntry.projects.some((proj) => proj.id === row.project_id)) {
        adviserEntry.projects.push({
          id: row.project_id,
          title: row.project_title,
          project_code: row.project_code,
          status: row.project_status,
          project_type: row.project_type,
          created_at: row.project_created_at,
        });
      }
    }
  }

  return Array.from(adviserMap.values());
}

module.exports = {
  getInstitutionByCoordinator,
  getInstitutionById,
  getAdvisersInInstitution,
  getPanelistsInInstitution,
  addAdviserToInstitution,
  removeAdviserFromInstitution,
  removeAdviserFromCourse,
  getCoursesByInstitution,
  getCoursesWithAdvisersByInstitution,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
  getPendingDefenses,
  getAllDefensesForInstitution,
  verifyDefense,
  rejectDefense,
  setDefenseVenue,
  deleteDefense,
  cancelCoordinatorDefense,
  completeCoordinatorDefense,
  revertCoordinatorDefense,
  getCoordinatorStats,
  createDefenseForCourse,
  createCoordinatorDefenseBooking,
  listRubrics,
  getCoordinatorRubricById,
  createCoordinatorRubric,
  updateCoordinatorRubric,
  deleteCoordinatorRubric,
  getProjectsByInstitution,
  getProjectsByAdviserInInstitution,
  getProjectsForCourseInInstitution,
};
