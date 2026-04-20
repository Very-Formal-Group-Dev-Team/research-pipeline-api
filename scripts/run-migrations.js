const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function waitForDb(retries = 15, delayMs = 4000) {
  const config = {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '3306', 10),
    user: process.env.DB_USER ?? 'appuser',
    password: process.env.DB_PASSWORD ?? 'password',
  };
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const conn = await mysql.createConnection(config);
      await conn.end();
      console.log('Database is reachable');
      return;
    } catch (err) {
      console.log(`Waiting for database... attempt ${attempt}/${retries}`);
      if (attempt === retries) throw err;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

async function runMigrations() {
  await waitForDb();

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '3306', 10),
    database: process.env.DB_NAME ?? 'student_research',
    user: process.env.DB_USER ?? 'appuser',
    password: process.env.DB_PASSWORD ?? 'password',
    multipleStatements: true,
  });

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const [applied] = await connection.query('SELECT name FROM _migrations');
    const appliedSet = new Set(applied.map(r => r.name));

    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`Applying migration: ${file}`);
      await connection.query(sql);
      await connection.query('INSERT INTO _migrations (name) VALUES (?)', [file]);
      console.log(`Applied: ${file}`);
    }

    console.log('All migrations applied');
  } finally {
    await connection.end();
  }
}

runMigrations().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
