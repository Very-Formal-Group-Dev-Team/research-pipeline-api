const db = require('../../../config/db');
const { createNotification } = require('../notifications/notifications.service');
const { logAuditEntry } = require('../audit/audit.service');
const {
  JITSI_MEETING_PREFIX,
  createJitsiMeetingFields,
  appendMeetingLinkToMessage,
  normalizeMeetingUrl,
} = require('../../lib/jitsi');

const ADVISER_BOOKING_TABLE = 'meetings';

function formatScheduleLabel(dateValue) {
  const datePart = dateValue.toLocaleDateString();
  const timePart = dateValue.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${datePart} at ${timePart}`;
}

function formatAdviserMeetingNotificationMessage({
  meetingTitle,
  projectTitle,
  scheduledLabel,
  location,
  action,
}) {
  const sessionLabel = meetingTitle ? `"${meetingTitle}"` : 'A meeting';
  const projectLabel = projectTitle ? ` for "${projectTitle}"` : '';
  const locationSuffix = location ? ` at ${location}` : '';

  if (action === 'queued') {
    return `${sessionLabel}${projectLabel} was queued for ${scheduledLabel}${locationSuffix}.`;
  }
  if (action === 'rescheduled') {
    return `${sessionLabel}${projectLabel} was moved to ${scheduledLabel}${locationSuffix}.`;
  }
  if (action === 'cancelled') {
    return `${sessionLabel}${projectLabel} scheduled on ${scheduledLabel}${locationSuffix} was cancelled.`;
  }

  return `${sessionLabel}${projectLabel} was scheduled on ${scheduledLabel}${locationSuffix}.`;
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

function normalizeMeetingTitle(payload) {
  const raw = payload?.meeting_title ?? payload?.meetingTitle ?? '';
  return typeof raw === 'string' ? raw.trim() : '';
}

async function createDefense(userId, payload) {
  let conn;
  try {
    const { project_id, defense_type, location, modality, wait_for_slot } = payload;
    const meeting_title = normalizeMeetingTitle(payload);
    const scheduleWindow = getScheduleWindow(payload);

    if (!project_id) return { error: 'project_id is required' };
    if (!defense_type || !['proposal', 'midterm', 'final'].includes(defense_type)) {
      return { error: 'defense_type must be one of: proposal, midterm, final' };
    }
    if (!meeting_title) return { error: 'meeting_title is required' };
    if (meeting_title.length > 255) {
      return { error: 'meeting_title must be 255 characters or less' };
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

    if (payload.booking_side === 'adviser') {
      const [adviserRows] = await conn.execute(
        `SELECT 1
         FROM project_members
         WHERE project_id = ?
           AND user_id = ?
           AND role = 'adviser'
           AND status = 'accepted'
         LIMIT 1`,
        [project_id, userId],
      );

      if (!adviserRows.length) {
        await conn.rollback();
        return { error: 'Only the project adviser can book this meeting', status: 403 };
      }
    }

    const scheduleCheck = await validateScheduleConstraints({
      projectId: project_id,
      startAt: normalizedSchedule.dbValue,
      endAt: normalizedEnd.dbValue,
      location,
      fallbackTeacherId: userId,
      statuses: null, // Check all statuses for conflicts
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
    const resolvedModality = modality || 'Online';
    const jitsi = createJitsiMeetingFields({
      prefix: JITSI_MEETING_PREFIX,
      recordId: defenseId,
      modality: resolvedModality,
    });

    await conn.execute(
      `INSERT INTO ${ADVISER_BOOKING_TABLE} (
         id, project_id, adviser_id, defense_type, meeting_title, scheduled_at, end_time, location, modality, status, created_by,
         meeting_room, meeting_url, meeting_provider
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        defenseId,
        project_id,
        userId,
        defense_type,
        meeting_title,
        normalizedSchedule.dbValue,
        normalizedEnd.dbValue,
        location,
        resolvedModality,
        status,
        userId,
        jitsi.meeting_room,
        jitsi.meeting_url,
        jitsi.meeting_provider,
      ]
    );

    const [rows] = await conn.execute(
      `SELECT * FROM ${ADVISER_BOOKING_TABLE} WHERE id = ? LIMIT 1`,
      [defenseId]
    );

    const scheduledLabel = formatScheduleLabel(normalizedSchedule.dateValue);
    const eventTitle = status === 'pending' ? 'Meeting queued' : 'Meeting scheduled';
    const eventMessage = appendMeetingLinkToMessage(
      formatAdviserMeetingNotificationMessage({
        meetingTitle: meeting_title,
        projectTitle: project.title,
        scheduledLabel,
        location,
        action: status === 'pending' ? 'queued' : 'scheduled',
      }),
      jitsi.meeting_url
    );

    await notifyProjectMembers({
      projectId: project_id,
      title: eventTitle,
      message: eventMessage,
      metadata: {
        defenseId,
        projectId: project_id,
        defenseType: defense_type,
        meetingTitle: meeting_title,
        schedule: normalizedSchedule.dbValue,
        endTime: normalizedEnd.dbValue,
        location,
        status,
        meetingUrl: jitsi.meeting_url,
        meetingRoom: jitsi.meeting_room,
      },
      excludeUserId: userId,
      conn,
    });

    await notifyInstitutionCoordinators({
      institutionId: project.institution_id,
      title: status === 'pending' ? 'Meeting awaiting slot' : 'Meeting scheduled by adviser',
      message: appendMeetingLinkToMessage(
        status === 'pending'
          ? formatAdviserMeetingNotificationMessage({
            meetingTitle: meeting_title,
            projectTitle: project.title,
            scheduledLabel,
            location,
            action: 'queued',
          })
          : formatAdviserMeetingNotificationMessage({
            meetingTitle: meeting_title,
            projectTitle: project.title,
            scheduledLabel,
            location,
            action: 'scheduled',
          }),
        jitsi.meeting_url
      ),
      metadata: {
        defenseId,
        projectId: project_id,
        institutionId: project.institution_id,
        defenseType: defense_type,
        meetingTitle: meeting_title,
        schedule: normalizedSchedule.dbValue,
        endTime: normalizedEnd.dbValue,
        location,
        status,
        meetingUrl: jitsi.meeting_url,
        meetingRoom: jitsi.meeting_room,
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

function mapScheduleRow(row) {
  const startTime = row.start_time || row.scheduled_at || null;
  return {
    ...row,
    start_time: startTime,
    end_time: row.end_time || startTime,
    venue: row.venue || row.location || null,
    meeting_url: normalizeMeetingUrl(row.meeting_url),
  };
}

async function getMeetingsForProject(projectId) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return [];

  const statusLabel = (alias) => `CASE
      WHEN ${alias}.status = 'scheduled' THEN 'Scheduled'
      WHEN ${alias}.status = 'pending' THEN 'Pending'
      WHEN ${alias}.status = 'cancelled' THEN 'Cancelled'
      WHEN ${alias}.status = 'rescheduled' THEN 'Rescheduled'
      WHEN ${alias}.status = 'completed' THEN 'Completed'
      ELSE ${alias}.status
    END AS status_label`;

  const meetingSelect = `
    SELECT m.id,
           m.project_id,
           p.title AS project_title,
           p.project_code,
           m.defense_type,
           m.meeting_title,
           m.scheduled_at AS start_time,
           COALESCE(m.end_time, m.scheduled_at) AS end_time,
           m.location,
           m.location AS venue,
           m.modality,
           m.status,
           m.created_by,
           m.meeting_room,
           m.meeting_url,
           m.meeting_provider,
           'meeting' AS schedule_source,
           ${statusLabel('m')},
           u.full_name AS created_by_name,
           m.created_at
    FROM ${ADVISER_BOOKING_TABLE} m
    INNER JOIN projects p ON m.project_id = p.id
    LEFT JOIN users u ON m.created_by = u.id
    WHERE m.project_id = ?`;

  const legacyDefenseSelect = `
    SELECT d.id,
           d.project_id,
           p.title AS project_title,
           p.project_code,
           d.defense_type,
           NULL AS meeting_title,
           d.scheduled_at AS start_time,
           COALESCE(d.end_time, d.scheduled_at) AS end_time,
           d.location,
           d.location AS venue,
           d.modality,
           d.status,
           d.created_by,
           d.meeting_room,
           d.meeting_url,
           d.meeting_provider,
           'meeting' AS schedule_source,
           ${statusLabel('d')},
           u.full_name AS created_by_name,
           d.created_at
    FROM defenses d
    INNER JOIN projects p ON d.project_id = p.id
    LEFT JOIN users u ON d.created_by = u.id
    WHERE d.project_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM ${ADVISER_BOOKING_TABLE} m2 WHERE m2.id = d.id
      )`;

  try {
    const { rows } = await db.query(
      `${meetingSelect}
       UNION ALL
       ${legacyDefenseSelect}
       ORDER BY start_time ASC, created_at ASC`,
      [normalizedProjectId, normalizedProjectId]
    );
    return rows.map(mapScheduleRow);
  } catch (err) {
    console.warn('getMeetingsForProject union query failed, falling back to meetings only:', err.message);
    const { rows } = await db.query(
      `${meetingSelect} ORDER BY start_time ASC, created_at ASC`,
      [normalizedProjectId]
    );
    return rows.map(mapScheduleRow);
  }
}

async function userHasProjectMeetingAccess(userId, projectId) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId || !userId) return false;

  const { rows: memberRows } = await db.query(
    'SELECT id FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1',
    [normalizedProjectId, userId]
  );
  if (memberRows.length) return true;

  const { rows: adviserRows } = await db.query(
    `SELECT id FROM project_members
     WHERE project_id = ? AND user_id = ? AND role = 'adviser' AND status = 'accepted'
     LIMIT 1`,
    [normalizedProjectId, userId]
  );
  if (adviserRows.length) return true;

  const { rows: createdRows } = await db.query(
    `SELECT id FROM ${ADVISER_BOOKING_TABLE}
     WHERE project_id = ? AND created_by = ?
     LIMIT 1`,
    [normalizedProjectId, userId]
  );
  if (createdRows.length) return true;

  const coordinatorService = require('../coordinator/coordinator.service');
  return coordinatorService.coordinatorCanViewProject(userId, normalizedProjectId);
}

async function getProjectDefenseSchedules(userId) {
  const { rows } = await db.query(
    `SELECT d.id,
            d.project_id,
            p.title AS project_title,
            p.project_code,
            d.defense_type,
            d.scheduled_at AS start_time,
            COALESCE(d.end_time, d.scheduled_at) AS end_time,
            d.location,
            d.venue,
            d.modality,
            d.status,
            d.created_by,
            d.meeting_room,
            d.meeting_url,
            d.meeting_provider,
            'defense' AS schedule_source,
            CASE
              WHEN d.status = 'scheduled' THEN 'Scheduled'
              WHEN d.status = 'pending' THEN 'Pending'
              WHEN d.status = 'approved' THEN 'Approved'
              WHEN d.status = 'cancelled' THEN 'Cancelled'
              WHEN d.status = 'rescheduled' THEN 'Rescheduled'
              WHEN d.status = 'completed' THEN 'Completed'
              ELSE d.status
            END AS status_label,
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
            d.created_at
     FROM defenses d
     INNER JOIN projects p ON d.project_id = p.id
     INNER JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ? AND pm.status = 'accepted'
     LEFT JOIN users u ON d.created_by = u.id
     WHERE d.status NOT IN ('cancelled', 'rejected')
     UNION ALL
     SELECT m.id,
            m.project_id,
            p.title AS project_title,
            p.project_code,
            m.defense_type,
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
            CASE
              WHEN m.status = 'scheduled' THEN 'Scheduled'
              WHEN m.status = 'pending' THEN 'Pending'
              WHEN m.status = 'cancelled' THEN 'Cancelled'
              WHEN m.status = 'rescheduled' THEN 'Rescheduled'
              WHEN m.status = 'completed' THEN 'Completed'
              ELSE m.status
            END AS status_label,
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
     WHERE m.status NOT IN ('cancelled', 'rejected')
     UNION ALL
     SELECT d.id,
            d.project_id,
            p.title AS project_title,
            p.project_code,
            d.defense_type,
            d.scheduled_at AS start_time,
            COALESCE(d.end_time, d.scheduled_at) AS end_time,
            d.location,
            d.venue,
            d.modality,
            d.status,
            d.created_by,
            d.meeting_room,
            d.meeting_url,
            d.meeting_provider,
            'defense' AS schedule_source,
            CASE
              WHEN d.status = 'scheduled' THEN 'Scheduled'
              WHEN d.status = 'pending' THEN 'Pending'
              WHEN d.status = 'approved' THEN 'Approved'
              WHEN d.status = 'cancelled' THEN 'Cancelled'
              WHEN d.status = 'rescheduled' THEN 'Rescheduled'
              WHEN d.status = 'completed' THEN 'Completed'
              ELSE d.status
            END AS status_label,
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
            d.created_at
     FROM defenses d
     INNER JOIN projects p ON d.project_id = p.id
     INNER JOIN defense_panelists dp ON dp.defense_id = d.id AND dp.user_id = ?
     LEFT JOIN users u ON d.created_by = u.id
     WHERE d.status NOT IN ('cancelled', 'rejected')
       AND NOT EXISTS (
         SELECT 1
         FROM project_members pm
         WHERE pm.project_id = d.project_id
           AND pm.user_id = ?
           AND pm.status = 'accepted'
       )
     ORDER BY start_time DESC, created_at DESC`,
    [userId, userId, userId, userId]
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
    title: 'Meeting cancelled',
    message: formatAdviserMeetingNotificationMessage({
      meetingTitle: defense.meeting_title,
      projectTitle,
      scheduledLabel: scheduleLabel,
      location: defense.location,
      action: 'cancelled',
    }),
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
    title: 'Meeting cancelled by adviser',
    message: formatAdviserMeetingNotificationMessage({
      meetingTitle: defense.meeting_title,
      projectTitle: defense.project_title || projectTitle,
      scheduledLabel: scheduleLabel,
      location: defense.location,
      action: 'cancelled',
    }),
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

function meetingStatusLabel(status) {
  const labels = {
    scheduled: 'Scheduled',
    pending: 'Pending',
    cancelled: 'Cancelled',
    rescheduled: 'Rescheduled',
    completed: 'Completed',
  };
  return labels[status] || status;
}

async function assertAdviserMeetingOwner(userId, meetingId) {
  if (!meetingId) {
    return { error: 'meetingId is required', status: 400 };
  }

  const { rows } = await db.query(
    `SELECT m.*, p.title AS project_title, p.project_code, p.institution_id
     FROM ${ADVISER_BOOKING_TABLE} m
     LEFT JOIN projects p ON p.id = m.project_id
     WHERE m.id = ?
     LIMIT 1`,
    [meetingId]
  );

  if (!rows.length) {
    return { error: 'Meeting not found', status: 404 };
  }

  const meeting = rows[0];
  if (meeting.created_by !== userId) {
    return { error: 'You are not allowed to modify this meeting', status: 403 };
  }

  return { meeting };
}

async function getAdviserMeetingById(userId, meetingId) {
  const result = await assertAdviserMeetingOwner(userId, meetingId);
  if (result.error) return result;

  const meeting = result.meeting;
  return {
    data: mapScheduleRow({
      ...meeting,
      start_time: meeting.scheduled_at,
      end_time: meeting.end_time || meeting.scheduled_at,
      venue: meeting.location,
      status_label: meetingStatusLabel(meeting.status),
    }),
  };
}

async function completeMeeting(userId, meetingId) {
  const result = await assertAdviserMeetingOwner(userId, meetingId);
  if (result.error) return result;

  const meeting = result.meeting;
  if (meeting.status === 'cancelled') {
    return { error: 'Cannot complete a cancelled meeting', status: 409 };
  }
  if (meeting.status === 'completed') {
    return { error: 'Meeting is already marked complete', status: 409 };
  }

  await db.query(
    `UPDATE ${ADVISER_BOOKING_TABLE} SET status = 'completed' WHERE id = ?`,
    [meetingId]
  );

  const { rows: updatedRows } = await db.query(
    `SELECT m.*, p.title AS project_title, p.project_code
     FROM ${ADVISER_BOOKING_TABLE} m
     LEFT JOIN projects p ON p.id = m.project_id
     WHERE m.id = ?
     LIMIT 1`,
    [meetingId]
  );

  const updated = updatedRows[0];
  return {
    data: mapScheduleRow({
      ...updated,
      start_time: updated.scheduled_at,
      end_time: updated.end_time || updated.scheduled_at,
      venue: updated.location,
      status_label: meetingStatusLabel('completed'),
    }),
  };
}

async function restoreMeeting(userId, meetingId) {
  const result = await assertAdviserMeetingOwner(userId, meetingId);
  if (result.error) return result;

  const meeting = result.meeting;
  if (meeting.status !== 'completed' && meeting.status !== 'cancelled') {
    return { error: 'Only completed or cancelled meetings can be reverted', status: 409 };
  }

  await db.query(
    `UPDATE ${ADVISER_BOOKING_TABLE} SET status = 'scheduled' WHERE id = ?`,
    [meetingId]
  );

  const { rows: updatedRows } = await db.query(
    `SELECT m.*, p.title AS project_title, p.project_code
     FROM ${ADVISER_BOOKING_TABLE} m
     LEFT JOIN projects p ON p.id = m.project_id
     WHERE m.id = ?
     LIMIT 1`,
    [meetingId]
  );

  const updated = updatedRows[0];
  return {
    data: mapScheduleRow({
      ...updated,
      start_time: updated.scheduled_at,
      end_time: updated.end_time || updated.scheduled_at,
      venue: updated.location,
      status_label: meetingStatusLabel('scheduled'),
    }),
  };
}

async function updateMeeting(userId, meetingId, payload) {
  const result = await assertAdviserMeetingOwner(userId, meetingId);
  if (result.error) return result;

  const meeting = result.meeting;
  if (meeting.status === 'cancelled') {
    return { error: 'Cannot edit a cancelled meeting', status: 409 };
  }
  if (meeting.status === 'completed') {
    return { error: 'Cannot edit a completed meeting', status: 409 };
  }

  const meeting_title = payload.meeting_title !== undefined || payload.meetingTitle !== undefined
    ? normalizeMeetingTitle(payload)
    : (meeting.meeting_title || '').trim();
  if (!meeting_title) {
    return { error: 'meeting_title is required' };
  }
  if (meeting_title.length > 255) {
    return { error: 'meeting_title must be 255 characters or less' };
  }

  const defense_type = payload.defense_type || payload.defenseType || meeting.defense_type;
  if (!['proposal', 'midterm', 'final'].includes(defense_type)) {
    return { error: 'defense_type must be one of: proposal, midterm, final' };
  }

  const location = payload.location !== undefined ? payload.location : meeting.location;
  const modality = payload.modality !== undefined ? payload.modality : meeting.modality;
  if (!location) {
    return { error: 'location is required' };
  }

  const scheduleWindow = getScheduleWindow(payload);
  if (scheduleWindow.error) {
    return { error: scheduleWindow.error };
  }

  const normalizedSchedule = scheduleWindow.start;
  const normalizedEnd = scheduleWindow.end;
  const scheduleSources = resolveBookingScheduleSources({ booking_side: 'adviser' });

  const scheduleCheck = await validateScheduleConstraints({
    projectId: meeting.project_id,
    startAt: normalizedSchedule.dbValue,
    endAt: normalizedEnd.dbValue,
    location,
    fallbackTeacherId: userId,
    statuses: null,
    scheduleSources,
  });

  const conflicts = (scheduleCheck.conflicts || []).filter(
    (item) => String(item.defense_id) !== String(meetingId),
  );

  if (conflicts.length) {
    return {
      ...buildConflictPayload(
        conflicts,
        normalizedSchedule,
        normalizedEnd,
        'Schedule overlap detected. Please choose a different schedule window.',
      ),
      status: 409,
    };
  }

  await db.query(
    `UPDATE ${ADVISER_BOOKING_TABLE}
     SET meeting_title = ?,
         defense_type = ?,
         scheduled_at = ?,
         end_time = ?,
         location = ?,
         modality = ?
     WHERE id = ?`,
    [
      meeting_title,
      defense_type,
      normalizedSchedule.dbValue,
      normalizedEnd.dbValue,
      location,
      modality || 'Online',
      meetingId,
    ]
  );

  const { rows: updatedRows } = await db.query(
    `SELECT m.*, p.title AS project_title, p.project_code
     FROM ${ADVISER_BOOKING_TABLE} m
     LEFT JOIN projects p ON p.id = m.project_id
     WHERE m.id = ?
     LIMIT 1`,
    [meetingId]
  );

  const updated = updatedRows[0];
  return {
    data: mapScheduleRow({
      ...updated,
      start_time: updated.scheduled_at,
      end_time: updated.end_time || updated.scheduled_at,
      venue: updated.location,
      status_label: meetingStatusLabel(updated.status),
    }),
  };
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
      statuses: null, // Check all statuses for conflicts
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
      title: 'Meeting rescheduled',
      message: appendMeetingLinkToMessage(
        formatAdviserMeetingNotificationMessage({
          meetingTitle: defense.meeting_title,
          projectTitle: defense.project_title || 'your project',
          scheduledLabel: formatScheduleLabel(normalizedSchedule.dateValue),
          location: defense.location,
          action: 'rescheduled',
        }),
        defense.meeting_url
      ),
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
        meetingUrl: defense.meeting_url,
        meetingRoom: defense.meeting_room,
      },
      excludeUserId: userId,
      conn,
    });

    await notifyInstitutionCoordinators({
      institutionId: defense.institution_id,
      title: 'Meeting rescheduled by adviser',
      message: formatAdviserMeetingNotificationMessage({
        meetingTitle: defense.meeting_title,
        projectTitle: defense.project_title || 'a project',
        scheduledLabel: formatScheduleLabel(normalizedSchedule.dateValue),
        location: defense.location,
        action: 'rescheduled',
      }),
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
       WHERE m.status = 'pending'
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
        statuses: null, // Check all statuses to see if pending can be auto-scheduled
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
        const scheduledLabel = formatScheduleLabel(normalizedSchedule.dateValue);
        await notifyProjectMembers({
          projectId: pending.project_id,
          title: 'Meeting scheduled',
          message: formatAdviserMeetingNotificationMessage({
            meetingTitle: pending.meeting_title,
            projectTitle,
            scheduledLabel,
            location: pending.location,
            action: 'scheduled',
          }),
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
          title: 'Queued meeting auto-scheduled',
          message: formatAdviserMeetingNotificationMessage({
            meetingTitle: pending.meeting_title,
            projectTitle: pending.project_title || projectTitle,
            scheduledLabel,
            location: pending.location,
            action: 'scheduled',
          }),
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

async function assertDefenseMeetingAccess(userId, defenseId) {
  if (!defenseId) {
    return { error: 'defenseId is required', status: 400 };
  }

  const { rows } = await db.query(
    `SELECT d.*, p.title AS project_title, p.project_code, p.institution_id
     FROM defenses d
     INNER JOIN projects p ON p.id = d.project_id
     WHERE d.id = ?
     LIMIT 1`,
    [defenseId]
  );

  if (rows.length) {
    const defense = rows[0];
    const [{ rows: panelistRows }, { rows: memberRows }, { rows: coordRows }] = await Promise.all([
      db.query(
        `SELECT 1 AS ok FROM defense_panelists WHERE defense_id = ? AND user_id = ? LIMIT 1`,
        [defenseId, userId]
      ),
      db.query(
        `SELECT 1 AS ok FROM project_members
         WHERE project_id = ? AND user_id = ? AND status = 'accepted'
         LIMIT 1`,
        [defense.project_id, userId]
      ),
      db.query(
        `SELECT 1 AS ok FROM user_roles
         WHERE user_id = ? AND institution_id = ? AND role = 'coordinator'
         LIMIT 1`,
        [userId, defense.institution_id]
      ),
    ]);

    const isPanelist = panelistRows.length > 0;
    const isMember = memberRows.length > 0;
    const isCreator = defense.created_by === userId;
    const isCoordinator = coordRows.length > 0;

    if (!isPanelist && !isMember && !isCreator && !isCoordinator) {
      return { error: 'You are not allowed to join this defense', status: 403 };
    }

    return { defense, isPanelist, scheduleSource: 'defense' };
  }

  const { rows: meetingRows } = await db.query(
    `SELECT m.*, p.title AS project_title, p.project_code, p.institution_id
     FROM ${ADVISER_BOOKING_TABLE} m
     LEFT JOIN projects p ON p.id = m.project_id
     WHERE m.id = ?
     LIMIT 1`,
    [defenseId]
  );

  if (!meetingRows.length) {
    return { error: 'Defense not found', status: 404 };
  }

  const meeting = meetingRows[0];
  const [{ rows: memberRows }, { rows: creatorRows }] = await Promise.all([
    db.query(
      `SELECT 1 AS ok FROM project_members
       WHERE project_id = ? AND user_id = ? AND status = 'accepted'
       LIMIT 1`,
      [meeting.project_id, userId]
    ),
    db.query(
      `SELECT 1 AS ok FROM ${ADVISER_BOOKING_TABLE}
       WHERE id = ? AND (created_by = ? OR adviser_id = ?)
       LIMIT 1`,
      [defenseId, userId, userId]
    ),
  ]);

  if (!memberRows.length && !creatorRows.length) {
    return { error: 'You are not allowed to join this meeting', status: 403 };
  }

  return { defense: meeting, isPanelist: false, scheduleSource: 'meeting' };
}

async function getDefenseRubric(rubricId) {
  if (!rubricId) return null;

  const { rows } = await db.query(
    `SELECT id, name, description, defense_type, role, created_by, created_at
     FROM rubrics
     WHERE id = ?
     LIMIT 1`,
    [rubricId]
  );

  if (!rows.length) return null;

  const { rows: criteria } = await db.query(
    `SELECT id, rubric_id, criterion_name, weight, description, max_score, \`order\`
     FROM rubric_criteria
     WHERE rubric_id = ?
     ORDER BY \`order\` ASC, criterion_name ASC`,
    [rubricId]
  );

  return { ...rows[0], criteria };
}

function computeWeightedTotalScore(normalizedScores, criteria) {
  if (!normalizedScores.length || !criteria?.length) return null;

  const criteriaById = new Map(criteria.map((c) => [c.id, c]));
  let weightedSum = 0;
  let totalWeight = 0;

  for (const row of normalizedScores) {
    const criterion = criteriaById.get(row.criterionId);
    if (!criterion) continue;
    const weight = Number(criterion.weight) || 0;
    const maxScore = Number(criterion.max_score) || 5;
    if (weight <= 0 || maxScore <= 0) continue;
    weightedSum += (row.score / maxScore) * weight;
    totalWeight += weight;
  }

  if (!totalWeight) return null;
  return Math.round((weightedSum / totalWeight) * 10000) / 100;
}

async function getMeetingSiblingDefenses(defenseId) {
  const { rows } = await db.query(
    `SELECT d.id, d.project_id, d.rubric_id, d.defense_type, d.scheduled_at, d.end_time,
            d.location, d.venue, d.modality, d.status,
            p.title AS project_title, p.project_code, p.institution_id
     FROM defenses d
     INNER JOIN projects p ON p.id = d.project_id
     INNER JOIN defenses anchor ON anchor.id = ?
     INNER JOIN projects anchor_project ON anchor_project.id = anchor.project_id
     WHERE d.id = anchor.id
        OR (
          d.defense_type = anchor.defense_type
          AND COALESCE(d.modality, 'Online') = COALESCE(anchor.modality, 'Online')
          AND TRIM(COALESCE(d.venue, d.location, '')) = TRIM(COALESCE(anchor.venue, anchor.location, ''))
          AND d.scheduled_at = anchor.scheduled_at
          AND COALESCE(d.end_time, d.scheduled_at) = COALESCE(anchor.end_time, anchor.scheduled_at)
          AND p.institution_id = anchor_project.institution_id
          AND d.status NOT IN ('cancelled', 'rejected')
        )
     ORDER BY p.title ASC, p.project_code ASC`,
    [defenseId]
  );

  return rows;
}

async function loadPanelistEvaluationState(userId, defenseId, rubric) {
  const [{ rows: evalRows }, { rows: noteRows }] = await Promise.all([
    db.query(
      `SELECT criterion_id, score, comments
       FROM evaluations
       WHERE defense_id = ? AND panelist_id = ?`,
      [defenseId, userId]
    ),
    db.query(
      `SELECT notes FROM defense_panelist_notes
       WHERE defense_id = ? AND panelist_id = ?
       LIMIT 1`,
      [defenseId, userId]
    ),
  ]);

  const evaluations = evalRows.map((row) => ({
    criterion_id: row.criterion_id,
    score: Number(row.score),
    comments: row.comments || '',
  }));

  const notes = noteRows[0]?.notes || '';
  const normalizedScores = evaluations.map((row) => ({
    criterionId: row.criterion_id,
    score: row.score,
    comments: row.comments,
  }));
  const total_score = computeWeightedTotalScore(normalizedScores, rubric?.criteria || []);

  return { evaluations, notes, total_score };
}

async function recalculateDefenseOverallScore(conn, defenseId, projectId, rubric) {
  if (!rubric?.criteria?.length) return;

  const [evalRows] = await conn.execute(
    `SELECT panelist_id, criterion_id, score
     FROM evaluations
     WHERE defense_id = ?`,
    [defenseId]
  );

  if (!evalRows.length) {
    await conn.execute('DELETE FROM defense_results WHERE defense_id = ?', [defenseId]);
    return;
  }

  const criteriaById = new Map(rubric.criteria.map((c) => [c.id, c]));
  const byPanelist = new Map();

  for (const row of evalRows) {
    if (!byPanelist.has(row.panelist_id)) {
      byPanelist.set(row.panelist_id, []);
    }
    byPanelist.get(row.panelist_id).push({
      criterionId: row.criterion_id,
      score: Number(row.score),
    });
  }

  const panelTotals = [];
  for (const scores of byPanelist.values()) {
    const total = computeWeightedTotalScore(scores, rubric.criteria);
    if (total != null) panelTotals.push(total);
  }

  if (!panelTotals.length) return;

  const overallScore = Math.round(
    (panelTotals.reduce((sum, value) => sum + value, 0) / panelTotals.length) * 100
  ) / 100;

  const [existingRows] = await conn.execute(
    'SELECT id FROM defense_results WHERE defense_id = ? LIMIT 1',
    [defenseId]
  );

  if (existingRows.length) {
    await conn.execute(
      `UPDATE defense_results
       SET overall_score = ?, project_id = ?
       WHERE id = ?`,
      [overallScore, projectId, existingRows[0].id]
    );
    return;
  }

  const [idRows] = await conn.execute('SELECT UUID() AS id');
  await conn.execute(
    `INSERT INTO defense_results (id, defense_id, project_id, overall_score)
     VALUES (?, ?, ?, ?)`,
    [idRows[0].id, defenseId, projectId, overallScore]
  );
}

async function buildMeetingGradesPayload(defenseId) {
  const siblings = await getMeetingSiblingDefenses(defenseId);
  if (!siblings.length) {
    return { rubric: null, projects: [] };
  }

  const rubric = await getDefenseRubric(siblings[0].rubric_id);
  const siblingIds = siblings.map((row) => row.id);

  const [{ rows: evalRows }, { rows: noteRows }, { rows: resultRows }, { rows: panelistRows }] =
    await Promise.all([
      db.query(
        `SELECT e.defense_id, e.panelist_id, e.criterion_id, e.score, e.comments,
                u.full_name AS panelist_name
         FROM evaluations e
         INNER JOIN users u ON u.id = e.panelist_id
         WHERE e.defense_id IN (${siblingIds.map(() => '?').join(', ')})`,
        siblingIds
      ),
      db.query(
        `SELECT n.defense_id, n.panelist_id, n.notes, u.full_name AS panelist_name
         FROM defense_panelist_notes n
         INNER JOIN users u ON u.id = n.panelist_id
         WHERE n.defense_id IN (${siblingIds.map(() => '?').join(', ')})`,
        siblingIds
      ),
      db.query(
        `SELECT defense_id, overall_score, verdict, recommendations, finalized_at
         FROM defense_results
         WHERE defense_id IN (${siblingIds.map(() => '?').join(', ')})`,
        siblingIds
      ),
      db.query(
        `SELECT dp.defense_id, dp.user_id, u.full_name AS panelist_name
         FROM defense_panelists dp
         INNER JOIN users u ON u.id = dp.user_id
         WHERE dp.defense_id IN (${siblingIds.map(() => '?').join(', ')})`,
        siblingIds
      ),
    ]);

  const criteriaById = new Map((rubric?.criteria || []).map((c) => [c.id, c]));
  const resultsByDefense = new Map(resultRows.map((row) => [row.defense_id, row]));

  const projects = siblings.map((sibling) => {
    const defenseEvals = evalRows.filter((row) => row.defense_id === sibling.id);
    const defenseNotes = noteRows.filter((row) => row.defense_id === sibling.id);
    const defensePanelists = panelistRows.filter((row) => row.defense_id === sibling.id);
    const result = resultsByDefense.get(sibling.id);

    const panelistIds = new Set([
      ...defensePanelists.map((row) => row.user_id),
      ...defenseEvals.map((row) => row.panelist_id),
      ...defenseNotes.map((row) => row.panelist_id),
    ]);

    const panelists = Array.from(panelistIds).map((panelistId) => {
      const panelistName =
        defensePanelists.find((row) => row.user_id === panelistId)?.panelist_name
        || defenseEvals.find((row) => row.panelist_id === panelistId)?.panelist_name
        || defenseNotes.find((row) => row.panelist_id === panelistId)?.panelist_name
        || 'Panelist';

      const scores = defenseEvals
        .filter((row) => row.panelist_id === panelistId)
        .map((row) => ({
          criterion_id: row.criterion_id,
          criterion_name: criteriaById.get(row.criterion_id)?.criterion_name || 'Criterion',
          max_score: Number(criteriaById.get(row.criterion_id)?.max_score) || 5,
          score: Number(row.score),
          comments: row.comments || '',
        }));

      const normalizedScores = scores.map((row) => ({
        criterionId: row.criterion_id,
        score: row.score,
      }));

      return {
        panelist_id: panelistId,
        panelist_name: panelistName,
        scores,
        notes: defenseNotes.find((row) => row.panelist_id === panelistId)?.notes || '',
        total_score: computeWeightedTotalScore(normalizedScores, rubric?.criteria || []),
      };
    });

    const criterionSummaries = (rubric?.criteria || []).map((criterion) => {
      const matching = defenseEvals.filter((row) => row.criterion_id === criterion.id);
      if (!matching.length) {
        return {
          criterion_id: criterion.id,
          criterion_name: criterion.criterion_name,
          max_score: Number(criterion.max_score) || 5,
          average_score: null,
        };
      }

      const averageScore =
        matching.reduce((sum, row) => sum + Number(row.score), 0) / matching.length;

      return {
        criterion_id: criterion.id,
        criterion_name: criterion.criterion_name,
        max_score: Number(criterion.max_score) || 5,
        average_score: Math.round(averageScore * 100) / 100,
      };
    });

    return {
      defense_id: sibling.id,
      project_id: sibling.project_id,
      project_title: sibling.project_title,
      project_code: sibling.project_code,
      overall_score: result?.overall_score != null ? Number(result.overall_score) : null,
      verdict: result?.verdict || null,
      recommendations: result?.recommendations || null,
      criterion_summaries: criterionSummaries,
      panelists,
    };
  });

  return { rubric, projects };
}

async function getDefenseMeetingGrades(userId, defenseId) {
  const access = await assertDefenseMeetingAccess(userId, defenseId);
  if (access.error) return access;

  if (access.scheduleSource !== 'defense') {
    return { error: 'Grades are only available for defense meetings', status: 400 };
  }

  const payload = await buildMeetingGradesPayload(defenseId);
  return { data: payload };
}

async function getDefenseMeetingSession(userId, defenseId) {
  const access = await assertDefenseMeetingAccess(userId, defenseId);
  if (access.error) return access;

  const { defense, isPanelist, scheduleSource } = access;
  const rubric = scheduleSource === 'defense' ? await getDefenseRubric(defense.rubric_id) : null;

  let evaluations = [];
  let notes = '';
  let total_score = null;

  if (isPanelist && scheduleSource === 'defense') {
    const state = await loadPanelistEvaluationState(userId, defenseId, rubric);
    evaluations = state.evaluations;
    notes = state.notes;
    total_score = state.total_score;
  }

  const meeting_projects =
    scheduleSource === 'defense'
      ? (await getMeetingSiblingDefenses(defenseId)).map((row) => ({
        defense_id: row.id,
        project_id: row.project_id,
        project_title: row.project_title,
        project_code: row.project_code,
      }))
      : [];

  return {
    data: {
      defense: {
        id: defense.id,
        project_id: defense.project_id,
        project_title: defense.project_title,
        project_code: defense.project_code,
        defense_type: defense.defense_type,
        modality: defense.modality,
        status: defense.status,
        meeting_room: defense.meeting_room,
        meeting_url: defense.meeting_url,
        meeting_provider: defense.meeting_provider,
        start_time: defense.scheduled_at,
        end_time: defense.end_time || defense.scheduled_at,
        schedule_source: scheduleSource,
      },
      is_panelist: isPanelist,
      rubric,
      evaluations,
      notes,
      total_score,
      meeting_projects,
      jitsi_base_url: getJitsiBaseUrl(),
    },
  };
}

function normalizePanelEvaluationPayload(payload = {}) {
  const rawScores = payload.scores ?? payload.evaluations ?? [];
  const scores = Array.isArray(rawScores)
    ? rawScores.map((row) => ({
      criterionId: row.criterionId || row.criterion_id,
      score: row.score,
      comments: row.comments ?? row.comment ?? '',
    }))
    : [];

  const notes = typeof payload.notes === 'string' ? payload.notes : '';
  return { scores, notes };
}

async function saveDefensePanelEvaluations(userId, defenseId, payload) {
  const access = await assertDefenseMeetingAccess(userId, defenseId);
  if (access.error) return access;

  if (!access.isPanelist || access.scheduleSource !== 'defense') {
    return { error: 'Only assigned panelists can submit evaluations', status: 403 };
  }

  const defense = access.defense;
  const { scores, notes } = normalizePanelEvaluationPayload(payload);

  const rubric = defense.rubric_id ? await getDefenseRubric(defense.rubric_id) : null;
  const criteriaById = new Map((rubric?.criteria || []).map((c) => [c.id, c]));
  const normalizedScores = [];

  for (const row of scores) {
    const criterionId = row.criterionId;
    if (!criterionId) continue;

    if (!criteriaById.has(criterionId)) {
      return { error: 'One or more rubric criteria are invalid', status: 400 };
    }

    const score = Number(row.score);
    if (!Number.isFinite(score) || score < 0) {
      return { error: 'Scores must be valid non-negative numbers', status: 400 };
    }

    const maxScore = Number(criteriaById.get(criterionId).max_score) || 5;
    if (score > maxScore) {
      return { error: `Score cannot exceed ${maxScore} for a criterion`, status: 400 };
    }

    normalizedScores.push({
      criterionId,
      score,
      comments: typeof row.comments === 'string' ? row.comments.trim() : '',
    });
  }

  if (normalizedScores.length && !rubric) {
    return { error: 'This defense has no rubric assigned', status: 400 };
  }

  let conn;
  try {
    conn = await db.pool.getConnection();
    await conn.beginTransaction();

    await conn.execute(
      'DELETE FROM evaluations WHERE defense_id = ? AND panelist_id = ?',
      [defenseId, userId]
    );

    for (const row of normalizedScores) {
      const [idRows] = await conn.execute('SELECT UUID() AS id');
      await conn.execute(
        `INSERT INTO evaluations (
           id, defense_id, project_id, panelist_id, criterion_id, score, comments
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          idRows[0].id,
          defenseId,
          defense.project_id,
          userId,
          row.criterionId,
          row.score,
          row.comments || null,
        ]
      );
    }

    const [existingNoteRows] = await conn.execute(
      `SELECT id FROM defense_panelist_notes
       WHERE defense_id = ? AND panelist_id = ?
       LIMIT 1`,
      [defenseId, userId]
    );

    if (existingNoteRows.length) {
      await conn.execute(
        `UPDATE defense_panelist_notes SET notes = ? WHERE id = ?`,
        [notes || null, existingNoteRows[0].id]
      );
    } else if (notes.trim()) {
      const [idRows] = await conn.execute('SELECT UUID() AS id');
      await conn.execute(
        `INSERT INTO defense_panelist_notes (id, defense_id, panelist_id, notes)
         VALUES (?, ?, ?, ?)`,
        [idRows[0].id, defenseId, userId, notes]
      );
    }

    if (rubric) {
      await recalculateDefenseOverallScore(conn, defenseId, defense.project_id, rubric);
    }

    await conn.commit();

    await logAuditEntry({
      action: 'evaluation.submitted',
      actorUserId: userId,
      targetType: 'defense',
      targetId: defenseId,
      institutionId: defense.institution_id || null,
      metadata: {
        projectId: defense.project_id,
        criteriaCount: normalizedScores.length,
      },
    });

    return getDefenseMeetingSession(userId, defenseId);
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) { /* ignore */ }
    }
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

module.exports = {
  createDefense,
  getDefensesByUser,
  getDefensesForMember,
  getMeetingsForProject,
  userHasProjectMeetingAccess,
  getProjectDefenseSchedules,
  cancelDefense,
  rescheduleDefense,
  getAdviserMeetingById,
  updateMeeting,
  completeMeeting,
  restoreMeeting,
  validateScheduleConstraints,
  getScheduleWindow,
  getDefenseMeetingSession,
  saveDefensePanelEvaluations,
  getDefenseMeetingGrades,
  assertDefenseMeetingAccess,
};
