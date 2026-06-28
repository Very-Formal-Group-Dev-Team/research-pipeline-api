const db = require('../../../config/db');

const AUDIT_ACTIONS = new Set([
  'user.login',
  'user.role_assigned',
  'user.role_changed',
  'user.activated',
  'user.deactivated',
  'institution.created',
  'institution.updated',
  'project.stage_changed',
  'paper_version.uploaded',
  'evaluation.submitted',
]);

async function logAuditEntry({
  action,
  actorUserId = null,
  targetType = null,
  targetId = null,
  institutionId = null,
  metadata = null,
}) {
  if (!action || typeof action !== 'string') return;

  const metaJson = metadata != null ? JSON.stringify(metadata) : null;

  await db.query(
    `INSERT INTO system_audit_log
       (action, actor_user_id, target_type, target_id, institution_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      action.slice(0, 64),
      actorUserId || null,
      targetType ? targetType.slice(0, 32) : null,
      targetId || null,
      institutionId || null,
      metaJson,
    ],
  );
}

function parseMetadata(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function listAuditLogs({
  page = 1,
  limit = 50,
  action = null,
  actorUserId = null,
  institutionId = null,
  from = null,
  to = null,
} = {}) {
  const safePage = Math.max(Math.floor(Number(page)) || 1, 1);
  const safeLimit = Math.min(Math.max(Math.floor(Number(limit)) || 50, 1), 100);
  const offset = (safePage - 1) * safeLimit;

  const conditions = [];
  const params = [];

  if (action && typeof action === 'string' && action.trim()) {
    conditions.push('combined.action = ?');
    params.push(action.trim());
  }

  if (actorUserId && typeof actorUserId === 'string') {
    conditions.push('combined.actor_user_id = ?');
    params.push(actorUserId.trim());
  }

  if (institutionId && typeof institutionId === 'string') {
    conditions.push('combined.institution_id = ?');
    params.push(institutionId.trim());
  }

  if (from) {
    conditions.push('combined.created_at >= ?');
    params.push(from);
  }

  if (to) {
    conditions.push('combined.created_at <= ?');
    params.push(to);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const collate = 'utf8mb4_unicode_ci';
  const baseQuery = `
    FROM (
      SELECT
        sal.id COLLATE ${collate} AS id,
        sal.action COLLATE ${collate} AS action,
        sal.actor_user_id COLLATE ${collate} AS actor_user_id,
        sal.target_type COLLATE ${collate} AS target_type,
        sal.target_id COLLATE ${collate} AS target_id,
        sal.institution_id COLLATE ${collate} AS institution_id,
        sal.metadata,
        sal.created_at,
        CAST('system' AS CHAR(16)) COLLATE ${collate} AS source,
        CAST(NULL AS CHAR(36)) COLLATE ${collate} AS project_id
      FROM system_audit_log sal
      UNION ALL
      SELECT
        pal.id COLLATE ${collate},
        pal.action COLLATE ${collate},
        pal.actor_user_id COLLATE ${collate},
        CAST('project' AS CHAR(32)) COLLATE ${collate} AS target_type,
        pal.project_id COLLATE ${collate} AS target_id,
        p.institution_id COLLATE ${collate},
        pal.metadata,
        pal.created_at,
        CAST('project' AS CHAR(16)) COLLATE ${collate} AS source,
        pal.project_id COLLATE ${collate} AS project_id
      FROM project_audit_log pal
      INNER JOIN projects p ON p.id = pal.project_id
    ) combined
    LEFT JOIN users actor ON actor.id = combined.actor_user_id
    LEFT JOIN institutions inst ON inst.id = combined.institution_id
    LEFT JOIN projects proj ON proj.id = combined.project_id
    ${whereClause}
  `;

  const countQuery = `SELECT COUNT(*) AS total ${baseQuery}`;
  const { rows: countRows } = await db.query(countQuery, params);
  const total = Number(countRows[0]?.total) || 0;

  const dataQuery = `
    SELECT
      combined.id,
      combined.action,
      combined.actor_user_id,
      actor.full_name AS actor_name,
      actor.email AS actor_email,
      combined.target_type,
      combined.target_id,
      combined.institution_id,
      inst.name AS institution_name,
      combined.metadata,
      combined.created_at,
      combined.source,
      combined.project_id,
      proj.title AS project_title
    ${baseQuery}
    ORDER BY combined.created_at DESC
    LIMIT ${safeLimit} OFFSET ${offset}
  `;

  const { rows } = await db.query(dataQuery, params);

  return {
    data: rows.map((row) => ({
      id: row.id,
      action: row.action,
      actor_user_id: row.actor_user_id,
      actor_name: row.actor_name,
      actor_email: row.actor_email,
      target_type: row.target_type,
      target_id: row.target_id,
      institution_id: row.institution_id,
      institution_name: row.institution_name,
      metadata: parseMetadata(row.metadata),
      created_at: row.created_at,
      source: row.source,
      project_id: row.project_id,
      project_title: row.project_title,
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 1,
    },
  };
}

async function countUsersWithRole(role) {
  const { rows } = await db.query(
    `SELECT COUNT(*) AS count
     FROM users u
     INNER JOIN user_roles ur
       ON ur.user_id = u.id
       AND ur.id = (
         SELECT ur2.id
         FROM user_roles ur2
         WHERE ur2.user_id = u.id
         ORDER BY ur2.created_at DESC
         LIMIT 1
       )
     WHERE ur.role = ? AND u.status = 1`,
    [role],
  );
  return Number(rows[0]?.count) || 0;
}

module.exports = {
  AUDIT_ACTIONS,
  logAuditEntry,
  listAuditLogs,
  countUsersWithRole,
};
