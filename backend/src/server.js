import app from './app.js';
import { env } from './config/env.js';
import { closePool } from './db/client.js';
import { logger } from './utils/logger.js';

// Starts the HTTP server and wires graceful shutdown.
// Connection: app -> routes/middleware, closePool -> db/client singleton.
const server = app.listen(env.PORT, () => {
  logger.info('SDMS backend started', {
    port: env.PORT,
    env: env.NODE_ENV
  });
});

async function shutdown(signal) {
  logger.info('Shutdown signal received', { signal });
  server.close(async () => {
    await closePool();
    logger.info('HTTP server and DB pool closed');
    process.exit(0);
  });
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((error) => {
    logger.error('Shutdown error', { message: error.message });
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    logger.error('Shutdown error', { message: error.message });
    process.exit(1);
  });
});