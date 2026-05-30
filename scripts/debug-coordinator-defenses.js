const db = require('../config/db');

async function run() {
  try {
    const scheduleExpr = "COALESCE(d.scheduled_at,d.verified_schedule,d.proposed_schedule,d.created_at)";
    const institutionId = process.argv[2] || 'aa6340f0-4cfa-11f1-a589-30138b88e8e1';
    const sql = `SELECT d.id, p.title AS project_title, p.project_code, ${scheduleExpr} AS scheduled_at, COALESCE(d.end_time, ${scheduleExpr}) AS end_time, u.full_name AS created_by_name, (SELECT u2.full_name FROM project_members pm2 INNER JOIN users u2 ON u2.id = pm2.user_id WHERE pm2.project_id = d.project_id AND pm2.role = 'adviser' AND pm2.status = 'accepted' ORDER BY pm2.invited_at ASC LIMIT 1) AS adviser_name FROM defenses d INNER JOIN projects p ON d.project_id = p.id LEFT JOIN courses c ON p.course_id = c.id LEFT JOIN users u ON d.created_by = u.id WHERE (p.institution_id = ? OR c.institution_id = ?) ORDER BY ${scheduleExpr} DESC LIMIT 50`;
    const { rows } = await db.query(sql, [institutionId, institutionId]);
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
