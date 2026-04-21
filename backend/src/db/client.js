import { Pool } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let pool = null;

// Lazily creates a singleton DB pool.
// Connection: query() and checkDatabaseConnection() both rely on this initializer.
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    pool.on('error', (error) => {
      logger.error('Unexpected PostgreSQL pool error', { message: error.message });
    });
  }

  return pool;
}

// Generic SQL executor consumed by route/service modules.
export async function query(text, params = []) {
  const db = getPool();
  return db.query(text, params);
}

// Readiness helper consumed by health routes.
export async function checkDatabaseConnection() {
  try {
    await query('SELECT 1 AS ok');
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error.message
    };
  }
}

// Graceful shutdown helper consumed by server shutdown hooks.
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Returns a pooled client for explicit transactions. Caller must `release()`.
export async function getClient() {
  const db = getPool();
  return db.connect();
}