const db = require('../../../config/db');
const {
  REGISTERED_INSTITUTIONS,
} = require('../../constants/institutions');

async function ensureRegisteredInstitutions() {
  const { rows: countRows } = await db.query('SELECT COUNT(*) AS total FROM institutions');
  const total = Number(countRows[0]?.total) || 0;
  if (total > 0) {
    return;
  }

  for (const institution of REGISTERED_INSTITUTIONS) {
    await db.query(
      `INSERT INTO institutions (id, name, code, is_active, created_at, updated_at)
       VALUES (UUID(), ?, ?, 1, NOW(), NOW())`,
      [institution.name, institution.code],
    );
  }
}

async function searchInstitutions(query, { activeOnly = true } = {}) {
  await ensureRegisteredInstitutions();

  const params = [];
  let sql = `SELECT id, name, code, is_active, created_at, updated_at
             FROM institutions
             WHERE 1=1`;

  if (activeOnly) {
    sql += ' AND is_active = 1';
  }

  const trimmedQuery = typeof query === 'string' ? query.trim() : '';
  if (trimmedQuery) {
    sql += ' AND (LOWER(name) LIKE ? OR LOWER(code) LIKE ?)';
    const like = `%${trimmedQuery.toLowerCase()}%`;
    params.push(like, like);
  }

  sql += ' ORDER BY name ASC';

  const { rows } = await db.query(sql, params);
  return rows;
}

async function getInstitutionById(institutionId, { activeOnly = false } = {}) {
  if (!institutionId) return null;

  const params = [institutionId];
  let sql = `SELECT id, name, code, is_active, created_at, updated_at
             FROM institutions
             WHERE id = ?`;

  if (activeOnly) {
    sql += ' AND is_active = 1';
  }

  sql += ' LIMIT 1';

  const { rows } = await db.query(sql, params);
  return rows[0] || null;
}

async function isRegisteredInstitutionId(institutionId) {
  const institution = await getInstitutionById(institutionId, { activeOnly: true });
  return Boolean(institution);
}

async function listAllInstitutions() {
  const { rows } = await db.query(
    `SELECT id, name, code, is_active, created_at, updated_at
     FROM institutions
     ORDER BY name ASC`,
  );
  return rows;
}

async function createInstitution({ name, code }) {
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const trimmedCode = typeof code === 'string' ? code.trim().toUpperCase() : '';

  if (!trimmedName || !trimmedCode) {
    return { error: 'Name and code are required' };
  }

  if (!/^[A-Z0-9_-]{2,50}$/.test(trimmedCode)) {
    return { error: 'Code must be 2-50 characters (letters, numbers, underscore, hyphen)' };
  }

  try {
    await db.query(
      `INSERT INTO institutions (id, name, code, is_active, created_at, updated_at)
       VALUES (UUID(), ?, ?, 1, NOW(), NOW())`,
      [trimmedName, trimmedCode],
    );
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return { error: 'An institution with this code already exists' };
    }
    throw err;
  }

  const { rows } = await db.query(
    'SELECT id, name, code, is_active, created_at, updated_at FROM institutions WHERE code = ? LIMIT 1',
    [trimmedCode],
  );

  return { data: rows[0] };
}

async function updateInstitution(institutionId, { name, code, isActive }) {
  const existing = await getInstitutionById(institutionId);
  if (!existing) {
    return { error: 'Institution not found' };
  }

  const nextName = typeof name === 'string' ? name.trim() : existing.name;
  const nextCode = typeof code === 'string' ? code.trim().toUpperCase() : existing.code;
  const nextActive = typeof isActive === 'boolean' ? (isActive ? 1 : 0) : existing.is_active;

  if (!nextName || !nextCode) {
    return { error: 'Name and code are required' };
  }

  if (!/^[A-Z0-9_-]{2,50}$/.test(nextCode)) {
    return { error: 'Code must be 2-50 characters (letters, numbers, underscore, hyphen)' };
  }

  try {
    await db.query(
      `UPDATE institutions
       SET name = ?, code = ?, is_active = ?, updated_at = NOW()
       WHERE id = ?`,
      [nextName, nextCode, nextActive, institutionId],
    );
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return { error: 'An institution with this code already exists' };
    }
    throw err;
  }

  const updated = await getInstitutionById(institutionId);
  return { data: updated };
}

async function getCoursesByInstitutionId(institutionId) {
  const institution = await getInstitutionById(institutionId, { activeOnly: true });
  if (!institution) {
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

  const institution = await getInstitutionById(institutionId, { activeOnly: true });
  if (!institution) return null;

  const { rows } = await db.query(
    `SELECT id, institution_id, course_name, code, description
     FROM courses
     WHERE id = ? AND institution_id = ?
     LIMIT 1`,
    [courseId, institutionId],
  );

  return rows[0] || null;
}

async function generateUniqueProgramCode(institutionId, programName) {
  const words = String(programName || '')
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toUpperCase());
  let base = words.join('_').slice(0, 50) || 'PROGRAM';
  if (base.length < 2) {
    base = 'PROGRAM';
  }

  for (let suffix = 0; suffix < 100; suffix += 1) {
    const code =
      suffix === 0
        ? base
        : `${base.slice(0, Math.max(2, 20 - String(suffix).length - 1))}_${suffix}`;
    const { rows } = await db.query(
      'SELECT id FROM programs WHERE institution_id = ? AND code = ? LIMIT 1',
      [institutionId, code],
    );
    if (!rows.length) {
      return code;
    }
  }

  throw new Error('Unable to generate unique program code');
}

async function materializeLegacyPrograms(institutionId) {
  if (!institutionId) return;

  const { rows: legacyNames } = await db.query(
    `SELECT DISTINCT TRIM(program) AS program_name
     FROM projects
     WHERE institution_id = ?
       AND program_id IS NULL
       AND TRIM(IFNULL(program, '')) != ''`,
    [institutionId],
  );

  for (const row of legacyNames) {
    const programName = row.program_name;
    if (!programName) continue;

    const { rows: existingByName } = await db.query(
      `SELECT id FROM programs
       WHERE institution_id = ? AND LOWER(name) = LOWER(?)
       LIMIT 1`,
      [institutionId, programName],
    );

    let programId = existingByName[0]?.id;

    if (!programId) {
      const code = await generateUniqueProgramCode(institutionId, programName);
      const created = await createProgram(institutionId, {
        name: programName,
        code,
        description: null,
      });

      if (created.error) {
        const { rows: retry } = await db.query(
          `SELECT id FROM programs
           WHERE institution_id = ? AND LOWER(name) = LOWER(?)
           LIMIT 1`,
          [institutionId, programName],
        );
        programId = retry[0]?.id;
      } else {
        programId = created.data?.id;
      }
    }

    if (programId) {
      await db.query(
        `UPDATE projects
         SET program_id = ?
         WHERE institution_id = ?
           AND program_id IS NULL
           AND LOWER(TRIM(program)) = LOWER(?)`,
        [programId, institutionId, programName],
      );
    }
  }
}

async function getProgramsByInstitutionId(institutionId, { activeOnly = true } = {}) {
  const institution = await getInstitutionById(institutionId, { activeOnly });
  if (!institution) {
    return { error: 'Institution not found' };
  }

  const params = [institutionId];
  let sql = `SELECT id, institution_id, name, code, description, is_active, created_at, updated_at
             FROM programs
             WHERE institution_id = ?`;

  if (activeOnly) {
    sql += ' AND is_active = 1';
  }

  sql += ' ORDER BY name ASC';

  const { rows } = await db.query(sql, params);
  return { data: rows };
}

async function getProgramForInstitution(institutionId, programId, { activeOnly = true } = {}) {
  if (!programId) return null;

  const params = [programId, institutionId];
  let sql = `SELECT id, institution_id, name, code, description, is_active
             FROM programs
             WHERE id = ? AND institution_id = ?`;

  if (activeOnly) {
    sql += ' AND is_active = 1';
  }

  sql += ' LIMIT 1';

  const { rows } = await db.query(sql, params);
  return rows[0] || null;
}

async function listProgramsForInstitution(institutionId) {
  return getProgramsByInstitutionId(institutionId, { activeOnly: false });
}

async function createProgram(institutionId, { name, code, description }) {
  const institution = await getInstitutionById(institutionId);
  if (!institution) {
    return { error: 'Institution not found' };
  }

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const trimmedCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
  const trimmedDescription =
    typeof description === 'string' ? description.trim() || null : null;

  if (!trimmedName || !trimmedCode) {
    return { error: 'Name and code are required' };
  }

  if (!/^[A-Z0-9_-]{2,50}$/.test(trimmedCode)) {
    return { error: 'Code must be 2-50 characters (letters, numbers, underscore, hyphen)' };
  }

  try {
    await db.query(
      `INSERT INTO programs (id, institution_id, name, code, description, is_active, created_at, updated_at)
       VALUES (UUID(), ?, ?, ?, ?, 1, NOW(), NOW())`,
      [institutionId, trimmedName, trimmedCode, trimmedDescription],
    );
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return { error: 'A program with this code already exists for this institution' };
    }
    throw err;
  }

  const { rows } = await db.query(
    `SELECT id, institution_id, name, code, description, is_active, created_at, updated_at
     FROM programs
     WHERE institution_id = ? AND code = ?
     LIMIT 1`,
    [institutionId, trimmedCode],
  );

  return { data: rows[0] };
}

async function updateProgram(programId, institutionId, { name, code, description, isActive }) {
  const existing = await getProgramForInstitution(institutionId, programId, { activeOnly: false });
  if (!existing) {
    return { error: 'Program not found' };
  }

  const nextName = typeof name === 'string' ? name.trim() : existing.name;
  const nextCode = typeof code === 'string' ? code.trim().toUpperCase() : existing.code;
  const nextDescription =
    typeof description === 'string' ? description.trim() || null : existing.description;
  const nextActive = typeof isActive === 'boolean' ? (isActive ? 1 : 0) : existing.is_active;

  if (!nextName || !nextCode) {
    return { error: 'Name and code are required' };
  }

  if (!/^[A-Z0-9_-]{2,50}$/.test(nextCode)) {
    return { error: 'Code must be 2-50 characters (letters, numbers, underscore, hyphen)' };
  }

  try {
    await db.query(
      `UPDATE programs
       SET name = ?, code = ?, description = ?, is_active = ?, updated_at = NOW()
       WHERE id = ? AND institution_id = ?`,
      [nextName, nextCode, nextDescription, nextActive, programId, institutionId],
    );
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return { error: 'A program with this code already exists for this institution' };
    }
    throw err;
  }

  const updated = await getProgramForInstitution(institutionId, programId, { activeOnly: false });
  return { data: updated };
}

/** @deprecated use searchInstitutions */
async function searchRegisteredInstitutions(query) {
  return searchInstitutions(query, { activeOnly: true });
}

module.exports = {
  ensureRegisteredInstitutions,
  searchInstitutions,
  searchRegisteredInstitutions,
  getInstitutionById,
  isRegisteredInstitutionId,
  listAllInstitutions,
  createInstitution,
  updateInstitution,
  getCoursesByInstitutionId,
  getCourseForInstitution,
  getProgramsByInstitutionId,
  getProgramForInstitution,
  listProgramsForInstitution,
  materializeLegacyPrograms,
  createProgram,
  updateProgram,
};
