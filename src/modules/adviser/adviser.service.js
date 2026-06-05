const crypto = require('crypto');
const db = require('../../../config/db');

const ADVISER_RUBRIC_ROLE_FILTER = "r.role = 'adviser'";

async function getInstitutionByAdviser(userId) {
  const { rows } = await db.query(
    `SELECT i.*
     FROM institutions i
     INNER JOIN user_roles ur ON ur.institution_id = i.id
     WHERE ur.user_id = ? AND ur.role IN ('adviser', 'teacher')
     ORDER BY ur.created_at DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

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

async function getAdviserRubricById(institutionId, userId, rubricId) {
  const { rows } = await db.query(
    `SELECT r.id, r.name, r.description, r.defense_type, r.role, r.created_by, r.created_at
     FROM rubrics r
     INNER JOIN user_roles ur ON ur.user_id = r.created_by
     WHERE r.id = ?
       AND r.created_by = ?
       AND ur.institution_id = ?
       AND ${ADVISER_RUBRIC_ROLE_FILTER}
     LIMIT 1`,
    [rubricId, userId, institutionId]
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

async function listAdviserRubrics(institutionId, userId) {
  const { rows } = await db.query(
    `SELECT r.id, r.name, r.description, r.defense_type, r.role, r.created_at,
            COUNT(rc.id) AS criteria_count,
            COALESCE(SUM(rc.weight), 0) AS total_weight
     FROM rubrics r
     INNER JOIN user_roles ur ON ur.user_id = r.created_by
     LEFT JOIN rubric_criteria rc ON rc.rubric_id = r.id
     WHERE ur.institution_id = ?
       AND r.created_by = ?
       AND ${ADVISER_RUBRIC_ROLE_FILTER}
     GROUP BY r.id, r.name, r.description, r.defense_type, r.role, r.created_at
     ORDER BY r.defense_type ASC, r.name ASC`,
    [institutionId, userId]
  );
  return rows;
}

async function createAdviserRubric(institutionId, userId, payload) {
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
       VALUES (?, ?, ?, ?, 'adviser', ?)`,
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
    return getAdviserRubricById(institutionId, userId, rubricId);
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

async function updateAdviserRubric(institutionId, userId, rubricId, payload) {
  const existing = await getAdviserRubricById(institutionId, userId, rubricId);
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
    return getAdviserRubricById(institutionId, userId, rubricId);
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteAdviserRubric(institutionId, userId, rubricId) {
  const existing = await getAdviserRubricById(institutionId, userId, rubricId);
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

module.exports = {
  getInstitutionByAdviser,
  listAdviserRubrics,
  getAdviserRubricById,
  createAdviserRubric,
  updateAdviserRubric,
  deleteAdviserRubric,
};
