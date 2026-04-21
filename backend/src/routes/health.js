import { Router } from 'express';
import { checkDatabaseConnection } from '../db/client.js';

const router = Router();

// Liveness route used by Render and simple uptime checks.
// Connection: mounted under /api by app bootstrap.
router.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'sdms-backend',
    time: new Date().toISOString()
  });
});

// Readiness route validates DB connectivity before marking service ready.
// Connection: depends on db/client checkDatabaseConnection().
router.get('/ready', async (_req, res) => {
  const dbStatus = await checkDatabaseConnection();
  const status = dbStatus.ok ? 200 : 503;

  res.status(status).json({
    ok: dbStatus.ok,
    dependencies: {
      database: dbStatus
    },
    time: new Date().toISOString()
  });
});

export default router;