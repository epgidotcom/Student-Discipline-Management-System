import { Router } from 'express';

import { query, getClient } from '../db/client.js';
import { requireAuth, requireWebsitePower } from '../middleware/auth.js';
import { runAsyncPredictionForViolation } from '../services/predictive.js';
import { buildSanctionDecision, getActionsForOffenseLevel } from '../services/sanctionsEngine.js';
import { archiveViolation } from '../services/archiver.js';
import { badRequest, notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const router = Router();

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Executes inference in background so violation API responses remain low-latency.
// Connection: called after create/update/status changes to keep prediction rows current.
function triggerPredictiveInference(violationRow) {
  setTimeout(async () => {
    try {
      await runAsyncPredictionForViolation(violationRow);
    } catch (error) {
      logger.warn('Predictive inference failed', {
        violationId: violationRow?.id,
        message: error.message
      });
    }
  }, 0);
}

// Normalizes optional text fields before persistence.
// Connection: shared by violation create/update endpoints.
function optionalText(value) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

// Normalizes free-form text to lookup-table code style (for example "In Progress" -> "in_progress").
// Connection: keeps status code queries resilient to label-style payloads from frontend flows.
function normalizeLookupCode(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Creates deterministic lookup codes from free-text values.
// Connection: used when sanctions are passed as labels instead of explicit code.
function slugify(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Converts lookup-style codes to title-case labels for UI-friendly sanction text.
// Connection: sanctions engine action-code projection -> sanctions.label.
function lookupCodeToLabel(value) {
  const normalized = normalizeLookupCode(value);
  if (!normalized) return '';

  return normalized
    .split('_')
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

// Parses pagination values and enforces API limits.
// Connection: used by GET /api/violations list endpoint.
function parsePagination(queryParams) {
  const pageRaw = Number.parseInt(queryParams.page, 10);
  const limitRaw = Number.parseInt(queryParams.limit, 10);

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

// Validates UUID values used for violation and student references.
// Connection: used by POST/GET/PATCH violations routes.
function parseUuid(value, fieldName) {
  const normalized = String(value ?? '').trim();
  if (!UUID_V4_REGEX.test(normalized)) {
    throw badRequest(`${fieldName} must be a valid UUID`);
  }
  return normalized;
}

// Validates positive integer IDs used for offense and lookup references.
// Connection: used by offense/sanction/resolution/status resolution helpers.
function parsePositiveInt(value, fieldName) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

// Parses incident dates accepted by create/update violation endpoints.
// Connection: maps API incidentDate payloads to SQL DATE values.
function parseDate(value, fieldName) {
  const normalized = optionalText(value);
  if (!normalized) {
    throw badRequest(`${fieldName} is required`);
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${fieldName} must be a valid date`);
  }

  return parsed;
}

// Validates JSON evidence payload shape.
// Connection: keeps violations.evidence JSONB data predictable for frontend rendering.
function parseEvidence(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'object') return value;
  throw badRequest('evidence must be an object, array, or null');
}

// Resolves offense IDs from explicit id, code, or description.
// Connection: violation creation workflow can submit either picker id or legacy offense text.
async function resolveOffenseId(payload) {
  if (payload.offenseId !== undefined && payload.offenseId !== null && payload.offenseId !== '') {
    const offenseId = parsePositiveInt(payload.offenseId, 'offenseId');
    const result = await query(
      `SELECT id
       FROM offenses
       WHERE id = $1
       LIMIT 1`,
      [offenseId]
    );

    if (!result.rows.length) {
      throw notFound('Offense not found');
    }

    return offenseId;
  }

  const offenseCode = optionalText(payload.offenseCode);
  if (offenseCode) {
    const result = await query(
      `SELECT id
       FROM offenses
       WHERE LOWER(code) = LOWER($1)
       LIMIT 1`,
      [offenseCode]
    );

    if (!result.rows.length) {
      throw notFound('Offense not found for provided offenseCode');
    }

    return result.rows[0].id;
  }

  const offenseDescription = optionalText(payload.offenseDescription);
  if (offenseDescription) {
    const result = await query(
      `SELECT id
       FROM offenses
       WHERE LOWER(description) = LOWER($1)
       LIMIT 1`,
      [offenseDescription]
    );

    if (!result.rows.length) {
      throw notFound('Offense not found for provided offenseDescription');
    }

    return result.rows[0].id;
  }

  throw badRequest('Provide offenseId, offenseCode, or offenseDescription');
}

// Resolves normalized violation status IDs from API inputs.
// Connection: create/status-update endpoints persist violations.status_id.
async function resolveStatusId(payload, fallbackCode = 'pending') {
  const statusIdRaw = payload.statusId;
  if (statusIdRaw !== undefined && statusIdRaw !== null && statusIdRaw !== '') {
    const statusId = parsePositiveInt(statusIdRaw, 'statusId');
    const result = await query(
      `SELECT id
       FROM violation_statuses
       WHERE id = $1
       LIMIT 1`,
      [statusId]
    );

    if (!result.rows.length) {
      throw notFound('Violation status not found');
    }

    return statusId;
  }

  const statusCode = normalizeLookupCode(optionalText(payload.statusCode) || fallbackCode);
  if (!statusCode) {
    throw badRequest('Provide statusId or statusCode');
  }

  const result = await query(
    `SELECT id
     FROM violation_statuses
     WHERE LOWER(code) = LOWER($1)
     LIMIT 1`,
    [statusCode]
  );

  if (!result.rows.length) {
    throw notFound('Violation status not found for provided statusCode');
  }

  return result.rows[0].id;
}

// Resolves normalized resolution type IDs from API inputs.
// Connection: create/update endpoints persist violations.resolution_id.
async function resolveResolutionId(payload) {
  if (payload.resolutionId !== undefined && payload.resolutionId !== null && payload.resolutionId !== '') {
    const resolutionId = parsePositiveInt(payload.resolutionId, 'resolutionId');
    const result = await query(
      `SELECT id
       FROM resolution_types
       WHERE id = $1
       LIMIT 1`,
      [resolutionId]
    );

    if (!result.rows.length) {
      throw notFound('Resolution type not found');
    }

    return resolutionId;
  }

  const resolutionCode = optionalText(payload.resolutionCode);
  if (!resolutionCode) {
    return null;
  }

  const result = await query(
    `SELECT id
     FROM resolution_types
     WHERE LOWER(code) = LOWER($1)
     LIMIT 1`,
    [resolutionCode]
  );

  if (!result.rows.length) {
    throw notFound('Resolution type not found for provided resolutionCode');
  }

  return result.rows[0].id;
}

// Resolves sanctions by id/code and optionally upserts free-text sanctions.
// Connection: create/update endpoints persist violations.sanction_id.
async function resolveSanctionId(payload) {
  if (payload.sanctionId !== undefined && payload.sanctionId !== null && payload.sanctionId !== '') {
    const sanctionId = parsePositiveInt(payload.sanctionId, 'sanctionId');
    const result = await query(
      `SELECT id
       FROM sanctions
       WHERE id = $1
       LIMIT 1`,
      [sanctionId]
    );

    if (!result.rows.length) {
      throw notFound('Sanction not found');
    }

    return sanctionId;
  }

  const sanctionCode = optionalText(payload.sanctionCode);
  if (sanctionCode) {
    const result = await query(
      `SELECT id
       FROM sanctions
       WHERE LOWER(code) = LOWER($1)
       LIMIT 1`,
      [sanctionCode]
    );

    if (!result.rows.length) {
      throw notFound('Sanction not found for provided sanctionCode');
    }

    return result.rows[0].id;
  }

  const sanctionLabel = optionalText(payload.sanctionLabel);
  if (!sanctionLabel) {
    return null;
  }

  const code = slugify(sanctionLabel);
  if (!code) {
    throw badRequest('sanctionLabel cannot be empty');
  }

  const upsert = await query(
    `INSERT INTO sanctions (code, label, description)
     VALUES ($1, $2, $2)
     ON CONFLICT (code)
     DO UPDATE SET
       label = EXCLUDED.label,
       updated_at = now()
     RETURNING id`,
    [code, sanctionLabel]
  );

  return upsert.rows[0].id;
}

function toSanctionResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    description: row.description,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isSanctionsSchemaError(error) {
  const code = String(error?.code || '').trim();
  return code === '42P01' || code === '42703' || code === '42704';
}

// Builds a deterministic sanction row projection from sanctions-engine action codes.
// Connection: ensures violations.sanction_id can be mapped from sanctionDecision actions.
function buildEngineSanctionProjection(sanctionDecision) {
  const actions = Array.isArray(sanctionDecision?.actions) ? sanctionDecision.actions : [];

  const normalizedCodes = actions
    .map((entry) => normalizeLookupCode(entry?.code))
    .filter(Boolean);

  if (!normalizedCodes.length) {
    return null;
  }

  const code = `engine_${normalizedCodes.join('__')}`;
  const label = normalizedCodes
    .map((entry) => lookupCodeToLabel(entry))
    .join(' + ');

  const descriptionItems = actions
    .map((entry) => {
      const actionCode = optionalText(entry?.code);
      const actionDescription = optionalText(entry?.description);
      if (!actionCode && !actionDescription) return null;
      if (!actionDescription) return actionCode;
      return `${actionCode}: ${actionDescription}`;
    })
    .filter(Boolean);

  return {
    code,
    label,
    description: descriptionItems.length
      ? `Auto-generated by sanctions engine. ${descriptionItems.join('; ')}`
      : 'Auto-generated by sanctions engine.'
  };
}

async function findSanctionByCode(code) {
  const normalizedCode = optionalText(code);
  if (!normalizedCode) return null;

  const result = await query(
    `SELECT id, code, label, description, active, created_at, updated_at
     FROM sanctions
     WHERE LOWER(code) = LOWER($1)
     LIMIT 1`,
    [normalizedCode]
  );

  return result.rows[0] || null;
}

async function upsertEngineSanctionFromDecision(sanctionDecision) {
  const projection = buildEngineSanctionProjection(sanctionDecision);
  if (!projection) {
    return null;
  }

  const result = await query(
    `INSERT INTO sanctions (code, label, description, active, updated_at)
     VALUES ($1, $2, $3, TRUE, now())
     ON CONFLICT (code)
     DO UPDATE SET
       label = EXCLUDED.label,
       description = EXCLUDED.description,
       active = TRUE,
       updated_at = now()
     RETURNING id, code, label, description, active, created_at, updated_at`,
    [projection.code, projection.label, projection.description]
  );

  return toSanctionResponse(result.rows[0]);
}

// Recomputes repeat-count using active prior incidents for the same student/offense pair.
// Connection: called during violation creation and offense reassignment updates.
async function calculateRepeatCount(studentId, offenseId, excludingViolationId = null) {
  const params = [studentId, offenseId];
  let exclusionSql = '';

  if (excludingViolationId) {
    params.push(excludingViolationId);
    exclusionSql = `AND id <> $${params.length}`;
  }

  const result = await query(
    `SELECT COUNT(*)::int AS total
     FROM violations
     WHERE student_id = $1
       AND offense_id = $2
       AND active = TRUE
       ${exclusionSql}`,
    params
  );

  return Number(result.rows[0]?.total || 0) + 1;
}

// Converts DB rows into a frontend-friendly violation payload.
// Connection: shared by all violations read/write responses.
function toViolationResponse(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    studentLrn: row.student_lrn,
    gradeLevel: row.grade_level,
    sectionName: row.section_name,
    strand: row.strand,
    gradeSection: row.grade_section,
    offenseId: row.offense_id,
    violationDefinitionId: row.violation_definition_id,
    offenseCode: row.offense_code,
    offenseCategory: row.offense_category,
    offenseDescription: row.offense_description,
    incidentDate: row.incident_date,
    incidentNotes: row.incident_notes,
    sanctionId: row.sanction_id,
    sanctionCode: row.sanction_code,
    sanctionLabel: row.sanction_label,
    statusId: row.status_id,
    statusCode: row.status_code,
    statusLabel: row.status_label,
    resolutionId: row.resolution_id,
    resolutionCode: row.resolution_code,
    resolutionLabel: row.resolution_label,
    repeatCountAtInsert: row.repeat_count_at_insert,
    remarks: row.remarks,
    evidence: row.evidence,
    severity: row.severity,
    violationType: row.violation_type,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Central select statement for violations list/detail routes.
// Connection: used by GET /api/violations and GET /api/violations/:violationId.
function violationSelectSql(whereClause, orderClause = '') {
  return `
    SELECT
      v.id,
      v.student_id,
      s.active AS student_active,
      s.lrn AS student_lrn,
      btrim(s.first_name || ' ' || COALESCE(s.middle_name || ' ', '') || s.last_name) AS student_name,
      sec.grade_level,
      sec.section_name,
      sec.strand,
      CASE
        WHEN sec.grade_level IS NOT NULL AND sec.section_name IS NOT NULL THEN sec.grade_level::text || '-' || sec.section_name
        WHEN sec.grade_level IS NOT NULL THEN sec.grade_level::text
        WHEN sec.section_name IS NOT NULL THEN sec.section_name
        ELSE NULL
      END AS grade_section,
      v.offense_id,
      v.violation_definition_id,
      o.code AS offense_code,
      o.category AS offense_category,
      o.description AS offense_description,
      v.incident_date,
      v.incident_notes,
      v.sanction_id,
      sc.code AS sanction_code,
      sc.label AS sanction_label,
      v.severity,
      v.violation_type,
      v.status_id,
      vs.code AS status_code,
      vs.label AS status_label,
      v.resolution_id,
      rt.code AS resolution_code,
      rt.label AS resolution_label,
      v.repeat_count_at_insert,
      v.remarks,
      v.evidence,
      v.active,
      v.created_at,
      v.updated_at
    FROM violations v
    INNER JOIN students s ON s.id = v.student_id
    LEFT JOIN vw_sections_catalog sec ON sec.id = s.section_id
    INNER JOIN offenses o ON o.id = v.offense_id
    INNER JOIN violation_statuses vs ON vs.id = v.status_id
    LEFT JOIN sanctions sc ON sc.id = v.sanction_id
    LEFT JOIN resolution_types rt ON rt.id = v.resolution_id
    ${whereClause}
    ${orderClause}
  `;
}

// Loads one violation by id for detail/edit/status endpoints.
// Connection: reused by get, create response shaping, and patch endpoints.
async function getViolationById(violationId) {
  const result = await query(
    violationSelectSql('WHERE v.id = $1', 'LIMIT 1'),
    [violationId]
  );

  return result.rows[0] || null;
}

// Lists normalized violation statuses used by filter/status-action controls.
// Connection: frontend violations page -> /api/violations/statuses.
router.get('/statuses', requireAuth, requireWebsitePower, async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT id, code, label
       FROM violation_statuses
       ORDER BY id ASC, label ASC`
    );

    res.status(200).json(
      result.rows.map((row) => ({
        id: row.id,
        code: row.code,
        label: row.label
      }))
    );
  } catch (error) {
    next(error);
  }
});

// Lists violation incidents with optional filtering and pagination.
// Connection: discipline incident list UI -> /api/violations.
router.get('/', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const queryParams = req.query || {};
    const { page, limit, offset } = parsePagination(queryParams);

    const clauses = [];
    const params = [];

    if (queryParams.studentId) {
      params.push(parseUuid(queryParams.studentId, 'studentId'));
      clauses.push(`v.student_id = $${params.length}`);
    }

    if (queryParams.offenseId) {
      params.push(parsePositiveInt(queryParams.offenseId, 'offenseId'));
      clauses.push(`v.offense_id = $${params.length}`);
    }

    if (queryParams.statusCode) {
      const statusCode = normalizeLookupCode(queryParams.statusCode);
      if (!statusCode) {
        throw badRequest('statusCode must not be empty');
      }
      params.push(statusCode);
      clauses.push(`LOWER(vs.code) = LOWER($${params.length})`);
    }

    if (queryParams.gradeLevel) {
      params.push(parsePositiveInt(queryParams.gradeLevel, 'gradeLevel'));
      clauses.push(`sec.grade_level = $${params.length}`);
    }

    const sectionName = optionalText(queryParams.sectionName);
    if (sectionName) {
      params.push(sectionName);
      clauses.push(`sec.section_name ILIKE $${params.length}`);
    }

    const strand = optionalText(queryParams.strand);
    if (strand) {
      params.push(strand);
      clauses.push(`sec.strand ILIKE $${params.length}`);
    }

    if (queryParams.active !== undefined) {
      const activeNormalized = String(queryParams.active).trim().toLowerCase();
      if (!['true', 'false', '1', '0', 'yes', 'no'].includes(activeNormalized)) {
        throw badRequest('active must be a boolean-like value');
      }
      const active = ['true', '1', 'yes'].includes(activeNormalized);
      params.push(active);
      clauses.push(`v.active = $${params.length}`);
    }

    if (queryParams.fromDate) {
      params.push(parseDate(queryParams.fromDate, 'fromDate'));
      clauses.push(`v.incident_date >= $${params.length}`);
    }

    if (queryParams.toDate) {
      params.push(parseDate(queryParams.toDate, 'toDate'));
      clauses.push(`v.incident_date <= $${params.length}`);
    }

    const q = optionalText(queryParams.q);
    if (q) {
      params.push(`%${q}%`);
      clauses.push(`(
        btrim(s.first_name || ' ' || COALESCE(s.middle_name || ' ', '') || s.last_name) ILIKE $${params.length}
        OR o.code ILIKE $${params.length}
        OR COALESCE(o.category, '') ILIKE $${params.length}
        OR o.description ILIKE $${params.length}
        OR COALESCE(sec.strand, '') ILIKE $${params.length}
        OR COALESCE(sec.section_name, '') ILIKE $${params.length}
        OR COALESCE(v.incident_notes, '') ILIKE $${params.length}
      )`);
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const listParams = [...params, limit, offset];

    const listResult = await query(
      violationSelectSql(
        whereClause,
        `ORDER BY v.incident_date DESC, v.created_at DESC
         LIMIT $${params.length + 1}
         OFFSET $${params.length + 2}`
      ),
      listParams
    );

    const countResult = await query(
      `SELECT COUNT(*)::int AS total
       FROM violations v
       INNER JOIN students s ON s.id = v.student_id
        LEFT JOIN vw_sections_catalog sec ON sec.id = s.section_id
       INNER JOIN offenses o ON o.id = v.offense_id
       INNER JOIN violation_statuses vs ON vs.id = v.status_id
       ${whereClause}`,
      params
    );

    const total = Number(countResult.rows[0]?.total || 0);

    res.status(200).json({
      data: listResult.rows.map(toViolationResponse),
      currentPage: page,
      limit,
      totalItems: total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    });
  } catch (error) {
    next(error);
  }
});

// Computes sanctions-engine output without creating a violation record.
// Connection: violations form uses this to preview mapped sanctions per student+violation.
router.post('/sanctions-preview', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const payload = req.body || {};
    const studentId = parseUuid(payload.studentId, 'studentId');

    const studentExists = await query(
      `SELECT id
       FROM students
       WHERE id = $1
       LIMIT 1`,
      [studentId]
    );

    if (!studentExists.rows.length) {
      throw notFound('Student not found');
    }

    const sanctionDecision = await buildSanctionDecision({
      studentId,
      payload
    });

    const projection = buildEngineSanctionProjection(sanctionDecision);
    let suggestedSanction = null;

    if (projection) {
      const existing = await findSanctionByCode(projection.code);

      if (existing) {
        suggestedSanction = {
          ...toSanctionResponse(existing),
          exists: true
        };
      } else {
        suggestedSanction = {
          id: null,
          code: projection.code,
          label: projection.label,
          description: projection.description,
          active: true,
          exists: false
        };
      }
    }

    // Provide actions/projections for each offense level (1..maxOffenseLevel)
    const actionsByLevel = [];
    const maxLevel = Number.parseInt(String(sanctionDecision?.maxOffenseLevel || 3), 10) || 3;
    for (let level = 1; level <= maxLevel; level += 1) {
      try {
        const levelResult = await getActionsForOffenseLevel(sanctionDecision.violationDefinitionId, level);
        const levelProjection = buildEngineSanctionProjection({ actions: levelResult.actions });
        const existing = levelProjection ? await findSanctionByCode(levelProjection.code) : null;

        actionsByLevel.push({
          level,
          ruleId: levelResult.ruleId,
          actions: levelResult.actions,
          projection: levelProjection,
          existing: existing ? toSanctionResponse(existing) : null
        });
      } catch (err) {
        // Non-fatal: include an empty entry so frontend still shows level placeholders
        actionsByLevel.push({ level, ruleId: null, actions: [], projection: null, existing: null });
      }
    }

    res.status(200).json({
      sanctionDecision,
      suggestedSanction,
      actionsByLevel
    });
  } catch (error) {
    if (isSanctionsSchemaError(error)) {
      next(badRequest('Sanctions engine schema is not ready. Run backend migrations first.'));
      return;
    }
    next(error);
  }
});

// Logs a violation using rule-based sanctions and dynamic offense-level action resolution.
// Connection: sanctions engine endpoint -> /api/violations/log.
router.post('/log', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const payload = req.body || {};

    const hasExplicitOffenseReference =
      payload.offenseId !== undefined
      || payload.offenseCode !== undefined
      || payload.offenseDescription !== undefined;

    const studentId = parseUuid(payload.studentId, 'studentId');
    const incidentDate = parseDate(payload.incidentDate, 'incidentDate');
    const incidentNotes = optionalText(payload.incidentNotes);
    const selectedOffenseId = hasExplicitOffenseReference ? await resolveOffenseId(payload) : null;

    if (!incidentNotes) {
      throw badRequest('incidentNotes is required');
    }

    const studentExists = await query(
      `SELECT id
       FROM students
       WHERE id = $1
       LIMIT 1`,
      [studentId]
    );

    if (!studentExists.rows.length) {
      throw notFound('Student not found');
    }

    const statusId = await resolveStatusId(payload, 'pending');
    const requestedSanctionId = await resolveSanctionId(payload);
    const resolutionId = await resolveResolutionId(payload);
    const evidence = parseEvidence(payload.evidence);
    const remarks = optionalText(payload.remarks);

    const sanctionDecision = await buildSanctionDecision({
      studentId,
      payload
    });

    let resolvedSanctionId = requestedSanctionId;
    let suggestedSanction = null;

    if (!resolvedSanctionId) {
      suggestedSanction = await upsertEngineSanctionFromDecision(sanctionDecision);
      resolvedSanctionId = suggestedSanction?.id || null;
    }

    const insertResult = await query(
      `INSERT INTO violations (
        student_id,
        offense_id,
        violation_definition_id,
        incident_date,
        incident_notes,
        sanction_id,
        status_id,
        resolution_id,
        evidence,
        severity,
        violation_type,
        repeat_count_at_insert,
        remarks,
        active,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE, now())
      RETURNING id`,
      [
        studentId,
        selectedOffenseId || sanctionDecision.offenseId,
        sanctionDecision.violationDefinitionId,
        incidentDate,
        incidentNotes,
        resolvedSanctionId,
        statusId,
        resolutionId,
        evidence === undefined ? null : evidence,
        sanctionDecision.severity,
        sanctionDecision.violationType || null,
        sanctionDecision.offenseLevel,
        remarks
      ]
    );

    const createdViolationId = insertResult.rows[0].id;

    await query(
      `INSERT INTO violation_logs (
        student_id,
        violation_id,
        violation_record_id,
        offense_level,
        logged_at,
        actions
      )
      VALUES ($1, $2, $3, $4, $5, $6::text[])`,
      [
        studentId,
        sanctionDecision.violationDefinitionId,
        createdViolationId,
        sanctionDecision.offenseLevel,
        incidentDate,
        sanctionDecision.actions.map((entry) => entry.code)
      ]
    );

    const created = await getViolationById(createdViolationId);
    triggerPredictiveInference(created);

    res.status(201).json({
      violation: toViolationResponse(created),
      sanctionDecision,
      suggestedSanction
    });
  } catch (error) {
    if (isSanctionsSchemaError(error)) {
      next(badRequest('Sanctions engine schema is not ready. Run backend migrations first.'));
      return;
    }
    next(error);
  }
});

// Fetches one violation record by UUID.
// Connection: incident detail/edit screen -> /api/violations/:violationId.
router.get('/:violationId', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const violationId = parseUuid(req.params.violationId, 'violationId');
    const violation = await getViolationById(violationId);

    if (!violation) {
      throw notFound('Violation not found');
    }

    res.status(200).json(toViolationResponse(violation));
  } catch (error) {
    next(error);
  }
});

// Creates a new normalized violation incident record.
// Connection: create-violation form -> /api/violations.
router.post('/', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const payload = req.body || {};

    const studentId = parseUuid(payload.studentId, 'studentId');
    const offenseId = await resolveOffenseId(payload);
    const incidentDate = parseDate(payload.incidentDate, 'incidentDate');
    const incidentNotes = optionalText(payload.incidentNotes);

    if (!incidentNotes) {
      throw badRequest('incidentNotes is required');
    }

    const statusId = await resolveStatusId(payload, 'pending');
    const sanctionId = await resolveSanctionId(payload);
    const resolutionId = await resolveResolutionId(payload);
    const evidence = parseEvidence(payload.evidence);
    const remarks = optionalText(payload.remarks);

    const studentExists = await query(
      `SELECT id
       FROM students
       WHERE id = $1
       LIMIT 1`,
      [studentId]
    );

    if (!studentExists.rows.length) {
      throw notFound('Student not found');
    }

    const repeatCount = await calculateRepeatCount(studentId, offenseId);
    const definitionLookup = await query(
      `SELECT id, severity, violation_type
       FROM violation_definitions
       WHERE offense_id = $1
       LIMIT 1`,
      [offenseId]
    );
    const violationDefinitionId = definitionLookup.rows[0]?.id || null;
    const violationSeverity = definitionLookup.rows[0]?.severity || null;
    const violationType = definitionLookup.rows[0]?.violation_type || null;

    const insertResult = await query(
      `INSERT INTO violations (
        student_id,
        offense_id,
        violation_definition_id,
        incident_date,
        incident_notes,
        sanction_id,
        status_id,
        resolution_id,
        evidence,
        severity,
        violation_type,
        repeat_count_at_insert,
        remarks,
        active,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, now())
      RETURNING id`,
      [
        studentId,
        offenseId,
        violationDefinitionId,
        incidentDate,
        incidentNotes,
        sanctionId,
        statusId,
        resolutionId,
        evidence === undefined ? null : evidence,
        violationSeverity,
        violationType,
        repeatCount,
        remarks
      ]
    );

    const created = await getViolationById(insertResult.rows[0].id);
    triggerPredictiveInference(created);
    res.status(201).json(toViolationResponse(created));
  } catch (error) {
    next(error);
  }
});

// Updates only status-related fields for the violation workflow timeline.
// Connection: status action controls -> /api/violations/:violationId/status.
router.patch('/:violationId/status', requireAuth, requireWebsitePower, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const violationId = parseUuid(req.params.violationId, 'violationId');
    const existingRes = await client.query(
      `SELECT id, student_id, status_id
       FROM violations
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [violationId]
    );

    if (!existingRes.rows.length) {
      throw notFound('Violation not found');
    }

    const statusId = await resolveStatusId(req.body || {}, null);

    await client.query(
      `UPDATE violations
       SET status_id = $1,
           updated_at = now()
       WHERE id = $2`,
      [statusId, violationId]
    );

    // If status is 'appealed', ensure an appeals row exists for this violation.
    const vsRes = await client.query(
      `SELECT code FROM violation_statuses WHERE id = $1 LIMIT 1`,
      [statusId]
    );

    if (vsRes.rows.length && String(vsRes.rows[0].code || '').trim().toLowerCase() === 'appealed') {
      const existingAppeal = await client.query(
        `SELECT id FROM appeals WHERE violation_id = $1 LIMIT 1`,
        [violationId]
      );

      if (!existingAppeal.rows.length) {
        const appealStatusRes = await client.query(
          `SELECT id FROM appeal_statuses WHERE LOWER(code) = LOWER($1) LIMIT 1`,
          ['pending']
        );
        const appealStatusId = appealStatusRes.rows[0]?.id || null;

        await client.query(
          `INSERT INTO appeals (violation_id, appeal_text, status_id, updated_at)
           VALUES ($1, $2, $3, now())`,
          [violationId, 'Appeal created via status change', appealStatusId]
        );
      }
    }

    await client.query('COMMIT');

    const updated = await getViolationById(violationId);
    triggerPredictiveInference(updated);
    res.status(200).json(toViolationResponse(updated));
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

// Updates mutable violation fields while preserving normalized references.
// Connection: edit-violation form -> /api/violations/:violationId.
router.patch('/:violationId', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const violationId = parseUuid(req.params.violationId, 'violationId');
    const payload = req.body || {};

    const existing = await query(
      `SELECT id, student_id, offense_id
       FROM violations
       WHERE id = $1
       LIMIT 1`,
      [violationId]
    );

    if (!existing.rows.length) {
      throw notFound('Violation not found');
    }

    const current = existing.rows[0];

    const fields = [];
    const params = [];

    let offenseIdForRepeat = current.offense_id;
    let violationDefinitionIdForUpdate = null;

    if (payload.offenseId !== undefined || payload.offenseCode !== undefined || payload.offenseDescription !== undefined) {
      offenseIdForRepeat = await resolveOffenseId(payload);
      params.push(offenseIdForRepeat);
      fields.push(`offense_id = $${params.length}`);

      const definitionLookup = await query(
        `SELECT id, severity, violation_type
         FROM violation_definitions
         WHERE offense_id = $1
         LIMIT 1`,
        [offenseIdForRepeat]
      );

      violationDefinitionIdForUpdate = definitionLookup.rows[0]?.id || null;
      const violationSeverityForUpdate = definitionLookup.rows[0]?.severity || null;
      const violationTypeForUpdate = definitionLookup.rows[0]?.violation_type || null;

      params.push(violationDefinitionIdForUpdate);
      fields.push(`violation_definition_id = $${params.length}`);

      params.push(violationSeverityForUpdate);
      fields.push(`severity = $${params.length}`);

      params.push(violationTypeForUpdate);
      fields.push(`violation_type = $${params.length}`);
    }

    if (payload.incidentDate !== undefined) {
      params.push(parseDate(payload.incidentDate, 'incidentDate'));
      fields.push(`incident_date = $${params.length}`);
    }

    if (payload.incidentNotes !== undefined) {
      const incidentNotes = optionalText(payload.incidentNotes);
      if (!incidentNotes) {
        throw badRequest('incidentNotes cannot be empty');
      }
      params.push(incidentNotes);
      fields.push(`incident_notes = $${params.length}`);
    }

    if (payload.remarks !== undefined) {
      params.push(optionalText(payload.remarks));
      fields.push(`remarks = $${params.length}`);
    }

    if (payload.evidence !== undefined) {
      params.push(parseEvidence(payload.evidence));
      fields.push(`evidence = $${params.length}`);
    }

    if (payload.sanctionId !== undefined || payload.sanctionCode !== undefined || payload.sanctionLabel !== undefined) {
      params.push(await resolveSanctionId(payload));
      fields.push(`sanction_id = $${params.length}`);
    }

    if (payload.resolutionId !== undefined || payload.resolutionCode !== undefined) {
      params.push(await resolveResolutionId(payload));
      fields.push(`resolution_id = $${params.length}`);
    }

    if (payload.statusId !== undefined || payload.statusCode !== undefined) {
      params.push(await resolveStatusId(payload, null));
      fields.push(`status_id = $${params.length}`);
    }

    if (payload.active !== undefined) {
      const activeNormalized = String(payload.active).trim().toLowerCase();
      if (!['true', 'false', '1', '0', 'yes', 'no'].includes(activeNormalized)) {
        throw badRequest('active must be a boolean-like value');
      }
      params.push(['true', '1', 'yes'].includes(activeNormalized));
      fields.push(`active = $${params.length}`);
    }

    if (offenseIdForRepeat !== current.offense_id) {
      const recomputedRepeat = await calculateRepeatCount(current.student_id, offenseIdForRepeat, violationId);
      params.push(recomputedRepeat);
      fields.push(`repeat_count_at_insert = $${params.length}`);
    }

    if (!fields.length) {
      throw badRequest('No valid violation fields provided for update');
    }

    fields.push('updated_at = now()');

    params.push(violationId);

    await query(
      `UPDATE violations
       SET ${fields.join(', ')}
       WHERE id = $${params.length}`,
      params
    );

    const updated = await getViolationById(violationId);
    triggerPredictiveInference(updated);
    res.status(200).json(toViolationResponse(updated));
  } catch (error) {
    next(error);
  }
});

// Deletes one violation record.
// Connection: row-level delete actions in violations list UI.
router.delete('/:violationId', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const violationId = parseUuid(req.params.violationId, 'violationId');

    // Acquire a pooled client and perform archive+delete in a single transaction.
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Fetch and lock the violation row inside the transaction.
      const selectSql = violationSelectSql('WHERE v.id = $1 FOR UPDATE OF v', '');
      const selectRes = await client.query(selectSql, [violationId]);
      const row = selectRes.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        throw notFound('Violation not found');
      }

      const normalized = toViolationResponse(row);

      // Insert archival snapshot (the service will also gather related logs).
      await archiveViolation(client, normalized, { deletedBy: req.user?.id });

      // Delete the active violation row.
      const delRes = await client.query(
        `DELETE FROM violations
         WHERE id = $1`,
        [violationId]
      );

      if (!delRes.rowCount) {
        await client.query('ROLLBACK');
        throw notFound('Violation not found');
      }

      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        logger.error('Rollback failed during violation archive', { message: rbErr.message });
      }
      throw err;
    } finally {
      client.release();
    }

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
