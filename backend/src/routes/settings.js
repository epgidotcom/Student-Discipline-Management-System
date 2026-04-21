import { Router } from 'express';

import { query } from '../db/client.js';
import { requireAuth, requireWebsitePower } from '../middleware/auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { getSectionCatalogRowById, upsertSectionCatalogEntry } from '../services/sectionCatalog.js';

const router = Router();

// Normalizes optional input text fields.
// Connection: shared by sanctions and sections CRUD endpoints.
function optionalText(value) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

// Parses positive integer URL ids for settings resource routes.
// Connection: used by sanctions/:id and sections/:id update/delete endpoints.
function parsePositiveInt(value, fieldName) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

// Lists sanction lookup records for settings pages.
// Connection: settings sanctions panel -> /api/settings/sanctions.
router.get('/sanctions', requireAuth, requireWebsitePower, async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT id, code, label, description, active, created_at, updated_at
       FROM sanctions
       ORDER BY created_at DESC, id DESC`
    );

    res.status(200).json(
      result.rows.map((row) => ({
        id: row.id,
        code: row.code,
        label: row.label,
        description: row.description,
        active: row.active,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    );
  } catch (error) {
    next(error);
  }
});

// Creates sanction lookup values used by violations workflow.
// Connection: settings sanctions create action -> /api/settings/sanctions.
router.post('/sanctions', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const code = optionalText(req.body?.code);
    const label = optionalText(req.body?.label);
    const description = optionalText(req.body?.description);

    if (!code || !label) {
      throw badRequest('code and label are required');
    }

    const insertResult = await query(
      `INSERT INTO sanctions (code, label, description)
       VALUES ($1, $2, $3)
       RETURNING id, code, label, description, active, created_at, updated_at`,
      [code, label, description]
    );

    const row = insertResult.rows[0];
    res.status(201).json({
      id: row.id,
      code: row.code,
      label: row.label,
      description: row.description,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  } catch (error) {
    if (error?.code === '23505') {
      next(badRequest('Sanction code already exists'));
      return;
    }
    next(error);
  }
});

// Updates one sanction lookup row.
// Connection: settings sanctions edit action -> /api/settings/sanctions/:id.
router.patch('/sanctions/:id', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const sanctionId = parsePositiveInt(req.params.id, 'id');
    const fields = [];
    const params = [];

    if (req.body?.code !== undefined) {
      const code = optionalText(req.body.code);
      if (!code) {
        throw badRequest('code cannot be empty');
      }
      params.push(code);
      fields.push(`code = $${params.length}`);
    }

    if (req.body?.label !== undefined) {
      const label = optionalText(req.body.label);
      if (!label) {
        throw badRequest('label cannot be empty');
      }
      params.push(label);
      fields.push(`label = $${params.length}`);
    }

    if (req.body?.description !== undefined) {
      params.push(optionalText(req.body.description));
      fields.push(`description = $${params.length}`);
    }

    if (req.body?.active !== undefined) {
      const normalized = String(req.body.active).trim().toLowerCase();
      if (!['true', 'false', '1', '0', 'yes', 'no'].includes(normalized)) {
        throw badRequest('active must be a boolean-like value');
      }
      params.push(['true', '1', 'yes'].includes(normalized));
      fields.push(`active = $${params.length}`);
    }

    if (!fields.length) {
      throw badRequest('No valid sanction fields provided for update');
    }

    fields.push('updated_at = now()');

    params.push(sanctionId);

    const updateResult = await query(
      `UPDATE sanctions
       SET ${fields.join(', ')}
       WHERE id = $${params.length}
       RETURNING id, code, label, description, active, created_at, updated_at`,
      params
    );

    if (!updateResult.rows.length) {
      throw notFound('Sanction not found');
    }

    const row = updateResult.rows[0];
    res.status(200).json({
      id: row.id,
      code: row.code,
      label: row.label,
      description: row.description,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  } catch (error) {
    if (error?.code === '23505') {
      next(badRequest('Sanction code already exists'));
      return;
    }
    next(error);
  }
});

// Deletes one sanction row when not referenced by violations.
// Connection: settings sanctions delete action -> /api/settings/sanctions/:id.
router.delete('/sanctions/:id', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const sanctionId = parsePositiveInt(req.params.id, 'id');

    const result = await query(
      `DELETE FROM sanctions
       WHERE id = $1`,
      [sanctionId]
    );

    if (!result.rowCount) {
      throw notFound('Sanction not found');
    }

    res.status(204).end();
  } catch (error) {
    if (error?.code === '23503') {
      next(badRequest('Sanction cannot be deleted while referenced by violations'));
      return;
    }
    next(error);
  }
});

// Lists section records for grade/section/strand settings forms.
// Connection: settings sections panel -> /api/settings/sections.
router.get('/sections', requireAuth, requireWebsitePower, async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT
        id,
        grade_level,
        section_name,
        section_label,
        strand,
        program_code,
        program_name,
        program_type,
        adviser,
        created_at,
        updated_at
       FROM vw_sections_catalog
       ORDER BY grade_level ASC, program_name ASC, section_label ASC, id ASC`
    );

    res.status(200).json(
      result.rows.map((row) => ({
        id: row.id,
        gradeLevel: row.grade_level,
        sectionName: row.section_name,
        sectionLabel: row.section_label,
        strand: row.strand,
        programCode: row.program_code,
        programName: row.program_name,
        programType: row.program_type,
        adviser: row.adviser,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    );
  } catch (error) {
    next(error);
  }
});

// Creates a new section row for student normalization.
// Connection: settings sections create action -> /api/settings/sections.
router.post('/sections', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const row = await upsertSectionCatalogEntry(req.body || {});
    res.status(201).json({
      id: row.id,
      gradeLevel: row.grade_level,
      sectionName: row.section_name,
      sectionLabel: row.section_label,
      strand: row.strand,
      programCode: row.program_code,
      programName: row.program_name,
      programType: row.program_type,
      adviser: row.adviser,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  } catch (error) {
    if (error?.code === '23505') {
      next(badRequest('Section already exists for this grade level and program/strand'));
      return;
    }
    next(error);
  }
});

// Updates one section row.
// Connection: settings sections edit action -> /api/settings/sections/:id.
router.patch('/sections/:id', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const sectionId = parsePositiveInt(req.params.id, 'id');
    const existing = await getSectionCatalogRowById(sectionId);
    if (!existing) {
      throw notFound('Section not found');
    }

    const hasUpdatableField = (
      req.body?.gradeLevel !== undefined
      || req.body?.sectionName !== undefined
      || req.body?.strand !== undefined
      || req.body?.adviser !== undefined
    );

    if (!hasUpdatableField) {
      throw badRequest('No valid section fields provided for update');
    }

    const row = await upsertSectionCatalogEntry(
      {
        gradeLevel: req.body?.gradeLevel ?? existing.grade_level,
        sectionName: req.body?.sectionName ?? existing.section_name,
        strand: req.body?.strand ?? existing.program_name,
        adviser: req.body?.adviser ?? existing.adviser
      },
      { sectionId }
    );

    res.status(200).json({
      id: row.id,
      gradeLevel: row.grade_level,
      sectionName: row.section_name,
      sectionLabel: row.section_label,
      strand: row.strand,
      programCode: row.program_code,
      programName: row.program_name,
      programType: row.program_type,
      adviser: row.adviser,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  } catch (error) {
    if (error?.code === '23505') {
      next(badRequest('Section already exists for this grade level and program/strand'));
      return;
    }
    next(error);
  }
});

// Deletes one section if not referenced by students.
// Connection: settings sections delete action -> /api/settings/sections/:id.
router.delete('/sections/:id', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const sectionId = parsePositiveInt(req.params.id, 'id');

    const result = await query(
      `DELETE FROM sections
       WHERE id = $1`,
      [sectionId]
    );

    if (!result.rowCount) {
      throw notFound('Section not found');
    }

    res.status(204).end();
  } catch (error) {
    if (error?.code === '23503') {
      next(badRequest('Section cannot be deleted while referenced by students'));
      return;
    }
    next(error);
  }
});

// Returns lookup data needed by settings and form dropdowns.
// Connection: settings bootstrap API -> /api/settings/lookups.
router.get('/lookups', requireAuth, requireWebsitePower, async (_req, res, next) => {
  try {
    const [violationStatuses, resolutionTypes, appealStatuses, messageTypes, messageStatuses] = await Promise.all([
      query(`SELECT id, code, label FROM violation_statuses ORDER BY id ASC`),
      query(`SELECT id, code, label FROM resolution_types ORDER BY id ASC`),
      query(`SELECT id, code, label FROM appeal_statuses ORDER BY id ASC`),
      query(`SELECT id, code, label FROM message_types ORDER BY id ASC`),
      query(`SELECT id, code, label FROM message_statuses ORDER BY id ASC`)
    ]);

    res.status(200).json({
      violationStatuses: violationStatuses.rows,
      resolutionTypes: resolutionTypes.rows,
      appealStatuses: appealStatuses.rows,
      messageTypes: messageTypes.rows,
      messageStatuses: messageStatuses.rows
    });
  } catch (error) {
    next(error);
  }
});

export default router;
