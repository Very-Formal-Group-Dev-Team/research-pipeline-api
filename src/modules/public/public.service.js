const db = require('../../../config/db');

function toCount(value) {
  if (value == null) return 0;
  if (typeof value === 'bigint') return Number(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function getPublicStats() {
  // Keep these queries intentionally simple for a public landing page.
  const projectsRes = await db.query('SELECT COUNT(*) AS count FROM projects');
  const usersRes = await db.query('SELECT COUNT(*) AS count FROM users');
  const finishedRes = await db.query(
    `SELECT COUNT(*) AS count
     FROM projects
     WHERE LOWER(COALESCE(status, '')) IN ('completed', 'archived')`,
  );

  return {
    totalProjects: toCount(projectsRes.rows[0]?.count),
    totalUsers: toCount(usersRes.rows[0]?.count),
    finishedProjects: toCount(finishedRes.rows[0]?.count),
  };
}

module.exports = {
  getPublicStats,
};

