import { Router } from 'express';

import { query } from '../db/client.js';
import { requireAuth, requireWebsitePower } from '../middleware/auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { resolveSectionId as resolveAcademicSectionId } from '../services/sectionCatalog.js';

const router = Router();

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BATCH_ROWS = 1000;

// Normalizes optional string input fields before persistence.
// Connection: used by POST/PATCH students endpoints to keep DB values consistent.
function optionalText(value) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

// Parses pagination values and applies API safety bounds.
// Connection: used by GET /api/students list endpoint.
function parsePagination(queryParams) {
  const pageRaw = Number.parseInt(queryParams.page, 10);
  const limitRaw = Number.parseInt(queryParams.limit, 10);

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

// Converts mixed input into a strict boolean filter when provided.
// Connection: used by GET /api/students active query filtering.
function parseBooleanOrNull(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return null;
}

// Parses date input used by student birthdate fields.
// Connection: used by POST/PATCH students endpoints.
function parseDateOrNull(value, fieldName) {
  const normalized = optionalText(value);
  if (!normalized) return null;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${fieldName} must be a valid date`);
  }

  return parsed;
}

// Resolves first/middle/last names while supporting legacy fullName payloads.
// Connection: used by POST/PATCH students endpoints to preserve old frontend workflow.
function resolveStudentName(payload) {
  const firstName = optionalText(payload.firstName);
  const middleName = optionalText(payload.middleName);
  const lastName = optionalText(payload.lastName);

  if (firstName && lastName) {
    return { firstName, middleName, lastName };
  }

  const fullName = optionalText(payload.fullName);
  if (!fullName) {
    throw badRequest('Provide either firstName and lastName, or fullName');
  }

  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    throw badRequest('fullName must include at least first and last name');
  }

  return {
    firstName: parts[0],
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : null,
    lastName: parts[parts.length - 1]
  };
}

// Builds reusable SQL fragments for student list filtering.
// Connection: used by GET /api/students list and total-count queries.
function buildStudentFilters(queryParams) {
  const clauses = [];
  const params = [];

  const q = optionalText(queryParams.q);
  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(
      btrim(s.first_name || ' ' || COALESCE(s.middle_name || ' ', '') || s.last_name) ILIKE $${params.length}
      OR s.lrn ILIKE $${params.length}
      OR s.student_id::text ILIKE $${params.length}
    )`);
  }

  const gradeLevelRaw = optionalText(queryParams.gradeLevel);
  if (gradeLevelRaw) {
    const gradeLevel = Number.parseInt(gradeLevelRaw, 10);
    if (!Number.isFinite(gradeLevel) || gradeLevel <= 0) {
      throw badRequest('gradeLevel must be a positive integer');
    }
    params.push(gradeLevel);
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

  const active = parseBooleanOrNull(queryParams.active);
  if (active !== null) {
    params.push(active);
    clauses.push(`s.active = $${params.length}`);
  }

  return {
    whereClause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

// Picks the first defined value from a payload key list.
// Connection: used by batch upload row normalization across snake/camel aliases.
function pickFirstDefined(payload, keys) {
  for (const key of keys) {
    if (payload[key] !== undefined) {
      return payload[key];
    }
  }
  return undefined;
}

// Normalizes one batch row so legacy CSV-parsed keys map to the same student contract.
// Connection: used by POST /api/students/batch before validation and insertion.
function normalizeBatchRowPayload(rawRow) {
  const row = rawRow && typeof rawRow === 'object' ? rawRow : {};

  const rowNumberRaw = pickFirstDefined(row, ['rowNumber', 'row', '_row']);
  const rowNumberParsed = Number.parseInt(String(rowNumberRaw ?? ''), 10);

  return {
    rowNumber: Number.isFinite(rowNumberParsed) && rowNumberParsed > 0 ? rowNumberParsed : null,
    lrn: pickFirstDefined(row, ['lrn', 'LRN']),
    firstName: pickFirstDefined(row, ['firstName', 'first_name']),
    middleName: pickFirstDefined(row, ['middleName', 'middle_name']),
    lastName: pickFirstDefined(row, ['lastName', 'last_name']),
    fullName: pickFirstDefined(row, ['fullName', 'full_name', 'fullname']),
    birthdate: pickFirstDefined(row, ['birthdate', 'dateofbirth', 'dob']),
    gradeLevel: pickFirstDefined(row, ['gradeLevel', 'grade_level', 'grade']),
    sectionName: pickFirstDefined(row, ['sectionName', 'section_name', 'section']),
    strand: pickFirstDefined(row, ['strand', 'track', 'program', 'program_code', 'program_name', 'academicGroup', 'academic_group', 'special_program']),
    parentContact: pickFirstDefined(row, ['parentContact', 'parent_contact', 'phone']),
    sectionId: pickFirstDefined(row, ['sectionId', 'section_id'])
  };
}

// Converts DB row fields into API-safe camelCase payloads.
// Connection: used by all students read/write endpoint responses.
function toStudentResponse(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    lrn: row.lrn,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    fullName: row.full_name,
    birthdate: row.birthdate,
    parentContact: row.parent_contact,
    sectionId: row.section_id,
    gradeLevel: row.grade_level,
    sectionName: row.section_name,
    strand: row.strand,
    programCode: row.program_code,
    programName: row.program_name,
    programType: row.program_type,
    adviser: row.adviser,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Loads one student by UUID or identity number to support legacy URL patterns.
// Connection: used by GET/PATCH student-by-id endpoints.
async function getStudentByRef(studentRef) {
  const normalized = String(studentRef ?? '').trim();
  if (!normalized) {
    throw badRequest('student reference is required');
  }

  let lookupSql = '';
  let lookupParam = null;

  if (UUID_V4_REGEX.test(normalized)) {
    lookupSql = 's.id = $1';
    lookupParam = normalized;
  } else if (/^\d+$/.test(normalized)) {
    lookupSql = 's.student_id = $1';
    lookupParam = Number.parseInt(normalized, 10);
  } else {
    throw badRequest('student reference must be UUID or numeric studentId');
  }

  const result = await query(
    `SELECT
      s.id,
      s.student_id,
      s.lrn,
      s.first_name,
      s.middle_name,
      s.last_name,
      btrim(s.first_name || ' ' || COALESCE(s.middle_name || ' ', '') || s.last_name) AS full_name,
      s.birthdate,
      s.parent_contact,
      s.section_id,
      s.active,
      s.created_at,
      s.updated_at,
      sec.grade_level,
      sec.section_name,
      sec.strand,
      sec.program_code,
      sec.program_name,
      sec.program_type,
      sec.adviser
     FROM students s
     LEFT JOIN vw_sections_catalog sec ON sec.id = s.section_id
     WHERE ${lookupSql}
     LIMIT 1`,
    [lookupParam]
  );

  return result.rows[0] || null;
}

// Lists students with search, filtering, and pagination.
// Connection: admin/guidance student list UI -> /api/students.
router.get('/', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query || {});
    const { whereClause, params } = buildStudentFilters(req.query || {});

    const listParams = [...params, limit, offset];

    const listResult = await query(
      `SELECT
        s.id,
        s.student_id,
        s.lrn,
        s.first_name,
        s.middle_name,
        s.last_name,
        btrim(s.first_name || ' ' || COALESCE(s.middle_name || ' ', '') || s.last_name) AS full_name,
        s.birthdate,
        s.parent_contact,
        s.section_id,
        s.active,
        s.created_at,
        s.updated_at,
        sec.grade_level,
        sec.section_name,
        sec.strand,
        sec.program_code,
        sec.program_name,
        sec.program_type,
        sec.adviser
       FROM students s
       LEFT JOIN vw_sections_catalog sec ON sec.id = s.section_id
       ${whereClause}
       ORDER BY s.last_name ASC, s.first_name ASC, s.student_id ASC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      listParams
    );

    const countResult = await query(
      `SELECT COUNT(*)::int AS total
       FROM students s
       LEFT JOIN vw_sections_catalog sec ON sec.id = s.section_id
       ${whereClause}`,
      params
    );

    const total = countResult.rows[0]?.total || 0;

    res.status(200).json({
      data: listResult.rows.map(toStudentResponse),
      currentPage: page,
      limit,
      totalItems: total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    });
  } catch (error) {
    next(error);
  }
});

// Fetches a single student by UUID or numeric studentId.
// Connection: student profile/details UI -> /api/students/:studentRef.
router.get('/:studentRef', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const student = await getStudentByRef(req.params.studentRef);
    if (!student) {
      throw notFound('Student not found');
    }

    res.status(200).json(toStudentResponse(student));
  } catch (error) {
    next(error);
  }
});

// Creates a student record using normalized section linkage.
// Connection: add-student form -> /api/students.
router.post('/', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const payload = req.body || {};
    const { firstName, middleName, lastName } = resolveStudentName(payload);

    const lrn = optionalText(payload.lrn);
    const birthdate = parseDateOrNull(payload.birthdate, 'birthdate');
    const parentContact = optionalText(payload.parentContact);
    const sectionId = await resolveAcademicSectionId(payload);

    if (!sectionId) {
      throw badRequest('A valid academic placement is required when sectionId is not provided');
    }

    const insertResult = await query(
      `INSERT INTO students (
        lrn,
        first_name,
        middle_name,
        last_name,
        birthdate,
        parent_contact,
        section_id,
        active,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, now())
      RETURNING id`,
      [lrn, firstName, middleName, lastName, birthdate, parentContact, sectionId]
    );

    const created = await getStudentByRef(insertResult.rows[0].id);
    res.status(201).json(toStudentResponse(created));
  } catch (error) {
    if (error?.code === '23505') {
      next(badRequest('Student already exists with the same unique value (likely lrn)'));
      return;
    }
    next(error);
  }
});

// Creates many student records in one request with row-level status reporting.
// Connection: batch CSV upload flow -> /api/students/batch.
router.post('/batch', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const students = Array.isArray(req.body?.students) ? req.body.students : null;
    if (!students || students.length === 0) {
      throw badRequest('students array is required and must not be empty');
    }
    if (students.length > MAX_BATCH_ROWS) {
      throw badRequest(`students array must not exceed ${MAX_BATCH_ROWS} rows`);
    }

    const summary = {
      inserted: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      warnings: [],
      details: []
    };

    for (let index = 0; index < students.length; index += 1) {
      const payload = normalizeBatchRowPayload(students[index]);
      const rowNumber = payload.rowNumber || index + 1;

      try {
        const { firstName, middleName, lastName } = resolveStudentName(payload);
        const lrn = optionalText(payload.lrn);
        if (lrn && !/^\d{1,12}$/.test(lrn)) {
          throw badRequest('lrn must contain only digits and up to 12 characters');
        }

        const birthdate = parseDateOrNull(payload.birthdate, 'birthdate');
        const parentContact = optionalText(payload.parentContact);
        const sectionId = await resolveAcademicSectionId(payload);

        if (!sectionId) {
          throw badRequest('A valid academic placement is required when sectionId is not provided');
        }

        const insertResult = await query(
          `INSERT INTO students (
            lrn,
            first_name,
            middle_name,
            last_name,
            birthdate,
            parent_contact,
            section_id,
            active,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, now())
          RETURNING id`,
          [lrn, firstName, middleName, lastName, birthdate, parentContact, sectionId]
        );

        const created = await getStudentByRef(insertResult.rows[0].id);

        summary.inserted += 1;
        summary.details.push({
          rowNumber,
          status: 'inserted',
          id: created?.id || null,
          lrn: created?.lrn || lrn || null
        });
      } catch (error) {
        if (error?.code === '23505') {
          const message = 'LRN already exists';
          summary.skipped += 1;
          summary.errors.push({
            rowNumber,
            field: 'lrn',
            code: 'DUPLICATE',
            message
          });
          summary.details.push({
            rowNumber,
            status: 'skipped',
            reason: message
          });
          continue;
        }

        const message = error?.message || 'Row failed to upload';

        summary.failed += 1;
        summary.errors.push({
          rowNumber,
          field: 'row',
          code: error?.statusCode === 400 ? 'VALIDATION_ERROR' : 'UPLOAD_ERROR',
          message
        });
        summary.details.push({
          rowNumber,
          status: 'failed',
          reason: message
        });
      }
    }

    let statusCode = 207;
    if (summary.inserted > 0 && summary.failed === 0 && summary.skipped === 0) {
      statusCode = 201;
    } else if (summary.inserted === 0 && summary.failed > 0 && summary.skipped === 0) {
      statusCode = 400;
    }

    res.status(statusCode).json(summary);
  } catch (error) {
    next(error);
  }
});

// Updates mutable student fields and keeps updated_at synchronized.
// Connection: edit-student form -> /api/students/:studentRef.
router.patch('/:studentRef', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const existing = await getStudentByRef(req.params.studentRef);
    if (!existing) {
      throw notFound('Student not found');
    }

    const payload = req.body || {};
    const fields = [];
    const params = [];

    if (payload.fullName !== undefined || payload.firstName !== undefined || payload.lastName !== undefined) {
      const { firstName, middleName, lastName } = resolveStudentName({
        firstName: payload.firstName,
        middleName: payload.middleName,
        lastName: payload.lastName,
        fullName: payload.fullName
      });

      params.push(firstName);
      fields.push(`first_name = $${params.length}`);

      params.push(middleName);
      fields.push(`middle_name = $${params.length}`);

      params.push(lastName);
      fields.push(`last_name = $${params.length}`);
    } else if (payload.middleName !== undefined) {
      params.push(optionalText(payload.middleName));
      fields.push(`middle_name = $${params.length}`);
    }

    if (payload.lrn !== undefined) {
      params.push(optionalText(payload.lrn));
      fields.push(`lrn = $${params.length}`);
    }

    if (payload.birthdate !== undefined) {
      params.push(parseDateOrNull(payload.birthdate, 'birthdate'));
      fields.push(`birthdate = $${params.length}`);
    }

    if (payload.parentContact !== undefined) {
      params.push(optionalText(payload.parentContact));
      fields.push(`parent_contact = $${params.length}`);
    }

    if (
      payload.sectionId !== undefined
      || payload.gradeLevel !== undefined
      || payload.sectionName !== undefined
      || payload.strand !== undefined
    ) {
      params.push(await resolveAcademicSectionId(payload));
      fields.push(`section_id = $${params.length}`);
    }

    if (payload.active !== undefined) {
      const active = parseBooleanOrNull(payload.active);
      if (active === null) {
        throw badRequest('active must be a boolean-like value');
      }
      params.push(active);
      fields.push(`active = $${params.length}`);
    }

    if (!fields.length) {
      throw badRequest('No valid student fields provided for update');
    }

    fields.push('updated_at = now()');

    params.push(existing.id);

    await query(
      `UPDATE students
       SET ${fields.join(', ')}
       WHERE id = $${params.length}`,
      params
    );

    const updated = await getStudentByRef(existing.id);
    res.status(200).json(toStudentResponse(updated));
  } catch (error) {
    if (error?.code === '23505') {
      next(badRequest('Student already exists with the same unique value (likely lrn)'));
      return;
    }
    next(error);
  }
});

// Permanently deletes a student record and related dependent history rows.
// Connection: admin delete action -> /api/students/:studentRef.
router.delete('/:studentRef', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const existing = await getStudentByRef(req.params.studentRef);
    if (!existing) {
      throw notFound('Student not found');
    }

    await query('BEGIN');
    try {
      // message_logs has an XOR check on student_id/violation_id, so clear linked rows first.
      await query(
        `DELETE FROM message_logs
         WHERE student_id = $1
            OR violation_id IN (
              SELECT id FROM violations WHERE student_id = $1
            )`,
        [existing.id]
      );

      await query(
        `DELETE FROM students
         WHERE id = $1`,
        [existing.id]
      );

      await query('COMMIT');
    } catch (deleteError) {
      await query('ROLLBACK');
      throw deleteError;
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Soft-deactivates a student without deleting historical records.
// Connection: student lifecycle management actions -> /api/students/:studentRef/deactivate.
router.patch('/:studentRef/deactivate', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const existing = await getStudentByRef(req.params.studentRef);
    if (!existing) {
      throw notFound('Student not found');
    }

    await query(
      `UPDATE students
       SET active = FALSE,
           updated_at = now()
       WHERE id = $1`,
      [existing.id]
    );

    const updated = await getStudentByRef(existing.id);
    res.status(200).json(toStudentResponse(updated));
  } catch (error) {
    next(error);
  }
});

export default router;
