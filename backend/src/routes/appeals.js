import { Router } from 'express';

import { query, getClient } from '../db/client.js';
import { requireAuth, requireWebsitePower } from '../middleware/auth.js';
import { badRequest, notFound } from '../utils/errors.js';

const router = Router();

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Parses UUID values from URL params and request bodies.
// Connection: used by appeal and appeal-message endpoints for id validation.
function parseUuid(value, fieldName) {
  const normalized = String(value ?? '').trim();
  if (!UUID_V4_REGEX.test(normalized)) {
    throw badRequest(`${fieldName} must be a valid UUID`);
  }
  return normalized;
}

// Normalizes optional text fields to null when blank.
// Connection: used by create/message endpoints to keep persisted values clean.
function optionalText(value) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

// Resolves status id by numeric id or canonical status code.
// Connection: called by appeal creation and status update routes.
async function resolveAppealStatusId({ statusId, statusCode }, fallbackCode = 'pending') {
  if (statusId !== undefined && statusId !== null && statusId !== '') {
    const parsed = Number.parseInt(String(statusId).trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw badRequest('statusId must be a positive integer');
    }

    const result = await query(
      `SELECT id
       FROM appeal_statuses
       WHERE id = $1
       LIMIT 1`,
      [parsed]
    );

    if (!result.rows.length) {
      throw notFound('Appeal status not found');
    }

    return parsed;
  }

  const resolvedCode = optionalText(statusCode) || fallbackCode;
  const result = await query(
    `SELECT id
     FROM appeal_statuses
     WHERE LOWER(code) = LOWER($1)
     LIMIT 1`,
    [resolvedCode]
  );

  if (!result.rows.length) {
    throw notFound('Appeal status not found for provided statusCode');
  }

  return result.rows[0].id;
}

// Produces hydrated appeal payloads with student/violation context.
// Connection: shared by list/get/create/update routes.
function appealSelectSql(whereClause, orderClause = '') {
  return `
    SELECT
      a.id,
      a.violation_id,
      a.appeal_text,
      a.status_id,
      aps.code AS status_code,
      aps.label AS status_label,
      a.created_at,
      a.updated_at,
      v.student_id AS student_uuid,
      s.student_id AS student_number,
      s.lrn,
      btrim(s.first_name || ' ' || COALESCE(s.middle_name || ' ', '') || s.last_name) AS student_name,
      sec.grade_level,
      sec.section_name,
      sec.strand,
      o.code AS offense_code,
      o.description AS offense_description
    FROM appeals a
    INNER JOIN appeal_statuses aps ON aps.id = a.status_id
    INNER JOIN violations v ON v.id = a.violation_id
    INNER JOIN students s ON s.id = v.student_id
    LEFT JOIN vw_sections_catalog sec ON sec.id = s.section_id
    LEFT JOIN offenses o ON o.id = v.offense_id
    ${whereClause}
    ${orderClause}
  `;
}

// Fetches one appeal by id with normalized context joins.
// Connection: reused by get/message/status endpoints.
async function getAppealById(appealId) {
  const result = await query(
    appealSelectSql('WHERE a.id = $1', 'LIMIT 1'),
    [appealId]
  );

  return result.rows[0] || null;
}

// Normalizes database row shape to frontend-friendly payload.
// Connection: used by all appeal route responses.
function toAppealResponse(row) {
  return {
    id: row.id,
    violationId: row.violation_id,
    student: {
      id: row.student_uuid,
      studentId: row.student_number,
      lrn: row.lrn,
      name: row.student_name,
      gradeLevel: row.grade_level,
      sectionName: row.section_name,
      strand: row.strand
    },
    offense: {
      code: row.offense_code,
      description: row.offense_description
    },
    appealText: row.appeal_text,
    status: {
      id: row.status_id,
      code: row.status_code,
      label: row.status_label
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Lists appeals with optional status and student filters.
// Connection: appeals dashboard list view -> /api/appeals.
router.get('/', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const clauses = [];
    const params = [];

    if (req.query.studentId) {
      params.push(parseUuid(req.query.studentId, 'studentId'));
      clauses.push(`v.student_id = $${params.length}`);
    }

    if (req.query.violationId) {
      params.push(parseUuid(req.query.violationId, 'violationId'));
      clauses.push(`a.violation_id = $${params.length}`);
    }

    if (req.query.statusCode) {
      params.push(String(req.query.statusCode).trim());
      clauses.push(`LOWER(aps.code) = LOWER($${params.length})`);
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const result = await query(
      appealSelectSql(whereClause, 'ORDER BY a.created_at DESC'),
      params
    );

    res.status(200).json(result.rows.map(toAppealResponse));
  } catch (error) {
    next(error);
  }
});

// Fetches one appeal by UUID.
// Connection: appeal detail page -> /api/appeals/:appealId.
router.get('/:appealId', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const appealId = parseUuid(req.params.appealId, 'appealId');
    const row = await getAppealById(appealId);

    if (!row) {
      throw notFound('Appeal not found');
    }

    res.status(200).json(toAppealResponse(row));
  } catch (error) {
    next(error);
  }
});

// Creates an appeal tied to a violation (student identity is derived from violation).
// Connection: create-appeal form -> /api/appeals.
router.post('/', requireAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const violationId = parseUuid(req.body?.violationId, 'violationId');
    const studentId = req.body?.studentId ? parseUuid(req.body.studentId, 'studentId') : null;
    const appealText = optionalText(req.body?.appealText);

    if (!appealText) {
      throw badRequest('appealText is required');
    }

    // Lock the violation row to avoid races when updating status
    const violationResult = await client.query(
      `SELECT id, student_id, status_id
       FROM violations
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [violationId]
    );

    if (!violationResult.rows.length) {
      throw notFound('Violation not found');
    }

    if (studentId && studentId !== violationResult.rows[0].student_id) {
      throw badRequest('studentId does not match the provided violationId');
    }

    // Resolve appeal status id (use pending by default)
    const appealStatusRes = await client.query(
      `SELECT id FROM appeal_statuses WHERE LOWER(code) = LOWER($1) LIMIT 1`,
      ['pending']
    );
    if (!appealStatusRes.rows.length) {
      throw notFound('Appeal status not found');
    }
    const appealStatusId = appealStatusRes.rows[0].id;

    const insertResult = await client.query(
      `INSERT INTO appeals (
        violation_id,
        appeal_text,
        status_id,
        updated_at
      )
      VALUES ($1, $2, $3, now())
      RETURNING id`,
      [violationId, appealText, appealStatusId]
    );

    // Update violation status to 'appealed' if the lookup exists
    const violationStatusRes = await client.query(
      `SELECT id FROM violation_statuses WHERE LOWER(code) = LOWER($1) LIMIT 1`,
      ['appealed']
    );

    if (violationStatusRes.rows.length) {
      const violationStatusId = violationStatusRes.rows[0].id;
      await client.query(
        `UPDATE violations
         SET status_id = $1, updated_at = now()
         WHERE id = $2`,
        [violationStatusId, violationId]
      );
    }

    await client.query('COMMIT');

    const created = await getAppealById(insertResult.rows[0].id);
    res.status(201).json(toAppealResponse(created));
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (e) {
      // ignore rollback errors
    }
    next(error);
  } finally {
    client.release();
  }
});

// Updates appeal decision status from Guidance/Admin review actions.
// Connection: appeal decision controls -> /api/appeals/:appealId/status.
router.patch('/:appealId/status', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const appealId = parseUuid(req.params.appealId, 'appealId');
    const existing = await getAppealById(appealId);

    if (!existing) {
      throw notFound('Appeal not found');
    }

    const statusId = await resolveAppealStatusId(req.body || {}, null);

    await query(
      `UPDATE appeals
       SET status_id = $1,
           updated_at = now()
       WHERE id = $2`,
      [statusId, appealId]
    );

    const updated = await getAppealById(appealId);
    res.status(200).json(toAppealResponse(updated));
  } catch (error) {
    next(error);
  }
});

// Deletes an appeal by UUID.
// Connection: admin/Guidance delete -> /api/appeals/:appealId.
router.delete('/:appealId', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const appealId = parseUuid(req.params.appealId, 'appealId');
    const existing = await getAppealById(appealId);

    if (!existing) {
      throw notFound('Appeal not found');
    }

    const { rowCount } = await query('DELETE FROM appeals WHERE id = $1', [appealId]);

    if (!rowCount) {
      throw notFound('Appeal not found');
    }

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

// Lists messages in one appeal thread.
// Connection: appeal conversation panel -> /api/appeals/:appealId/messages.
router.get('/:appealId/messages', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const appealId = parseUuid(req.params.appealId, 'appealId');
    const appeal = await getAppealById(appealId);

    if (!appeal) {
      throw notFound('Appeal not found');
    }

    const result = await query(
      `SELECT
        am.id,
        am.appeal_id,
        am.sender_account_id,
        a.full_name AS sender_name,
        a.role AS sender_role,
        am.content,
        am.created_at
       FROM appeal_messages am
       LEFT JOIN accounts a ON a.id = am.sender_account_id
       WHERE am.appeal_id = $1
       ORDER BY am.created_at ASC`,
      [appealId]
    );

    res.status(200).json(
      result.rows.map((row) => ({
        id: row.id,
        appealId: row.appeal_id,
        senderAccountId: row.sender_account_id,
        senderName: row.sender_name,
        senderRole: row.sender_role,
        content: row.content,
        createdAt: row.created_at
      }))
    );
  } catch (error) {
    next(error);
  }
});

// Posts one message to an appeal thread and touches the parent appeal timestamp.
// Connection: appeal conversation send action -> /api/appeals/:appealId/messages.
router.post('/:appealId/messages', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const appealId = parseUuid(req.params.appealId, 'appealId');
    const content = optionalText(req.body?.content);

    if (!content) {
      throw badRequest('content is required');
    }

    const appeal = await getAppealById(appealId);
    if (!appeal) {
      throw notFound('Appeal not found');
    }

    const insertResult = await query(
      `INSERT INTO appeal_messages (appeal_id, sender_account_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, appeal_id, sender_account_id, content, created_at`,
      [appealId, req.user.id, content]
    );

    await query(
      `UPDATE appeals
       SET updated_at = now()
       WHERE id = $1`,
      [appealId]
    );

    const row = insertResult.rows[0];

    res.status(201).json({
      id: row.id,
      appealId: row.appeal_id,
      senderAccountId: row.sender_account_id,
      senderName: req.user.full_name,
      senderRole: req.user.role,
      content: row.content,
      createdAt: row.created_at
    });
  } catch (error) {
    next(error);
  }
});

export default router;
