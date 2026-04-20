const db = require('../../../config/db');
const { createNotification } = require('../notifications/notifications.service');

const ADVISER_BOOKING_TABLE = 'meetings';

function formatScheduleLabel(dateValue) {
  const datePart = dateValue.toLocaleDateString();
  const timePart = dateValue.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${datePart} at ${timePart}`;
}

async function getAcceptedProjectMembersWithTitle(projectId, queryRunner = db) {
  const rows = await queryRows(
    queryRunner,
    `SELECT pm.user_id, p.title
     FROM project_members pm
     JOIN projects p ON p.id = pm.project_id
     WHERE pm.project_id = ?
       AND pm.status = 'accepted'`,
    [projectId]
  );

  return {
    projectTitle: rows[0]?.title || 'your project',
    userIds: rows.map((row) => row.user_id).filter(Boolean),
  };
}

async function notifyProjectMembers({
  projectId,
  title,
  message,
  metadata,
  excludeUserId = null,
  conn = null,
}) {
  const queryRunner = conn || db;
  const { userIds } = await getAcceptedProjectMembersWithTitle(projectId, queryRunner);
  const recipients = userIds.filter((id) => id && id !== excludeUserId);

  if (!recipients.length) return;

  await Promise.all(
    recipients.map((userId) => createNotification({
      userId,
      type: 'schedule',
      title,
      message,
      metadata,
      conn,
    }))
  );
}

async function getInstitutionCoordinatorIds(institutionId, queryRunner = db) {
  const rows = await queryRows(
    queryRunner,
    `SELECT DISTINCT user_id
     FROM user_roles
     WHERE institution_id = ?
       AND role = 'coordinator'`,
    [institutionId]
  );
  return rows.map((row) => row.user_id).filter(Boolean);
}

async function notifyInstitutionCoordinators({
  institutionId,
  title,
  message,
  metadata,
  excludeUserId = null,
  conn = null,
}) {
  if (!institutionId) return;

  const queryRunner = conn || db;
  const userIds = await getInstitutionCoordinatorIds(institutionId, queryRunner);
  const recipients = userIds.filter((id) => id && id !== excludeUserId);

  if (!recipients.length) return;

  await Promise.all(
    recipients.map((userId) => createNotification({
      userId,
      type: 'schedule',
      title,
      message,
      metadata,
      conn,
    }))
  );
}

function toDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateToDbUtc(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function normalizeDateTimeInput(value) {
  // mysql2 returns DATETIME columns as JS Date objects, handle them directly.
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (n) => String(n).padStart(2, '0');
    const dbValue = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
    return { dbValue, dateValue: value };
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Keep local wall-clock input unchanged for DATETIME storage to avoid timezone shifts.
  const localNoZone = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/;
  const localMatch = trimmed.match(localNoZone);
  if (localMatch) {
    const datePart = localMatch[1];
    const timePart = localMatch[2];
    const secondsPart = localMatch[3] || ':00';
    const isoLocal = `${datePart}T${timePart}${secondsPart}`;
    const parsedLocal = toDate(isoLocal);
    if (!parsedLocal) return null;
    return {
      dbValue: `${datePart} ${timePart}${secondsPart}`,
      dateValue: parsedLocal,
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

  const normalizedStart = normalizeDateTimeInput(startInput);
  if (!normalizedStart) {
    return { error: 'start_time must be a valid datetime value' };
  }

  const normalizedEnd = normalizeDateTimeInput(endInput);
  if (!normalizedEnd) {
    return { error: 'end_time must be a valid datetime value' };
  }

  if (normalizedEnd.dateValue <= normalizedStart.dateValue) {
    return { error: 'end_time must be after start_time' };
  }

  return {
    start: normalizedStart,
    end: normalizedEnd,
  };
}

function computeOverlapMinutes(rangeStart, rangeEnd, candidateStart, candidateEnd) {
  const overlapStart = Math.max(rangeStart.getTime(), candidateStart.getTime());
  const overlapEnd = Math.min(rangeEnd.getTime(), candidateEnd.getTime());
  if (overlapEnd <= overlapStart) return 0;
  return Math.round((overlapEnd - overlapStart) / 60000);
}

function buildConflictPayload(conflicts, normalizedStart, normalizedEnd, message) {
  const candidateTotalMinutes = Math.max(
    0,
    Math.round((normalizedEnd.dateValue.getTime() - normalizedStart.dateValue.getTime()) / 60000)
  );

  const normalizedConflicts = conflicts.map((conflict) => {
    const overlapMinutes = computeOverlapMinutes(
      conflict.start_date,
      conflict.end_date,
      normalizedStart.dateValue,
      normalizedEnd.dateValue
    );

    return {
      domain: conflict.domain,
      source_table: conflict.source_table,
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
    effective_start_time: normalizedStart.dbValue,
    message,
  };
}

async function queryRows(queryRunner, sql, params) {
  if (queryRunner && typeof queryRunner.execute === 'function') {
    const [rows] = await queryRunner.execute(sql, params);
    return rows;
  }
  const result = await db.query(sql, params);
  return result.rows;
}

const SCHEDULE_SOURCE_CONFIG = {
  meetings: {
    tableName: 'meetings',
    startCandidates: ['scheduled_at', 'start_time', 'meeting_start', 'meeting_time', 'created_at'],
    endCandidates: ['end_time', 'meeting_end'],
    locationCandidates: ['venue', 'location', 'room'],
    statusCandidates: ['status'],
  },
  defenses: {
    tableName: 'defenses',
    startCandidates: ['scheduled_at', 'verified_schedule', 'proposed_schedule', 'created_at'],
    endCandidates: ['end_time'],
    locationCandidates: ['venue', 'location'],
    statusCandidates: ['status'],
  },
};

const scheduleSourceCache = new Map();

function pickFirstExistingColumn(columns, candidates) {
  for (const candidate of candidates) {
    if (columns.has(candidate)) return candidate;
  }
  return null;
}

function buildInClausePlaceholders(items) {
  return items.map(() => '?').join(', ');
}

async function getTableColumns(tableName, queryRunner = db) {
  const rows = await queryRows(
    queryRunner,
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [tableName]
  );

  return new Set(rows.map((row) => row.COLUMN_NAME));
}

function buildCoalesceExpr(alias, columns, candidates) {
  const parts = candidates
    .filter((candidate) => columns.has(candidate))
    .map((candidate) => `${alias}.${candidate}`);

  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  return `COALESCE(${parts.join(', ')})`;
}

async function resolveScheduleSource(sourceName, queryRunner = db) {
  if (!sourceName || !SCHEDULE_SOURCE_CONFIG[sourceName]) {
    return null;
  }

  if (scheduleSourceCache.has(sourceName)) {
    return scheduleSourceCache.get(sourceName);
  }

  const config = SCHEDULE_SOURCE_CONFIG[sourceName];
  const columns = await getTableColumns(config.tableName, queryRunner);
  if (!columns.size) {
    scheduleSourceCache.set(sourceName, null);
    return null;
  }

  if (!columns.has('id') || !columns.has('project_id')) {
    scheduleSourceCache.set(sourceName, null);
    return null;
  }

  const alias = 's';
  const startExpr = buildCoalesceExpr(alias, columns, config.startCandidates);
  if (!startExpr) {
    scheduleSourceCache.set(sourceName, null);
    return null;
  }

  const endExpr = buildCoalesceExpr(alias, columns, config.endCandidates) || startExpr;
  const locationExpr = buildCoalesceExpr(alias, columns, config.locationCandidates);
  const statusColumn = pickFirstExistingColumn(columns, config.statusCandidates);

  const resolved = {
    key: sourceName,
    tableName: config.tableName,
    alias,
    startExpr,
    endExpr,
    locationExpr,
    statusColumn,
  };

  scheduleSourceCache.set(sourceName, resolved);
  return resolved;
}

function buildStatusFilterClause(source, statuses) {
  if (!source.statusColumn || !statuses?.length) {
    return { sql: '', params: [] };
  }

  const placeholders = buildInClausePlaceholders(statuses);
  return {
    sql: ` AND ${source.alias}.${source.statusColumn} IN (${placeholders})`,
    params: [...statuses],
  };
}

async function getProjectMemberGroups(projectId, fallbackUserId, queryRunner = db) {
  const rows = await queryRows(
    queryRunner,
    `SELECT user_id, role
     FROM project_members
     WHERE project_id = ? AND status = 'accepted'`,
    [projectId]
  );

  const teacherIds = new Set();
  const studentIds = new Set();

  for (const row of rows) {
    if (row.role === 'adviser') {
      teacherIds.add(row.user_id);
    } else {
      studentIds.add(row.user_id);
    }
  }

  if (!teacherIds.size && fallbackUserId) {
    teacherIds.add(fallbackUserId);
  }

  return {
    teacherIds: Array.from(teacherIds),
    studentIds: Array.from(studentIds),
  };
}

async function getProjectSchedulesForSource(source, projectId, startAt, endAt, statuses, queryRunner = db) {
  const statusFilter = buildStatusFilterClause(source, statuses);
  const rows = await queryRows(
    queryRunner,
    `SELECT ${source.alias}.id, ${source.alias}.project_id,
            ${source.startExpr} AS start_time,
            ${source.endExpr} AS end_time,
            ${source.locationExpr || 'NULL'} AS location,
            ? AS source_table
     FROM ${source.tableName} ${source.alias}
     WHERE ${source.alias}.project_id = ?
       ${statusFilter.sql}
       AND ${source.startExpr} < ?
       AND ${source.endExpr} > ?`,
    [source.tableName, projectId, ...statusFilter.params, endAt, startAt]
  );

  return rows;
}

async function getRoomSchedulesForSource(source, location, startAt, endAt, statuses, queryRunner = db) {
  if (!source.locationExpr || !location || location.toLowerCase() === 'online') {
    return [];
  }

  const statusFilter = buildStatusFilterClause(source, statuses);
  const rows = await queryRows(
    queryRunner,
    `SELECT ${source.alias}.id, ${source.alias}.project_id,
            ${source.startExpr} AS start_time,
            ${source.endExpr} AS end_time,
            ${source.locationExpr} AS location,
            ? AS source_table
     FROM ${source.tableName} ${source.alias}
     WHERE ${source.locationExpr} = ?
       ${statusFilter.sql}
       AND ${source.startExpr} < ?
       AND ${source.endExpr} > ?`,
    [source.tableName, location, ...statusFilter.params, endAt, startAt]
  );

  return rows;
}

async function getParticipantSchedulesForSource(source, userIds, startAt, endAt, statuses, queryRunner = db) {
  if (!userIds.length) {
    return [];
  }

  const placeholders = buildInClausePlaceholders(userIds);
  const statusFilter = buildStatusFilterClause(source, statuses);
  const rows = await queryRows(
    queryRunner,
    `SELECT DISTINCT ${source.alias}.id, ${source.alias}.project_id,
            ${source.startExpr} AS start_time,
            ${source.endExpr} AS end_time,
            ${source.locationExpr || 'NULL'} AS location,
            pm.user_id AS participant_id,
            ? AS source_table
     FROM ${source.tableName} ${source.alias}
     JOIN project_members pm
       ON pm.project_id = ${source.alias}.project_id
      AND pm.status = 'accepted'
     WHERE pm.user_id IN (${placeholders})
       ${statusFilter.sql}
       AND ${source.startExpr} < ?
       AND ${source.endExpr} > ?`,
    [source.tableName, ...userIds, ...statusFilter.params, endAt, startAt]
  );

  return rows;
}

function buildOverlapConflicts(intervals, candidateStart, candidateEnd) {
  const conflictingIntervals = intervals.filter((interval) => {
    const startDate = toDate(interval.start_time);
    const endDate = toDate(interval.end_time || interval.start_time);
    if (!startDate || !endDate) return false;
    return startDate < candidateEnd && endDate > candidateStart;
  });

  return {
    hasConflict: conflictingIntervals.length > 0,
    conflictingIntervals,
  };
}

function normalizeScheduleSources(scheduleSources) {
  const list = Array.isArray(scheduleSources)
    ? scheduleSources
    : [scheduleSources];

  const normalized = list
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .filter((item) => Boolean(SCHEDULE_SOURCE_CONFIG[item]));

  return normalized.length ? normalized : [ADVISER_BOOKING_TABLE, 'defenses'];
}

function resolveBookingScheduleSources(payload = {}) {
  const explicitSources = payload.schedule_sources || payload.schedule_source;
  if (explicitSources) {
    return normalizeScheduleSources(explicitSources);
  }

  // Adviser flow checks both meetings and defenses to avoid cross-table overlaps.
  if (payload.booking_side === 'adviser' || payload.use_legacy_meetings) {
    return ['meetings', 'defenses'];
  }

  return ['defenses'];
}

async function validateScheduleConstraints({
  projectId,
  startAt,
  endAt,
  location,
  fallbackTeacherId,
  statuses,
  scheduleSources,
  queryRunner = db,
}) {
  const allConflicts = [];
  const candidateStart = toDate(startAt);
  const candidateEnd = toDate(endAt);
  if (!candidateStart || !candidateEnd) {
    return { ok: false, conflicts: [] };
  }

  const requestedSources = normalizeScheduleSources(scheduleSources);
  const resolvedSources = [];

  for (const sourceName of requestedSources) {
    const resolved = await resolveScheduleSource(sourceName, queryRunner);
    if (resolved) {
      resolvedSources.push(resolved);
    }
  }

  if (!resolvedSources.length) {
    return { ok: true, conflicts: [] };
  }

  const memberGroups = await getProjectMemberGroups(projectId, fallbackTeacherId, queryRunner);

  for (const source of resolvedSources) {
    const [projectSchedules, roomSchedules, teacherSchedules, studentSchedules] = await Promise.all([
      getProjectSchedulesForSource(source, projectId, startAt, endAt, statuses, queryRunner),
      getRoomSchedulesForSource(source, location, startAt, endAt, statuses, queryRunner),
      getParticipantSchedulesForSource(source, memberGroups.teacherIds, startAt, endAt, statuses, queryRunner),
      getParticipantSchedulesForSource(source, memberGroups.studentIds, startAt, endAt, statuses, queryRunner),
    ]);

    const checks = [
      { label: 'project', result: buildOverlapConflicts(projectSchedules, candidateStart, candidateEnd) },
      { label: 'room', result: buildOverlapConflicts(roomSchedules, candidateStart, candidateEnd) },
      { label: 'teacher', result: buildOverlapConflicts(teacherSchedules, candidateStart, candidateEnd) },
      { label: 'student', result: buildOverlapConflicts(studentSchedules, candidateStart, candidateEnd) },
    ];

    for (const { label, result } of checks) {
      if (result.hasConflict) {
        for (const interval of result.conflictingIntervals) {
          allConflicts.push({
            domain: label,
            source_table: interval.source_table || source.tableName,
            defense_id: interval.id,
            project_id: interval.project_id,
            start_time: interval.start_time,
            end_time: interval.end_time,
            start_date: toDate(interval.start_time),
            end_date: toDate(interval.end_time || interval.start_time),
          });
        }
      }
    }
  }

  if (!allConflicts.length) {
    return { ok: true, conflicts: [] };
  }

  return { ok: false, conflicts: allConflicts };
}

async function createDefense(userId, payload) {
  let conn;
  try {
    const { project_id, defense_type, location, modality, wait_for_slot } = payload;
    const scheduleWindow = getScheduleWindow(payload);

    if (!project_id) return { error: 'project_id is required' };
    if (!defense_type || !['proposal', 'midterm', 'final'].includes(defense_type)) {
      return { error: 'defense_type must be one of: proposal, midterm, final' };
    }
    if (scheduleWindow.error) return { error: scheduleWindow.error };
    if (!location) return { error: 'location is required' };

    const normalizedSchedule = scheduleWindow.start;
    const normalizedEnd = scheduleWindow.end;
    const scheduleSources = resolveBookingScheduleSources(payload);

    conn = await db.pool.getConnection();
    await conn.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await conn.beginTransaction();

    const [projectRows] = await conn.execute(
      'SELECT id, institution_id, title FROM projects WHERE id = ? LIMIT 1',
      [project_id]
    );

    const project = projectRows[0];
    if (!project) {
      await conn.rollback();
      return { error: 'Project not found', status: 404 };
    }

    const scheduleCheck = await validateScheduleConstraints({
      projectId: project_id,
      startAt: normalizedSchedule.dbValue,
      endAt: normalizedEnd.dbValue,
      location,
      fallbackTeacherId: userId,
      statuses: ['scheduled', 'approved', 'moved', 'pending'],
      scheduleSources,
      queryRunner: conn,
    });

    let status = 'scheduled';
    if (!scheduleCheck.ok) {
      const conflictPayload = buildConflictPayload(
        scheduleCheck.conflicts,
        normalizedSchedule,
        normalizedEnd,
        'Schedule overlap detected. Please choose a different schedule window.'
      );

      if (!wait_for_slot) {
        await conn.rollback();
        return {
          ...conflictPayload,
          status: 409,
        };
      }

      status = 'pending';
    }

    const [idRows] = await conn.execute('SELECT UUID() AS id');
    const defenseId = idRows[0].id;

    await conn.execute(
      `INSERT INTO ${ADVISER_BOOKING_TABLE} (id, project_id, defense_type, scheduled_at, end_time, location, modality, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [defenseId, project_id, defense_type, normalizedSchedule.dbValue, normalizedEnd.dbValue, location, modality || 'Online', status, userId]
    );

    const [rows] = await conn.execute(
      `SELECT * FROM ${ADVISER_BOOKING_TABLE} WHERE id = ? LIMIT 1`,
      [defenseId]
    );

    const scheduledLabel = formatScheduleLabel(normalizedSchedule.dateValue);
    const eventTitle = status === 'pending'
      ? 'Defense request queued'
      : 'Defense booking created';
    const eventMessage = status === 'pending'
      ? `A ${defense_type} defense request for "${project.title}" was queued for ${scheduledLabel}${location ? ` at ${location}` : ''}.`
      : `A ${defense_type} defense for "${project.title}" was booked on ${scheduledLabel}${location ? ` at ${location}` : ''}.`;

    await notifyProjectMembers({
      projectId: project_id,
      title: eventTitle,
      message: eventMessage,
      metadata: {
        defenseId,
        projectId: project_id,
        defenseType: defense_type,
        schedule: normalizedSchedule.dbValue,
        endTime: normalizedEnd.dbValue,
        location,
        status,
      },
      excludeUserId: userId,
      conn,
    });

    await notifyInstitutionCoordinators({
      institutionId: project.institution_id,
      title: status === 'pending' ? 'Defense request awaiting review' : 'Defense booking submitted',
      message: status === 'pending'
        ? `A ${defense_type} defense request for "${project.title}" is queued and awaiting available slot.`
        : `A ${defense_type} defense for "${project.title}" was submitted for ${scheduledLabel}${location ? ` at ${location}` : ''}.`,
      metadata: {
        defenseId,
        projectId: project_id,
        institutionId: project.institution_id,
        defenseType: defense_type,
        schedule: normalizedSchedule.dbValue,
        endTime: normalizedEnd.dbValue,
        location,
        status,
      },
      excludeUserId: userId,
      conn,
    });

    await conn.commit();

    return {
      data: rows[0],
      queued: status === 'pending',
      message: status === 'pending'
        ? 'Meeting added to waiting queue. It will be auto-scheduled when conflicts clear.'
        : undefined,
    };
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (rollbackErr) {
        console.error('createDefense rollback error:', rollbackErr);
      }
    }
    console.error('createDefense error:', err);
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

async function getDefensesByUser(userId) {
  const { rows } = await db.query(
    `SELECT d.*, p.title AS project_title, p.project_code,
            CASE
              WHEN d.status = 'scheduled' THEN 'Scheduled'
              WHEN d.status = 'pending' THEN 'Pending'
              WHEN d.status = 'cancelled' THEN 'Cancelled'
              WHEN d.status = 'rescheduled' THEN 'Rescheduled'
              WHEN d.status = 'completed' THEN 'Completed'
              ELSE d.status
            END AS status_label
               FROM ${ADVISER_BOOKING_TABLE} d
     LEFT JOIN projects p ON d.project_id = p.id
     WHERE d.created_by = ?
     ORDER BY d.scheduled_at DESC`,
    [userId]
  );
  return rows;
}

async function getDefensesForMember(userId) {
  const { rows } = await db.query(
    `SELECT d.*, p.title AS project_title, p.project_code,
            u.full_name AS created_by_name
     FROM ${ADVISER_BOOKING_TABLE} d
     JOIN projects p ON d.project_id = p.id
     JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     LEFT JOIN users u ON d.created_by = u.id
     ORDER BY d.scheduled_at DESC`,
    [userId]
  );
  return rows;
}

async function cancelDefense(userId, defenseId) {
  if (!defenseId) {
    return { error: 'defenseId is required', status: 400 };
  }

  const { rows } = await db.query(
    `SELECT d.*, p.title AS project_title, p.institution_id
     FROM ${ADVISER_BOOKING_TABLE} d
     LEFT JOIN projects p ON p.id = d.project_id
     WHERE d.id = ?
     LIMIT 1`,
    [defenseId]
  );

  if (!rows.length) {
    return { error: 'Meeting not found', status: 404 };
  }

  const defense = rows[0];
  if (defense.created_by !== userId) {
    return { error: 'You are not allowed to cancel this meeting', status: 403 };
  }

  if (defense.status === 'cancelled') {
    return { error: 'Meeting is already cancelled', status: 409 };
  }

  await db.query(
    `UPDATE ${ADVISER_BOOKING_TABLE} SET status = 'cancelled' WHERE id = ?`,
    [defenseId]
  );

  const { projectTitle } = await getAcceptedProjectMembersWithTitle(defense.project_id);
  const scheduledDate = toDate(defense.scheduled_at);
  const scheduleLabel = scheduledDate ? formatScheduleLabel(scheduledDate) : 'the selected schedule';

  await notifyProjectMembers({
    projectId: defense.project_id,
    title: 'Defense booking cancelled',
    message: `A ${defense.defense_type} defense for "${projectTitle}" scheduled on ${scheduleLabel} was cancelled.`,
    metadata: {
      defenseId: defense.id,
      projectId: defense.project_id,
      defenseType: defense.defense_type,
      status: 'cancelled',
      schedule: defense.scheduled_at,
      endTime: defense.end_time || null,
      location: defense.location || null,
    },
    excludeUserId: userId,
  });

  await notifyInstitutionCoordinators({
    institutionId: defense.institution_id,
    title: 'Defense booking cancelled by adviser',
    message: `A ${defense.defense_type} defense for "${defense.project_title || projectTitle}" scheduled on ${scheduleLabel} was cancelled.`,
    metadata: {
      defenseId: defense.id,
      projectId: defense.project_id,
      institutionId: defense.institution_id,
      defenseType: defense.defense_type,
      status: 'cancelled',
      schedule: defense.scheduled_at,
      endTime: defense.end_time || null,
      location: defense.location || null,
    },
    excludeUserId: userId,
  });

  await processAllPendingDefenses();

  const { rows: updatedRows } = await db.query(
    `SELECT d.*, p.title AS project_title, p.project_code,
            CASE
              WHEN d.status = 'scheduled' THEN 'Scheduled'
              WHEN d.status = 'pending' THEN 'Pending'
              WHEN d.status = 'cancelled' THEN 'Cancelled'
              WHEN d.status = 'rescheduled' THEN 'Rescheduled'
              WHEN d.status = 'completed' THEN 'Completed'
              ELSE d.status
            END AS status_label
     FROM ${ADVISER_BOOKING_TABLE} d
     LEFT JOIN projects p ON d.project_id = p.id
     WHERE d.id = ?
     LIMIT 1`,
    [defenseId]
  );

  return { data: updatedRows[0] || null };
}

async function rescheduleDefense(userId, defenseId, payload) {
  if (!defenseId) {
    return { error: 'defenseId is required', status: 400 };
  }

  const { rows } = await db.query(
    `SELECT d.*, p.title AS project_title, p.institution_id
     FROM ${ADVISER_BOOKING_TABLE} d
     LEFT JOIN projects p ON p.id = d.project_id
     WHERE d.id = ?
     LIMIT 1`,
    [defenseId]
  );

  if (!rows.length) {
    return { error: 'Meeting not found', status: 404 };
  }

  const defense = rows[0];
  if (defense.created_by !== userId) {
    return { error: 'You are not allowed to reschedule this meeting', status: 403 };
  }

  if (defense.status === 'cancelled') {
    return { error: 'Cannot reschedule a cancelled meeting', status: 409 };
  }

  const scheduleWindow = getScheduleWindow(payload);
  if (scheduleWindow.error) return { error: scheduleWindow.error };

  const normalizedSchedule = scheduleWindow.start;
  const normalizedEnd = scheduleWindow.end;

  let conn;
  try {
    conn = await db.pool.getConnection();
    await conn.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE ${ADVISER_BOOKING_TABLE} SET status = 'cancelled' WHERE id = ?`,
      [defenseId]
    );

    const scheduleCheck = await validateScheduleConstraints({
      projectId: defense.project_id,
      startAt: normalizedSchedule.dbValue,
      endAt: normalizedEnd.dbValue,
      location: defense.location,
      fallbackTeacherId: userId,
      statuses: ['scheduled', 'approved', 'moved'],
      scheduleSources: [ADVISER_BOOKING_TABLE, 'defenses'],
      queryRunner: conn,
    });

    if (!scheduleCheck.ok) {
      await conn.rollback();
      return {
        ...buildConflictPayload(
          scheduleCheck.conflicts,
          normalizedSchedule,
          normalizedEnd,
          'Rescheduled datetime overlaps an existing approved or booked schedule.'
        ),
        status: 409,
      };
    }

    await conn.execute(
      `UPDATE ${ADVISER_BOOKING_TABLE}
       SET scheduled_at = ?, end_time = ?, status = 'rescheduled'
       WHERE id = ?`,
      [normalizedSchedule.dbValue, normalizedEnd.dbValue, defenseId]
    );

    const [updatedRows] = await conn.execute(
      `SELECT * FROM ${ADVISER_BOOKING_TABLE} WHERE id = ? LIMIT 1`,
      [defenseId]
    );

    await notifyProjectMembers({
      projectId: defense.project_id,
      title: 'Defense booking rescheduled',
      message: `A ${defense.defense_type} defense for "${defense.project_title || 'your project'}" was moved to ${formatScheduleLabel(normalizedSchedule.dateValue)}${defense.location ? ` at ${defense.location}` : ''}.`,
      metadata: {
        defenseId,
        projectId: defense.project_id,
        defenseType: defense.defense_type,
        previousSchedule: defense.scheduled_at,
        previousEndTime: defense.end_time || null,
        schedule: normalizedSchedule.dbValue,
        endTime: normalizedEnd.dbValue,
        location: defense.location || null,
        status: 'rescheduled',
      },
      excludeUserId: userId,
      conn,
    });

    await notifyInstitutionCoordinators({
      institutionId: defense.institution_id,
      title: 'Defense booking rescheduled by adviser',
      message: `A ${defense.defense_type} defense for "${defense.project_title || 'a project'}" was moved to ${formatScheduleLabel(normalizedSchedule.dateValue)}${defense.location ? ` at ${defense.location}` : ''}.`,
      metadata: {
        defenseId,
        projectId: defense.project_id,
        institutionId: defense.institution_id,
        defenseType: defense.defense_type,
        previousSchedule: defense.scheduled_at,
        previousEndTime: defense.end_time || null,
        schedule: normalizedSchedule.dbValue,
        endTime: normalizedEnd.dbValue,
        location: defense.location || null,
        status: 'rescheduled',
      },
      excludeUserId: userId,
      conn,
    });

    await conn.commit();

    await processAllPendingDefenses();

    return { data: updatedRows[0] };
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (e) {
        console.error('reschedule rollback error:', e);
      }
    }
    console.error('rescheduleDefense error:', err);
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

async function processAllPendingDefenses() {
  let conn;
  try {
    conn = await db.pool.getConnection();
    await conn.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await conn.beginTransaction();

    const [pendingRows] = await conn.execute(
      `SELECT m.*, p.institution_id, p.title AS project_title
       FROM ${ADVISER_BOOKING_TABLE} m
       LEFT JOIN projects p ON p.id = m.project_id
       WHERE status = 'pending'
       ORDER BY m.created_at ASC`
    );

    for (const pending of pendingRows) {
      const normalizedSchedule = normalizeDateTimeInput(pending.scheduled_at);
      const normalizedEnd = normalizeDateTimeInput(pending.end_time || pending.scheduled_at);
      if (!normalizedSchedule || !normalizedEnd) continue;

      const scheduleCheck = await validateScheduleConstraints({
        projectId: pending.project_id,
        startAt: normalizedSchedule.dbValue,
        endAt: normalizedEnd.dbValue,
        location: pending.location,
        fallbackTeacherId: pending.created_by,
        statuses: ['scheduled', 'approved', 'moved'],
        scheduleSources: [ADVISER_BOOKING_TABLE, 'defenses'],
        queryRunner: conn,
      });

      if (scheduleCheck.ok) {
        await conn.execute(
          `UPDATE ${ADVISER_BOOKING_TABLE}
           SET status = 'scheduled'
           WHERE id = ?`,
          [pending.id]
        );

        const { projectTitle } = await getAcceptedProjectMembersWithTitle(pending.project_id, conn);
        await notifyProjectMembers({
          projectId: pending.project_id,
          title: 'Queued defense is now scheduled',
          message: `The queued ${pending.defense_type} defense for "${projectTitle}" is now scheduled for ${formatScheduleLabel(normalizedSchedule.dateValue)}${pending.location ? ` at ${pending.location}` : ''}.`,
          metadata: {
            defenseId: pending.id,
            projectId: pending.project_id,
            defenseType: pending.defense_type,
            schedule: normalizedSchedule.dbValue,
            endTime: normalizedEnd.dbValue,
            location: pending.location || null,
            status: 'scheduled',
          },
          conn,
        });

        await notifyInstitutionCoordinators({
          institutionId: pending.institution_id,
          title: 'Queued defense auto-scheduled',
          message: `The queued ${pending.defense_type} defense for "${pending.project_title || projectTitle}" is now scheduled for ${formatScheduleLabel(normalizedSchedule.dateValue)}${pending.location ? ` at ${pending.location}` : ''}.`,
          metadata: {
            defenseId: pending.id,
            projectId: pending.project_id,
            institutionId: pending.institution_id,
            defenseType: pending.defense_type,
            schedule: normalizedSchedule.dbValue,
            endTime: normalizedEnd.dbValue,
            location: pending.location || null,
            status: 'scheduled',
            source: 'pending_queue',
          },
          conn,
        });
      }
    }

    await conn.commit();
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (rollbackErr) {
        console.error('processAllPendingDefenses rollback error:', rollbackErr);
      }
    }
    console.error('processAllPendingDefenses error:', err);
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { createDefense, getDefensesByUser, getDefensesForMember, cancelDefense, rescheduleDefense };
