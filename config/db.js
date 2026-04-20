const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  timezone: '+00:00',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

async function testConnectionWithRetry(retries = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const connection = await pool.getConnection();
      console.log('Database connected successfully');
      connection.release();
      return;
    } catch (err) {
      console.error(`Database connection attempt ${attempt}/${retries} failed:`, err.message);
      if (attempt === retries) {
        console.error('Could not connect to database after all retries — server will continue but DB queries will fail');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

testConnectionWithRetry();

module.exports = {
  query: async (text, params) => {
    const [rows] = await pool.execute(text, params);
    return { rows };
  },
  pool,
};
