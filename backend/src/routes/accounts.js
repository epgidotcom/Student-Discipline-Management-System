import bcrypt from 'bcrypt';
import { Router } from 'express';

import { query } from '../db/client.js';
import { requireAuth, requireWebsitePower } from '../middleware/auth.js';
import { badRequest } from '../utils/errors.js';

const router = Router();

// Shared account serializer for list/create responses.
// Connection: used by all account-management endpoints.
function publicAccount(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    username: row.username,
    role: row.role,
    grade: row.grade,
    createdAt: row.created_at
  };
}

// Allows first account creation without auth to preserve bootstrap workflow.
// Connection: called by POST /api/accounts before role middleware is applied.
async function isBootstrapMode() {
  const result = await query(`SELECT COUNT(*)::int AS total FROM accounts`);
  return Number(result.rows[0]?.total || 0) === 0;
}

// Account list endpoint for Admin/Guidance website-power users.
// Connection: account management UI -> /api/accounts.
router.get('/', requireAuth, requireWebsitePower, async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT id, full_name, email, username, role, grade, created_at
       FROM accounts
       ORDER BY created_at DESC`
    );

    res.status(200).json(result.rows.map(publicAccount));
  } catch (error) {
    next(error);
  }
});

// Account creation endpoint with bootstrap bypass and role enforcement.
// Connection: account-create form -> /api/accounts.
router.post('/', async (req, res, next) => {
  try {
    const bootstrap = await isBootstrapMode();

    if (!bootstrap) {
      await new Promise((resolve, reject) => {
        requireAuth(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      await new Promise((resolve, reject) => {
        requireWebsitePower(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    const { fullName, email, username, password, role = 'Guidance', grade = null } = req.body || {};

    if (!fullName || !email || !username || !password) {
      throw badRequest('fullName, email, username, and password are required');
    }

    const allowedRoles = ['Admin', 'Guidance', 'Student'];
    if (!allowedRoles.includes(role)) {
      throw badRequest('Invalid role');
    }

    const hash = await bcrypt.hash(String(password), 12);

    const insertResult = await query(
      `INSERT INTO accounts (full_name, email, username, password_hash, role, grade)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, full_name, email, username, role, grade, created_at`,
      [
        String(fullName).trim(),
        String(email).trim(),
        String(username).trim(),
        hash,
        role,
        grade ? String(grade) : null
      ]
    );

    res.status(201).json(publicAccount(insertResult.rows[0]));
  } catch (error) {
    if (error?.code === '23505') {
      next(badRequest('Account email or username already exists'));
      return;
    }
    next(error);
  }
});

export default router;