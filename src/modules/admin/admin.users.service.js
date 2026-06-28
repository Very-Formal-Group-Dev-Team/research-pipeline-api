const db = require('../../../config/db');
const { logAuditEntry, countUsersWithRole } = require('../audit/audit.service');

const ALLOWED_ROLES = new Set(['student', 'adviser', 'teacher', 'coordinator', 'admin']);

function normalizeRole(role) {
  if (!role || typeof role !== 'string') return null;
  const normalized = role.trim().toLowerCase();
  if (!ALLOWED_ROLES.has(normalized)) return null;
  return normalized === 'teacher' ? 'adviser' : normalized;
}

function mapUserRow(row) {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    avatar_url: row.avatar_url,
    status: row.status,
    email_verified: row.email_verified,
    auth_provider: row.auth_provider,
    role: row.role,
    institution_id: row.institution_id,
    institution_name: row.institution_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const USER_LIST_FROM = `
  FROM users u
  LEFT JOIN user_roles ur
    ON ur.user_id = u.id
    AND ur.id = (
      SELECT ur2.id
      FROM user_roles ur2
      WHERE ur2.user_id = u.id
      ORDER BY ur2.created_at DESC
      LIMIT 1
    )
  LEFT JOIN institutions i ON i.id = ur.institution_id
`;

async function listUsers({
  search = null,
  role = null,
  institutionId = null,
  status = null,
  page = 1,
  limit = 25,
} = {}) {
  const safePage = Math.max(Math.floor(Number(page)) || 1, 1);
  const safeLimit = Math.min(Math.max(Math.floor(Number(limit)) || 25, 1), 100);
  const offset = (safePage - 1) * safeLimit;

  const conditions = [];
  const params = [];

  if (search && typeof search === 'string' && search.trim()) {
    const term = `%${search.trim()}%`;
    conditions.push('(u.email LIKE ? OR u.full_name LIKE ?)');
    params.push(term, term);
  }

  const normalizedRole = role ? normalizeRole(role) : null;
  if (normalizedRole) {
    conditions.push('ur.role = ?');
    params.push(normalizedRole);
  }

  if (institutionId && typeof institutionId === 'string') {
    conditions.push('ur.institution_id = ?');
    params.push(institutionId.trim());
  }

  if (status === 'active') {
    conditions.push('u.status = 1');
  } else if (status === 'inactive') {
    conditions.push('u.status = 0');
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countQuery = `SELECT COUNT(*) AS total ${USER_LIST_FROM} ${whereClause}`;
  const { rows: countRows } = await db.query(countQuery, params);
  const total = Number(countRows[0]?.total) || 0;

  const dataQuery = `
    SELECT
      u.id,
      u.email,
      u.full_name,
      u.avatar_url,
      u.status,
      u.email_verified,
      u.auth_provider,
      u.created_at,
      u.updated_at,
      ur.role,
      ur.institution_id,
      i.name AS institution_name
    ${USER_LIST_FROM}
    ${whereClause}
    ORDER BY u.created_at DESC
    LIMIT ${safeLimit} OFFSET ${offset}
  `;

  const { rows } = await db.query(dataQuery, params);

  return {
    data: rows.map(mapUserRow),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 1,
    },
  };
}

async function getUserById(userId) {
  const { rows } = await db.query(
    `
    SELECT
      u.id,
      u.email,
      u.full_name,
      u.avatar_url,
      u.status,
      u.email_verified,
      u.auth_provider,
      u.created_at,
      u.updated_at,
      ur.id AS user_role_id,
      ur.role,
      ur.institution_id,
      i.name AS institution_name
    ${USER_LIST_FROM}
    WHERE u.id = ?
    LIMIT 1
    `,
    [userId],
  );

  if (!rows[0]) return null;
  return mapUserRow(rows[0]);
}

async function countActiveAdmins(excludeUserId = null) {
  let query = `
    SELECT COUNT(*) AS count
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
    WHERE ur.role = 'admin' AND u.status = 1
  `;
  const params = [];
  if (excludeUserId) {
    query += ' AND u.id != ?';
    params.push(excludeUserId);
  }
  const { rows } = await db.query(query, params);
  return Number(rows[0]?.count) || 0;
}

async function updateUser(actorUserId, userId, payload) {
  if (actorUserId === userId && payload.status === 0) {
    return { error: 'You cannot deactivate your own account' };
  }

  const existing = await getUserById(userId);
  if (!existing) {
    return { error: 'User not found', status: 404 };
  }

  const institutionsService = require('../institutions/institutions.service');
  const updates = {};
  let roleChanged = false;
  let statusChanged = false;

  if (payload.role !== undefined) {
    const newRole = normalizeRole(payload.role);
    if (!newRole) {
      return { error: 'role must be one of: student, adviser, coordinator, admin' };
    }

    if (existing.role === 'admin' && newRole !== 'admin' && existing.status === 1) {
      const otherAdmins = await countActiveAdmins(userId);
      if (otherAdmins === 0) {
        return { error: 'Cannot remove the last active admin' };
      }
    }

    updates.role = newRole;
    roleChanged = existing.role !== newRole;
  }

  if (payload.institutionId !== undefined) {
    const institutionId =
      typeof payload.institutionId === 'string' && payload.institutionId.trim()
        ? payload.institutionId.trim()
        : null;

    if (!institutionId) {
      return { error: 'institutionId is required' };
    }

    const isRegistered = await institutionsService.isRegisteredInstitutionId(institutionId);
    if (!isRegistered) {
      return { error: 'Institution not found or inactive' };
    }

    updates.institutionId = institutionId;
  }

  if (payload.status !== undefined) {
    const nextStatus = payload.status === 0 || payload.status === false ? 0 : 1;
    if (existing.status === 1 && nextStatus === 0 && existing.role === 'admin') {
      const otherAdmins = await countActiveAdmins(userId);
      if (otherAdmins === 0) {
        return { error: 'Cannot deactivate the last active admin' };
      }
    }
    updates.status = nextStatus;
    statusChanged = existing.status !== nextStatus;
  }

  if (!roleChanged && !statusChanged && !updates.institutionId) {
    return { error: 'No supported fields to update' };
  }

  if (updates.status !== undefined) {
    await db.query('UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?', [
      updates.status,
      userId,
    ]);
  }

  if (updates.role !== undefined || updates.institutionId !== undefined) {
    const nextRole = updates.role ?? existing.role;
    const nextInstitutionId = updates.institutionId ?? existing.institution_id;

    const { rows: roleRows } = await db.query(
      'SELECT id FROM user_roles WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [userId],
    );

    if (roleRows[0]) {
      await db.query(
        'UPDATE user_roles SET role = ?, institution_id = ? WHERE id = ?',
        [nextRole, nextInstitutionId, roleRows[0].id],
      );
    } else {
      await db.query(
        'INSERT INTO user_roles (id, user_id, role, institution_id, created_at) VALUES (UUID(), ?, ?, ?, NOW())',
        [userId, nextRole, nextInstitutionId],
      );
    }
  }

  if (statusChanged) {
    await logAuditEntry({
      action: updates.status === 1 ? 'user.activated' : 'user.deactivated',
      actorUserId,
      targetType: 'user',
      targetId: userId,
      institutionId: updates.institutionId ?? existing.institution_id,
      metadata: {
        email: existing.email,
        previousStatus: existing.status,
        newStatus: updates.status,
      },
    });
  }

  if (roleChanged) {
    await logAuditEntry({
      action: existing.role ? 'user.role_changed' : 'user.role_assigned',
      actorUserId,
      targetType: 'user',
      targetId: userId,
      institutionId: updates.institutionId ?? existing.institution_id,
      metadata: {
        email: existing.email,
        previousRole: existing.role,
        newRole: updates.role,
      },
    });
  } else if (updates.institutionId && updates.institutionId !== existing.institution_id) {
    await logAuditEntry({
      action: 'user.role_changed',
      actorUserId,
      targetType: 'user',
      targetId: userId,
      institutionId: updates.institutionId,
      metadata: {
        email: existing.email,
        previousInstitutionId: existing.institution_id,
        newInstitutionId: updates.institutionId,
        role: updates.role ?? existing.role,
      },
    });
  }

  const updated = await getUserById(userId);
  return { data: updated };
}

module.exports = {
  listUsers,
  getUserById,
  updateUser,
  countUsersWithRole,
};
