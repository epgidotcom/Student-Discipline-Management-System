import { env } from '../config/env.js';
import { query } from '../db/client.js';
import { logger } from '../utils/logger.js';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RETRIES = 1;

// Converts violation evidence payloads into the categorical token expected by Python inference.
// Connection: called by buildInferencePayload() before predictive-service /infer requests.
function toEvidenceToken(evidence) {
  if (evidence == null) return 'none';
  if (Array.isArray(evidence)) return evidence.length ? 'present' : 'none';

  if (typeof evidence === 'string') {
    return evidence.trim() ? 'present' : 'none';
  }

  if (typeof evidence === 'object') {
    const files = Array.isArray(evidence.files) ? evidence.files : [];
    return files.length ? 'present' : 'none';
  }

  return 'present';
}

// Parses date input and always returns a valid Date object.
// Connection: used by buildInferencePayload() to produce calendar feature columns.
function toSafeDate(value) {
  const parsed = new Date(value || Date.now());
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

// Generates the inference payload expected by predictive-service/app.py InferRequest.
// Connection: violation routes call this indirectly through runAsyncPredictionForViolation().
export function buildInferencePayload(violationRow) {
  const incidentDate = toSafeDate(violationRow.incident_date);
  const offenseIdRaw = Number.parseInt(violationRow.offense_id, 10);

  return {
    offense_id: Number.isFinite(offenseIdRaw) ? offenseIdRaw : 0,
    description: String(violationRow.offense_description || '').trim(),
    sanction: String(violationRow.sanction_label || 'none').trim() || 'none',
    evidence: toEvidenceToken(violationRow.evidence),
    status: String(violationRow.status_label || 'Pending').trim() || 'Pending',
    active: violationRow.student_active ? 1 : 0,
    incident_year: incidentDate.getUTCFullYear(),
    incident_month: incidentDate.getUTCMonth() + 1,
    incident_day: incidentDate.getUTCDate(),
    incident_dayofweek: incidentDate.getUTCDay()
  };
}

// Uses configured predictive endpoint and strips trailing slashes for stable URL joins.
// Connection: requestRepeatProbability() depends on this for /infer URL construction.
function getPredictiveServiceUrl() {
  const raw = String(env.PREDICTIVE_SERVICE_URL || '').trim();
  return raw ? raw.replace(/\/+$/, '') : '';
}

// Calls the predictive-service /infer endpoint with retry and timeout handling.
// Connection: runAsyncPredictionForViolation() uses this for live repeat-probability inference.
export async function requestRepeatProbability(payload) {
  const baseUrl = getPredictiveServiceUrl();
  if (!baseUrl) {
    return null;
  }

  const timeoutMs = env.PREDICTIVE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS;
  const maxRetries = env.PREDICTIVE_MAX_RETRIES ?? DEFAULT_MAX_RETRIES;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}/infer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Predictive request failed (${response.status}): ${body}`);
      }

      const result = await response.json();
      const repeatProbability = Number(result.repeat_probability);

      if (!Number.isFinite(repeatProbability) || repeatProbability < 0 || repeatProbability > 1) {
        throw new Error('Predictive service returned invalid repeat_probability');
      }

      return {
        repeatProbability,
        modelVersion: String(result.model_version || 'unknown').trim() || 'unknown',
        sourceService: baseUrl
      };
    } catch (error) {
      const isTimeout = error?.name === 'AbortError';
      lastError = isTimeout
        ? new Error(`Predictive request timed out after ${timeoutMs}ms`)
        : error;

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw lastError || new Error('Predictive request failed');
}

// Upserts model metadata and returns model primary key.
// Connection: persistViolationPrediction() uses this to map modelVersion -> predictive_models.id.
async function getOrCreatePredictiveModel(modelVersion, sourceService) {
  const result = await query(
    `INSERT INTO predictive_models (model_version, source_service)
     VALUES ($1, $2)
     ON CONFLICT (model_version)
     DO UPDATE SET source_service = EXCLUDED.source_service
     RETURNING id`,
    [modelVersion, sourceService]
  );

  return result.rows[0].id;
}

// Persists or refreshes repeat-probability rows for the normalized schema.
// Connection: called by runAsyncPredictionForViolation() after successful inference.
export async function persistViolationPrediction({ violationId, repeatProbability, modelVersion, sourceService }) {
  const modelId = await getOrCreatePredictiveModel(modelVersion, sourceService);

  await query(
    `INSERT INTO violation_predictions (violation_id, model_id, repeat_probability)
     VALUES ($1, $2, $3)
     ON CONFLICT (violation_id, model_id)
     DO UPDATE SET
       repeat_probability = EXCLUDED.repeat_probability,
       created_at = now()`,
    [violationId, modelId, repeatProbability]
  );
}

// Executes inference flow for one violation row without blocking API response paths.
// Connection: violations route triggers this after create/update/status changes.
export async function runAsyncPredictionForViolation(violationRow) {
  const baseUrl = getPredictiveServiceUrl();
  if (!baseUrl) {
    return {
      skipped: true,
      reason: 'predictive_service_url_not_configured'
    };
  }

  const payload = buildInferencePayload(violationRow);
  const result = await requestRepeatProbability(payload);

  if (!result) {
    return {
      skipped: true,
      reason: 'predictive_request_skipped'
    };
  }

  await persistViolationPrediction({
    violationId: violationRow.id,
    repeatProbability: result.repeatProbability,
    modelVersion: result.modelVersion,
    sourceService: result.sourceService
  });

  logger.info('Predictive inference stored', {
    violationId: violationRow.id,
    modelVersion: result.modelVersion,
    repeatProbability: result.repeatProbability
  });

  return result;
}

// Normalizes optional query filters where empty and "All" both mean no filter.
// Connection: used by predictive dashboard analytics read endpoints.
function normalizeOptionalFilter(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.toLowerCase() === 'all') {
    return null;
  }
  return normalized;
}

// Reusable SQL expression to keep grade-section formatting consistent across list queries.
// Connection: predictive dashboard section labels and filter options.
const GRADE_SECTION_SQL = `
  CASE
    WHEN vpe.grade_level IS NOT NULL AND vpe.section_name IS NOT NULL
      THEN vpe.grade_level::text || '-' || vpe.section_name
    WHEN vpe.grade_level IS NOT NULL
      THEN vpe.grade_level::text
    WHEN vpe.section_name IS NOT NULL
      THEN vpe.section_name
    ELSE 'Unknown'
  END
`;

// Returns predictive likelihood rows grouped by grade-section with optional filters.
// Connection: /api/analytics/predictive-repeat-risk main chart dataset.
export async function listPredictiveSectionLikelihood({ section, violation, windowDays = 90, limit = 30 }) {
  const normalizedSection = normalizeOptionalFilter(section);
  const normalizedViolation = normalizeOptionalFilter(violation);

  const result = await query(
    `WITH base AS (
      SELECT
        ${GRADE_SECTION_SQL} AS section,
        COALESCE(offense_lookup.category, 'Uncategorized') AS violation_category,
        vpe.repeat_probability
      FROM vw_violation_predictions_enriched vpe
      LEFT JOIN LATERAL (
        SELECT o.category
        FROM offenses o
        WHERE o.description IS NOT NULL
          AND trim(o.description) <> ''
          AND LOWER(o.description) = LOWER(vpe.offense_description)
        ORDER BY o.id ASC
        LIMIT 1
      ) offense_lookup ON TRUE
      WHERE COALESCE(vpe.incident_date, vpe.created_at::date) >= CURRENT_DATE - $1::int
    )
    SELECT
      base.section,
      AVG(base.repeat_probability)::float8 AS likelihood,
      COUNT(*)::int AS sample_size
    FROM base
    WHERE ($2::text IS NULL OR base.section = $2)
      AND ($3::text IS NULL OR base.violation_category = $3)
    GROUP BY base.section
    ORDER BY likelihood DESC, sample_size DESC, base.section ASC
    LIMIT $4::int`,
    [windowDays, normalizedSection, normalizedViolation, limit]
  );

  return result.rows.map((row) => ({
    section: row.section,
    likelihood: Number(row.likelihood || 0),
    sample_size: Number(row.sample_size || 0)
  }));
}

// Lists available grade-section filters for predictive dashboards.
// Connection: /api/analytics/predictive-repeat-risk filter options.
export async function listPredictiveSections() {
  const result = await query(
    `SELECT DISTINCT ${GRADE_SECTION_SQL} AS section
     FROM vw_violation_predictions_enriched vpe
     ORDER BY section ASC`
  );

  return result.rows
    .map((row) => String(row.section || '').trim())
    .filter(Boolean);
}

// Lists available grade-section + strand combinations for predictive dashboards.
// Connection: /api/analytics/predictive-repeat-risk section_entries payload.
export async function listPredictiveSectionEntries() {
  const result = await query(
    `SELECT DISTINCT
      ${GRADE_SECTION_SQL} AS grade_section,
      NULLIF(trim(vpe.strand), '') AS strand
     FROM vw_violation_predictions_enriched vpe
     ORDER BY grade_section ASC, strand ASC NULLS LAST`
  );

  return result.rows.map((row) => ({
    grade_section: String(row.grade_section || '').trim(),
    strand: row.strand || null
  }));
}

// Lists available violation category filters for predictive dashboards.
// Connection: /api/analytics/predictive-repeat-risk violation dropdown.
export async function listPredictiveViolationCategories() {
  const result = await query(
    `SELECT DISTINCT o.category
     FROM offenses o
     WHERE o.category IS NOT NULL
       AND trim(o.category) <> ''
     ORDER BY o.category ASC`
  );

  return result.rows
    .map((row) => String(row.category || '').trim())
    .filter(Boolean);
}
