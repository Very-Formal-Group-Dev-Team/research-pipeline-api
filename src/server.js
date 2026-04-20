require('dotenv').config();

const app = require('./app');
const db = require('../config/db');
const { validateProductionEnv } = require('../config/env');

validateProductionEnv();

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
  console.log(`running on http://localhost:${PORT}`);
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Received ${signal}. Closing HTTP server...`);

  server.close(async () => {
    try {
      await db.pool.end();
      console.log('Database pool closed');
    } catch (error) {
      console.error('Error while closing database pool:', error.message);
    } finally {
      process.exit(0);
    }
  });

  setTimeout(() => {
    console.error('Graceful shutdown timed out. Exiting forcefully.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((error) => {
    console.error('Shutdown error:', error);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    console.error('Shutdown error:', error);
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});
