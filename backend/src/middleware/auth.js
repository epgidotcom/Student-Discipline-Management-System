import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import { query } from '../db/client.js';
import { forbidden, unauthorized } from '../utils/errors.js';

const TOKEN_TTL_SECONDS = 60 * 60 * 8;

// Website-level power roles (full web interface access).
// Connection: used by route guards for admin/guidance parity on website features.
export const WEBSITE_POWER_ROLES = Object.freeze(['Admin', 'Guidance']);

// Technical admin roles (reserved for code/DB/system endpoints).
// Connection: use this guard only on technical maintenance routes.
export const TECHNICAL_ADMIN_ROLES = Object.freeze(['Admin']);

// Signs auth tokens consumed by frontend clients and downstream auth middleware.
// Connection: used by auth route login endpoint.
export function signToken(account) {
  return jwt.sign(
    {
      sub: account.id,
      role: account.role,
      username: account.username
    },
    env.JWT_SECRET,
    { expiresIn: TOKEN_TTL_SECONDS }
  );
}

// Resolves Bearer token into req.user for protected endpoints.
// Connection: used by auth/me, accounts route guards, and future domain routes.
export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      throw unauthorized('Missing bearer token');
    }

    const payload = jwt.verify(match[1], env.JWT_SECRET);
    const result = await query(
      `SELECT id, full_name, email, username, role, grade
       FROM accounts
       WHERE id = $1`,
      [payload.sub]
    );

    if (!result.rows.length) {
      throw unauthorized('Account not found');
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    next(error.name === 'JsonWebTokenError' ? unauthorized('Invalid token') : error);
  }
}

// Enforces role-based access for admin-level routes.
// Connection: composed after requireAuth in route-level middleware chains.
export function requireRoles(roles) {
  const normalized = Array.isArray(roles) ? roles : [];

  return function roleGuard(req, _res, next) {
    const role = req.user?.role;
    if (!role || !normalized.includes(role)) {
      next(forbidden('Insufficient role permissions'));
      return;
    }
    next();
  };
}

// Shortcut guard for endpoints where Admin and Guidance should have equal website power.
// Connection: used by account and future website management routes.
export function requireWebsitePower(req, res, next) {
  return requireRoles(WEBSITE_POWER_ROLES)(req, res, next);
}

// Shortcut guard for technical-only operations.
// Connection: use in future technical routes (migration/admin tooling) where Guidance must be blocked.
export function requireTechnicalAdmin(req, res, next) {
  return requireRoles(TECHNICAL_ADMIN_ROLES)(req, res, next);
}