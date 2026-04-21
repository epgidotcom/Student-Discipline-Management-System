import { Router } from 'express';

import { query } from '../db/client.js';
import { requireAuth, requireWebsitePower } from '../middleware/auth.js';
import { badRequest, notFound } from '../utils/errors.js';

const router = Router();

// Normalizes optional text values used by offense payload fields.
// Connection: shared by create/update offense endpoints.
function optionalText(value) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

// Parses and validates offense primary key params.
// Connection: used by GET/PATCH/DELETE offense-by-id endpoints.
function parseOffenseId(rawValue) {
  const parsed = Number.parseInt(String(rawValue ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest('offenseId must be a positive integer');
  }
  return parsed;
}

// Shapes offense rows for stable API response contracts.
// Connection: used by all offense read/write routes.
function toOffenseResponse(row) {
  return {
    id: row.id,
    code: row.code,
    category: row.category,
    description: row.description
  };
}

// Lists offense catalog entries with optional text/category filters.
// Connection: violation form offense picker -> /api/offenses.
router.get('/', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const q = optionalText(req.query.q);
    const category = optionalText(req.query.category);

    const clauses = [];
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      clauses.push(`(
        o.code ILIKE $${params.length}
        OR o.description ILIKE $${params.length}
      )`);
    }

    if (category) {
      params.push(category);
      clauses.push(`o.category ILIKE $${params.length}`);
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const result = await query(
      `SELECT o.id, o.code, o.category, o.description
       FROM offenses o
       ${whereClause}
       ORDER BY o.category ASC NULLS LAST, o.code ASC, o.description ASC`,
      params
    );

    res.status(200).json(result.rows.map(toOffenseResponse));
  } catch (error) {
    next(error);
  }
});

// Lists distinct offense categories for frontend filtering controls.
// Connection: violation list filters -> /api/offenses/categories.
router.get('/categories', requireAuth, requireWebsitePower, async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT DISTINCT category
       FROM offenses
       WHERE category IS NOT NULL
         AND trim(category) <> ''
       ORDER BY category ASC`
    );

    res.status(200).json(result.rows.map((row) => row.category));
  } catch (error) {
    next(error);
  }
});

// Fetches one offense by ID for edit/detail screens.
// Connection: offense details/edit UI -> /api/offenses/:offenseId.
router.get('/:offenseId', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const offenseId = parseOffenseId(req.params.offenseId);

    const result = await query(
      `SELECT id, code, category, description
       FROM offenses
       WHERE id = $1
       LIMIT 1`,
      [offenseId]
    );

    if (!result.rows.length) {
      throw notFound('Offense not found');
    }

    res.status(200).json(toOffenseResponse(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

// Creates a new offense dictionary row.
// Connection: offense management UI -> /api/offenses.
router.post('/', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const code = optionalText(req.body?.code);
    const description = optionalText(req.body?.description);
    const category = optionalText(req.body?.category);

    if (!code || !description) {
      throw badRequest('code and description are required');
    }

    const result = await query(
      `INSERT INTO offenses (code, category, description)
       VALUES ($1, $2, $3)
       RETURNING id, code, category, description`,
      [code, category, description]
    );

    res.status(201).json(toOffenseResponse(result.rows[0]));
  } catch (error) {
    if (error?.code === '23505') {
      next(badRequest('Offense code already exists'));
      return;
    }
    next(error);
  }
});

// Updates offense fields used in violation classification.
// Connection: offense management UI -> /api/offenses/:offenseId.
router.patch('/:offenseId', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const offenseId = parseOffenseId(req.params.offenseId);

    const fields = [];
    const params = [];
    let nextCode = null;
    let nextDescription = null;
    let hasCodeUpdate = false;
    let hasDescriptionUpdate = false;

    if (req.body?.code !== undefined) {
      hasCodeUpdate = true;
      nextCode = optionalText(req.body.code);
      params.push(nextCode);
      fields.push(`code = $${params.length}`);
    }

    if (req.body?.category !== undefined) {
      params.push(optionalText(req.body.category));
      fields.push(`category = $${params.length}`);
    }

    if (req.body?.description !== undefined) {
      hasDescriptionUpdate = true;
      nextDescription = optionalText(req.body.description);
      params.push(nextDescription);
      fields.push(`description = $${params.length}`);
    }

    if (!fields.length) {
      throw badRequest('At least one of code, category, description is required');
    }

    if (hasCodeUpdate && !nextCode) {
      throw badRequest('code cannot be empty');
    }

    if (hasDescriptionUpdate && !nextDescription) {
      throw badRequest('description cannot be empty');
    }

    params.push(offenseId);

    const result = await query(
      `UPDATE offenses
       SET ${fields.join(', ')}
       WHERE id = $${params.length}
       RETURNING id, code, category, description`,
      params
    );

    if (!result.rows.length) {
      throw notFound('Offense not found');
    }

    res.status(200).json(toOffenseResponse(result.rows[0]));
  } catch (error) {
    if (error?.code === '23505') {
      next(badRequest('Offense code already exists'));
      return;
    }
    next(error);
  }
});

// Deletes offense entries that are not referenced by violations.
// Connection: offense management UI -> /api/offenses/:offenseId.
router.delete('/:offenseId', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const offenseId = parseOffenseId(req.params.offenseId);

    const result = await query(
      `DELETE FROM offenses
       WHERE id = $1`,
      [offenseId]
    );

    if (!result.rowCount) {
      throw notFound('Offense not found');
    }

    res.status(204).end();
  } catch (error) {
    if (error?.code === '23503') {
      next(badRequest('Offense cannot be deleted while referenced by violations'));
      return;
    }
    next(error);
  }
});

export default router;
