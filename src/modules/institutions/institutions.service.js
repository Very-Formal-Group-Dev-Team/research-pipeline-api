const db = require('../../../config/db');
const {
  REGISTERED_INSTITUTIONS,
  getRegisteredInstitutionCodes,
} = require('../../constants/institutions');

async function ensureRegisteredInstitutions() {
  for (const institution of REGISTERED_INSTITUTIONS) {
    const { rows } = await db.query(
      'SELECT id FROM institutions WHERE code = ? LIMIT 1',
      [institution.code],
    );

    if (!rows[0]) {
      await db.query(
        `INSERT INTO institutions (id, name, code, created_at, updated_at)
         VALUES (UUID(), ?, ?, NOW(), NOW())`,
        [institution.name, institution.code],
      );
    } else {
      await db.query(
        'UPDATE institutions SET name = ?, updated_at = NOW() WHERE code = ?',
        [institution.name, institution.code],
      );
    }
  }
}

async function searchRegisteredInstitutions(query) {
  await ensureRegisteredInstitutions();

  const codes = getRegisteredInstitutionCodes();
  if (!codes.length) return [];

  const placeholders = codes.map(() => '?').join(', ');
  const params = [...codes];
  let sql = `SELECT id, name, code
             FROM institutions
             WHERE code IN (${placeholders})`;

  const trimmedQuery = typeof query === 'string' ? query.trim() : '';
  if (trimmedQuery) {
    sql += ' AND LOWER(name) LIKE ?';
    params.push(`%${trimmedQuery.toLowerCase()}%`);
  }

  sql += ' ORDER BY name ASC';

  const { rows } = await db.query(sql, params);
  return rows;
}

async function isRegisteredInstitutionId(institutionId) {
  if (!institutionId) return false;

  await ensureRegisteredInstitutions();

  const codes = getRegisteredInstitutionCodes();
  if (!codes.length) return false;

  const placeholders = codes.map(() => '?').join(', ');
  const { rows } = await db.query(
    `SELECT id FROM institutions WHERE id = ? AND code IN (${placeholders}) LIMIT 1`,
    [institutionId, ...codes],
  );

  return Boolean(rows[0]);
}

async function getCoursesByInstitutionId(institutionId) {
  const isRegistered = await isRegisteredInstitutionId(institutionId);
  if (!isRegistered) {
    return { error: 'Institution not found' };
  }

  const { rows } = await db.query(
    `SELECT id, institution_id, course_name, code, description, created_at, updated_at
     FROM courses
     WHERE institution_id = ?
     ORDER BY course_name ASC`,
    [institutionId],
  );

  return { data: rows };
}

async function getCourseForInstitution(institutionId, courseId) {
  if (!courseId) return null;

  const isRegistered = await isRegisteredInstitutionId(institutionId);
  if (!isRegistered) return null;

  const { rows } = await db.query(
    `SELECT id, institution_id, course_name, code, description
     FROM courses
     WHERE id = ? AND institution_id = ?
     LIMIT 1`,
    [courseId, institutionId],
  );

  return rows[0] || null;
}

module.exports = {
  ensureRegisteredInstitutions,
  searchRegisteredInstitutions,
  isRegisteredInstitutionId,
  getCoursesByInstitutionId,
  getCourseForInstitution,
};
