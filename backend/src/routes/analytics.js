import { Router } from 'express';

import { query } from '../db/client.js';
import { requireAuth, requireWebsitePower } from '../middleware/auth.js';
import { badRequest } from '../utils/errors.js';
import {
  listPredictiveSectionEntries,
  listPredictiveSectionLikelihood,
  listPredictiveSections,
  listPredictiveViolationCategories
} from '../services/predictive.js';

const router = Router();

// Parses positive integer query params with lower/upper bounds.
// Connection: predictive analytics endpoint query validation.
function parseBoundedInt(value, { fieldName, fallback, min, max }) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${fieldName} must be a valid integer`);
  }

  if (parsed < min || parsed > max) {
    throw badRequest(`${fieldName} must be between ${min} and ${max}`);
  }

  return parsed;
}

// Parses optional ISO date filters used by analytics windows.
// Connection: shared by all analytics endpoints that support fromDate/toDate.
function parseDateOrNull(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalized = String(value).trim();
  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${fieldName} must be a valid date`);
  }

  return parsed;
}

// Builds shared SQL date predicates for incident/log timestamp filtering.
// Connection: used by overview and grouped analytics endpoints.
function buildDateFilter(columnName, queryParams) {
  const clauses = [];
  const params = [];

  const fromDate = parseDateOrNull(queryParams.fromDate, 'fromDate');
  const toDate = parseDateOrNull(queryParams.toDate, 'toDate');

  if (fromDate) {
    params.push(fromDate);
    clauses.push(`${columnName} >= $${params.length}`);
  }

  if (toDate) {
    params.push(toDate);
    clauses.push(`${columnName} <= $${params.length}`);
  }

  return {
    whereClause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

// Provides top-level dashboard counters for backend consumers.
// Connection: dashboard summary cards -> /api/analytics/overview.
router.get('/overview', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const { whereClause, params } = buildDateFilter('v.incident_date', req.query || {});

    const [studentsResult, activeStudentsResult, violationsResult, openAppealsResult, queuedMessagesResult] = await Promise.all([
      query(`SELECT COUNT(*)::int AS total FROM students`),
      query(`SELECT COUNT(*)::int AS total FROM students WHERE active = TRUE`),
      query(
        `SELECT COUNT(*)::int AS total
         FROM violations v
         ${whereClause}`,
        params
      ),
      query(
        `SELECT COUNT(*)::int AS total
         FROM appeals a
         INNER JOIN appeal_statuses aps ON aps.id = a.status_id
         WHERE aps.code = 'pending'`
      ),
      query(
        `SELECT COUNT(*)::int AS total
         FROM message_logs ml
         INNER JOIN message_statuses ms ON ms.id = ml.message_status_id
         WHERE ms.code = 'queued'`
      )
    ]);

    res.status(200).json({
      students: studentsResult.rows[0]?.total || 0,
      activeStudents: activeStudentsResult.rows[0]?.total || 0,
      violations: violationsResult.rows[0]?.total || 0,
      pendingAppeals: openAppealsResult.rows[0]?.total || 0,
      queuedMessages: queuedMessagesResult.rows[0]?.total || 0
    });
  } catch (error) {
    next(error);
  }
});

// Aggregates violations by normalized status.
// Connection: status distribution charts -> /api/analytics/violations/by-status.
router.get('/violations/by-status', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const { whereClause, params } = buildDateFilter('v.incident_date', req.query || {});

    const result = await query(
      `SELECT
        vs.id,
        vs.code,
        vs.label,
        COUNT(v.id)::int AS total
       FROM violation_statuses vs
       LEFT JOIN violations v
         ON v.status_id = vs.id
         ${whereClause ? `AND ${whereClause.replace(/^WHERE\s+/i, '')}` : ''}
       GROUP BY vs.id, vs.code, vs.label
       ORDER BY total DESC, vs.id ASC`,
      params
    );

    res.status(200).json(result.rows);
  } catch (error) {
    next(error);
  }
});

// Aggregates violations by offense category and description.
// Connection: offense trend charts -> /api/analytics/violations/by-offense.
router.get('/violations/by-offense', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const { whereClause, params } = buildDateFilter('v.incident_date', req.query || {});

    const result = await query(
      `SELECT
        o.id,
        o.code,
        o.category,
        o.description,
        COUNT(v.id)::int AS total
       FROM offenses o
       LEFT JOIN violations v
         ON v.offense_id = o.id
         ${whereClause ? `AND ${whereClause.replace(/^WHERE\s+/i, '')}` : ''}
       GROUP BY o.id, o.code, o.category, o.description
       ORDER BY total DESC, o.category ASC NULLS LAST, o.code ASC`,
      params
    );

    res.status(200).json(result.rows);
  } catch (error) {
    next(error);
  }
});

// Aggregates appeals by normalized appeal status.
// Connection: appeals dashboard charts -> /api/analytics/appeals/by-status.
router.get('/appeals/by-status', requireAuth, requireWebsitePower, async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT
        aps.id,
        aps.code,
        aps.label,
        COUNT(a.id)::int AS total
       FROM appeal_statuses aps
       LEFT JOIN appeals a ON a.status_id = aps.id
       GROUP BY aps.id, aps.code, aps.label
       ORDER BY total DESC, aps.id ASC`
    );

    res.status(200).json(result.rows);
  } catch (error) {
    next(error);
  }
});

// Aggregates message logs by normalized send status.
// Connection: message delivery report charts -> /api/analytics/messages/by-status.
router.get('/messages/by-status', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const { whereClause, params } = buildDateFilter('ml.date_sent', req.query || {});

    const result = await query(
      `SELECT
        ms.id,
        ms.code,
        ms.label,
        COUNT(ml.id)::int AS total
       FROM message_statuses ms
       LEFT JOIN message_logs ml
         ON ml.message_status_id = ms.id
         ${whereClause ? `AND ${whereClause.replace(/^WHERE\s+/i, '')}` : ''}
       GROUP BY ms.id, ms.code, ms.label
       ORDER BY total DESC, ms.id ASC`,
      params
    );

    res.status(200).json(result.rows);
  } catch (error) {
    next(error);
  }
});

// Returns section-level repeat-risk likelihood for predictive dashboards.
// Connection: admin dashboard predictive panel -> /api/analytics/predictive-repeat-risk.
router.get('/predictive-repeat-risk', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const section = String(req.query?.section || 'All');
    const violation = String(req.query?.violation || 'All');
    const windowDays = parseBoundedInt(req.query?.window_days, {
      fieldName: 'window_days',
      fallback: 90,
      min: 1,
      max: 365
    });
    const limit = parseBoundedInt(req.query?.limit, {
      fieldName: 'limit',
      fallback: 30,
      min: 1,
      max: 100
    });

    const [rows, sections, sectionEntries, violations] = await Promise.all([
      listPredictiveSectionLikelihood({ section, violation, windowDays, limit }),
      listPredictiveSections(),
      listPredictiveSectionEntries(),
      listPredictiveViolationCategories()
    ]);

    res.status(200).json({
      window_days: windowDays,
      section_filter: section,
      violation_filter: violation,
      generated_at: new Date().toISOString(),
      sections,
      section_entries: sectionEntries,
      violations,
      labels: rows.map((row) => row.section),
      likelihood: rows.map((row) => row.likelihood),
      sample_sizes: rows.map((row) => row.sample_size),
      rows
    });
  } catch (error) {
    next(error);
  }
});

export default router;
