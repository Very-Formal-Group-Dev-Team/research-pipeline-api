const db = require('../../../config/db');
const { createNotification } = require('../notifications/notifications.service');

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

function getScheduleWindow(payload = {}) {
  const startInput = payload.start_time ?? payload.scheduled_at ?? payload.scheduledAt ?? null;
  const endInput = payload.end_time ?? payload.endTime ?? null;

  if (!startInput) {
    return { error: 'start_time is required' };
  }

  if (!endInput) {
    return { error: 'end_time is required' };
  }

  const start = normalizeDateTimeInput(startInput);
  if (!start) {
    return { error: 'start_time must be a valid datetime value' };
  }

  const end = normalizeDateTimeInput(endInput);
  if (!end) {
    return { error: 'end_time must be a valid datetime value' };
  }

  if (end.dateValue <= start.dateValue) {
    return { error: 'end_time must be after start_time' };
  }

  return { start, end };
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

async function getCoordinatorApprovalConflicts({ defenseId = null, projectId, memberIds, location, startAt, endAt, queryRunner }) {
  const statuses = ['approved', 'moved', 'scheduled'];
  const allConflicts = [];

  const [projectRows] = await queryRunner.execute(
    `SELECT id, project_id,
            scheduled_at AS start_time,
            COALESCE(end_time, scheduled_at) AS end_time
     FROM defenses
     WHERE (? IS NULL OR id <> ?)
       AND project_id = ?
       AND status IN (?, ?, ?)
       AND scheduled_at < ?
       AND COALESCE(end_time, scheduled_at) > ?`,
    [defenseId, defenseId, projectId, ...statuses, endAt, startAt]
  );

  for (const row of projectRows) {
    allConflicts.push({
      domain: 'project',
      defense_id: row.id,
      project_id: row.project_id,
      start_time: row.start_time,
      end_time: row.end_time,
      start_date: toDate(row.start_time),
      end_date: toDate(row.end_time || row.start_time),
    });
  }

  if (location && String(location).toLowerCase() !== 'online') {
    const [locationRows] = await queryRunner.execute(
      `SELECT id, project_id,
              scheduled_at AS start_time,
              COALESCE(end_time, scheduled_at) AS end_time
       FROM defenses
       WHERE (? IS NULL OR id <> ?)
         AND status IN (?, ?, ?)
         AND COALESCE(venue, location) = ?
         AND scheduled_at < ?
         AND COALESCE(end_time, scheduled_at) > ?`,
      [defenseId, defenseId, ...statuses, location, endAt, startAt]
    );

    for (const row of locationRows) {
      allConflicts.push({
        domain: 'room',
        defense_id: row.id,
        project_id: row.project_id,
        start_time: row.start_time,
        end_time: row.end_time,
        start_date: toDate(row.start_time),
        end_date: toDate(row.end_time || row.start_time),
      });
    }
  }

  if (memberIds.length) {
    const memberPlaceholders = memberIds.map(() => '?').join(', ');
    const [participantRows] = await queryRunner.execute(
      `SELECT DISTINCT d.id, d.project_id,
              scheduled_at AS start_time,
              COALESCE(d.end_time, d.scheduled_at) AS end_time
       FROM defenses d
       JOIN project_members pm
         ON pm.project_id = d.project_id
        AND pm.status = 'accepted'
       WHERE (? IS NULL OR d.id <> ?)
         AND pm.user_id IN (${memberPlaceholders})
         AND d.status IN (?, ?, ?)
         AND d.scheduled_at < ?
         AND COALESCE(d.end_time, d.scheduled_at) > ?`,
      [defenseId, defenseId, ...memberIds, ...statuses, endAt, startAt]
    );

    for (const row of participantRows) {
      allConflicts.push({
        domain: 'participant',
        defense_id: row.id,
        project_id: row.project_id,
        start_time: row.start_time,
        end_time: row.end_time,
        start_date: toDate(row.start_time),
        end_date: toDate(row.end_time || row.start_time),
      });
    }
  }

  const deduped = Array.from(new Map(allConflicts.map((item) => [item.defense_id, item])).values());
  return deduped;
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

  const assignmentResult = await db.query(
    `INSERT INTO project_members (id, project_id, user_id, role, status, invited_at, responded_at)
     SELECT UUID(), p.id, ?, 'adviser', 'accepted', NOW(), NOW()
     FROM projects p
     WHERE p.institution_id = ?
       AND p.course_id = ?
       AND NOT EXISTS (
         SELECT 1
         FROM project_members pm
         WHERE pm.project_id = p.id
           AND pm.user_id = ?
           AND pm.role = 'adviser'
       )`,
    [adviserId, institutionId, courseId, adviserId]
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

async function getCourseById(courseId) {
  const { rows } = await db.query(
    'SELECT * FROM courses WHERE id = ? LIMIT 1',
    [courseId]
  );
  return rows[0] || null;
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
            u.full_name AS created_by_name
     FROM defenses d
     INNER JOIN projects p ON d.project_id = p.id
     LEFT JOIN users u ON d.created_by = u.id
     WHERE p.institution_id = ?
       AND d.status = 'pending'
     ORDER BY ${scheduleExpr} ASC`,
    [institutionId]
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
            au.full_name AS adviser_name
     FROM defenses d
     INNER JOIN projects p ON d.project_id = p.id
     LEFT JOIN users u ON d.created_by = u.id
     LEFT JOIN users au ON d.adviser_id = au.id
     WHERE p.institution_id = ?
     ORDER BY ${scheduleExpr} DESC`,
    [institutionId]
  );
  return rows.map(normalizeDefenseTimeRange);
}

async function verifyDefense(defenseId, coordinatorId, { venue, verifiedSchedule, verifiedEndTime, notes, forceApprove }) {
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

    const targetLocation = venue || defense.venue || defense.location || null;
    const conflicts = await getCoordinatorApprovalConflicts({
      defenseId,
      projectId: defense.project_id,
      memberIds: memberRows.map((member) => member.user_id),
      location: targetLocation,
      startAt: proposedStart,
      endAt: proposedEnd,
      queryRunner: conn,
    });

    if (conflicts.length && !forceApprove) {
      await conn.rollback();
      return {
        data: buildCoordinatorConflictPayload(conflicts, proposedStartDate, proposedEndDate),
      };
    }

    // Determine status: 'moved' if schedule was changed, otherwise 'approved'
    const scheduleMoved = verifiedSchedule && verifiedSchedule !== defense.scheduled_at?.toISOString?.();
    const newStatus = scheduleMoved ? 'moved' : 'approved';
    const notifType = scheduleMoved ? 'defense_moved' : 'defense_approved';

    // Update defense schedule and status without requiring verification columns.
    await conn.execute(
      `UPDATE defenses
       SET venue = COALESCE(?, venue),
           scheduled_at = ?,
           end_time = ?,
           verified_schedule = ?,
           status = ?
       WHERE id = ?`,
      [venue || null, proposedStart, proposedEnd, proposedStart, newStatus, defenseId]
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
        venue || defense.venue || defense.location,
        notes || null,
      ]
    );

    // Notify all project members
    const members = memberRows;

    const finalSchedule = proposedStart;
    const dateStr = new Date(finalSchedule).toLocaleDateString();
    const timeStr = new Date(finalSchedule).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const modality = defense.modality || 'Online';

    const notifTitle = scheduleMoved
      ? `Defense Schedule Modified & Approved`
      : `Defense Approved`;
    const notifMessage = scheduleMoved
      ? `The ${defense.defense_type} defense for "${defense.project_title}" has been approved with a new schedule: ${dateStr} at ${timeStr} (${modality}).`
      : `The ${defense.defense_type} defense for "${defense.project_title}" has been approved for ${dateStr} at ${timeStr} (${modality}).`;

    for (const member of members) {
      await createNotification({
        userId: member.user_id,
        type: notifType,
        title: notifTitle,
        message: notifMessage,
        metadata: { defenseId, projectId: defense.project_id, schedule: finalSchedule, modality },
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

// ─── Dashboard Stats ────────────────────────────────────────────────────────

async function getCoordinatorStats(institutionId) {
  const [projectsResult, advisersResult, defensesResult, coursesResult] = await Promise.all([
    db.query(
      'SELECT COUNT(*) AS count FROM projects WHERE institution_id = ?',
      [institutionId]
    ),
    db.query(
      `SELECT COUNT(*) AS count FROM user_roles WHERE institution_id = ? AND role = 'adviser'`,
      [institutionId]
    ),
    db.query(
      `SELECT COUNT(*) AS count FROM defenses d
       INNER JOIN projects p ON d.project_id = p.id
       WHERE p.institution_id = ?
         AND d.status = 'pending'`,
      [institutionId]
    ),
    db.query(
      'SELECT COUNT(*) AS count FROM courses WHERE institution_id = ?',
      [institutionId]
    ),
  ]);

  return {
    totalProjects: projectsResult.rows[0]?.count || 0,
    totalAdvisers: advisersResult.rows[0]?.count || 0,
    pendingDefenses: defensesResult.rows[0]?.count || 0,
    totalCourses: coursesResult.rows[0]?.count || 0,
  };
}

async function createDefenseForCourse(institutionId, coordinatorId, payload) {
  const { courseId, defenseType, scheduledAt, date, startTime, endTime, location, venue } = payload;

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

  // Resolve adviser IDs for the selected course first.
  const { rows: courseAdviserRows } = await db.query(
    `SELECT DISTINCT pm.user_id
     FROM projects p
     JOIN project_members pm
       ON pm.project_id = p.id
      AND pm.role = 'adviser'
      AND pm.status = 'accepted'
     WHERE p.institution_id = ?
       AND p.course_id = ?`,
    [institutionId, courseId]
  );

  let adviserIds = courseAdviserRows.map((row) => row.user_id);

  // Fallback: if the selected course currently has no adviser-project links,
  // use institution advisers and discover their advised projects.
  if (!adviserIds.length) {
    const { rows: institutionAdviserRows } = await db.query(
      `SELECT DISTINCT user_id
       FROM user_roles
       WHERE institution_id = ?
         AND role = 'adviser'`,
      [institutionId]
    );

    adviserIds = institutionAdviserRows.map((row) => row.user_id);
  }

  if (!adviserIds.length) {
    return { error: 'No advisers found for this institution.' };
  }

  const adviserPlaceholders = adviserIds.map(() => '?').join(', ');

  const { rows: projectAdviserRows } = await db.query(
    `SELECT DISTINCT p.id, p.title, p.project_code, pm.user_id AS adviser_id
     FROM projects p
     JOIN project_members pm
       ON pm.project_id = p.id
      AND pm.role = 'adviser'
      AND pm.status = 'accepted'
     WHERE p.institution_id = ?
       AND pm.user_id IN (${adviserPlaceholders})`,
    [institutionId, ...adviserIds]
  );

  if (projectAdviserRows.length === 0) {
    return { error: 'No adviser-linked projects found for defense event creation.' };
  }

  const createdDefenses = [];
  const notifiedProjects = new Set();

  for (const row of projectAdviserRows) {
    await db.query(
      `INSERT INTO defenses (id, project_id, adviser_id, defense_type, scheduled_at, end_time, location, venue, status, created_by)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
      [row.id, row.adviser_id, defenseType, normalizedStart.dbValue, normalizedEnd.dbValue, location, venue || null, coordinatorId]
    );

    const { rows: defenseRows } = await db.query(
      `SELECT *
       FROM defenses
       WHERE project_id = ?
         AND adviser_id = ?
         AND created_by = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [row.id, row.adviser_id, coordinatorId]
    );

    if (defenseRows[0]) {
      createdDefenses.push({ ...defenseRows[0], project_title: row.title, project_code: row.project_code });
    }

    if (notifiedProjects.has(row.id)) {
      continue;
    }

    notifiedProjects.add(row.id);

    const { rows: members } = await db.query(
      'SELECT user_id FROM project_members WHERE project_id = ?',
      [row.id]
    );

    const notifTitle = `${defenseType.charAt(0).toUpperCase() + defenseType.slice(1)} Defense Scheduled`;
    const notifMessage = `A ${defenseType} defense for "${row.title}" has been scheduled on ${normalizedStart.dateValue.toLocaleDateString()} at ${normalizedStart.dateValue.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;

    for (const member of members) {
      await createNotification({
        userId: member.user_id,
        type: 'schedule',
        title: notifTitle,
        message: notifMessage,
        metadata: { projectId: row.id },
      });
    }
  }

  return { data: { count: createdDefenses.length, defenses: createdDefenses } };
}

async function createCoordinatorDefenseBooking(institutionId, coordinatorId, payload) {
  const {
    projectId,
    project_id,
    defenseType,
    defense_type,
    location,
    venue,
    modality,
    forceApprove,
  } = payload || {};

  const resolvedProjectId = projectId || project_id;
  const resolvedDefenseType = defenseType || defense_type;
  const scheduleWindow = getScheduleWindow(payload || {});

  if (!resolvedProjectId) return { error: 'projectId is required', status: 400 };
  if (!resolvedDefenseType || !['proposal', 'midterm', 'final'].includes(resolvedDefenseType)) {
    return { error: 'defenseType must be one of: proposal, midterm, final', status: 400 };
  }
  if (scheduleWindow.error) return { error: scheduleWindow.error, status: 400 };
  if (!location) return { error: 'location is required', status: 400 };

  const { rows: projectRows } = await db.query(
    `SELECT id, title, project_code
     FROM projects
     WHERE id = ? AND institution_id = ?
     LIMIT 1`,
    [resolvedProjectId, institutionId]
  );

  const project = projectRows[0];
  if (!project) {
    return { error: 'Project not found in your institution', status: 404 };
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
    const conflicts = await getCoordinatorApprovalConflicts({
      defenseId: null,
      projectId: resolvedProjectId,
      memberIds: memberRows.map((member) => member.user_id),
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

    await conn.execute(
      `INSERT INTO defenses (
        id, project_id, defense_type, scheduled_at, end_time, location, venue, modality,
        status, verified_by, verified_at, verified_schedule, created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, NOW(), ?, ?)`,
      [
        defenseId,
        resolvedProjectId,
        resolvedDefenseType,
        normalizedStart.dbValue,
        normalizedEnd.dbValue,
        location,
        venue || null,
        modality || 'Online',
        coordinatorId,
        normalizedStart.dbValue,
        coordinatorId,
      ]
    );

    const dateStr = normalizedStart.dateValue.toLocaleDateString();
    const timeStr = normalizedStart.dateValue.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const notifTitle = `${resolvedDefenseType.charAt(0).toUpperCase() + resolvedDefenseType.slice(1)} Defense Scheduled`;
    const notifMessage = `The ${resolvedDefenseType} defense for "${project.title}" has been scheduled on ${dateStr} at ${timeStr}.`;

    for (const member of memberRows) {
      await createNotification({
        userId: member.user_id,
        type: 'schedule',
        title: notifTitle,
        message: notifMessage,
        metadata: { defenseId, projectId: resolvedProjectId, schedule: normalizedStart.dbValue },
        conn,
      });
    }

    await conn.commit();

    const { rows: createdRows } = await db.query(
      `SELECT d.*, p.title AS project_title, p.project_code
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
    `SELECT
       p.id, p.title, p.project_code, p.status, p.project_type, p.created_at, p.updated_at,
       p.course_id,
       c.course_name, c.code AS course_code
     FROM projects p
     LEFT JOIN courses c ON p.course_id = c.id
     WHERE p.institution_id = ?
     ORDER BY p.created_at DESC`,
    [institutionId]
  );
  return rows;
}

async function getProjectsByAdviserInInstitution(institutionId) {
  const { rows } = await db.query(
    `SELECT
       u.id AS adviser_id, u.full_name AS adviser_name, u.email AS adviser_email, u.avatar_url AS adviser_avatar,
       p.id AS project_id, p.title AS project_title, p.project_code, p.status AS project_status,
       p.project_type, p.created_at AS project_created_at
     FROM user_roles ur
     INNER JOIN users u ON u.id = ur.user_id
     LEFT JOIN project_members pm ON pm.user_id = u.id AND pm.role = 'adviser'
     LEFT JOIN projects p ON p.id = pm.project_id
     WHERE ur.institution_id = ? AND ur.role = 'adviser'
     ORDER BY u.full_name ASC, p.title ASC`,
    [institutionId]
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
      adviserMap.get(row.adviser_id).projects.push({
        id: row.project_id,
        title: row.project_title,
        project_code: row.project_code,
        status: row.project_status,
        project_type: row.project_type,
        created_at: row.project_created_at,
      });
    }
  }

  return Array.from(adviserMap.values());
}

module.exports = {
  getInstitutionByCoordinator,
  getInstitutionById,
  getAdvisersInInstitution,
  addAdviserToInstitution,
  removeAdviserFromInstitution,
  getCoursesByInstitution,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
  getPendingDefenses,
  getAllDefensesForInstitution,
  verifyDefense,
  rejectDefense,
  setDefenseVenue,
  getCoordinatorStats,
  createDefenseForCourse,
  createCoordinatorDefenseBooking,
  getProjectsByInstitution,
  getProjectsByAdviserInInstitution,
};
