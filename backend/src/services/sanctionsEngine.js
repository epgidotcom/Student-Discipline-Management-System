import { query } from '../db/client.js';
import { badRequest, notFound } from '../utils/errors.js';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_OFFENSE_LEVEL = 3;

// Reusable SQL used by API and docs to resolve dynamic sanctions by violation and level.
export const SANCTIONS_LOOKUP_SQL = `
  SELECT
    vr.id AS rule_id,
    vr.offense_level,
    vra.sequence_no,
    sa.code AS action_code,
    sa.description AS action_description
  FROM violation_rules vr
  LEFT JOIN violation_rule_actions vra ON vra.rule_id = vr.id
  LEFT JOIN sanction_actions sa ON sa.code = vra.action_code
  WHERE vr.violation_id = $1
    AND vr.offense_level = $2
  ORDER BY vra.sequence_no ASC, sa.code ASC
`;

function optionalText(value) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

function normalizeLookupCode(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const DESCRIPTION_MATCH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'for',
  'from',
  'in',
  'into',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
  'within',
  'without'
]);

function toComparableTokenSet(value) {
  return new Set(
    String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !DESCRIPTION_MATCH_STOP_WORDS.has(token))
  );
}

function computeTokenOverlapScore(leftValue, rightValue) {
  const left = toComparableTokenSet(leftValue);
  const right = toComparableTokenSet(rightValue);

  if (!left.size || !right.size) {
    return 0;
  }

  let overlap = 0;
  left.forEach((token) => {
    if (right.has(token)) {
      overlap += 1;
    }
  });

  return overlap / Math.min(left.size, right.size);
}

function toPolicyOffenseCodeCandidate(offenseCode) {
  const normalized = normalizeLookupCode(offenseCode);
  if (!normalized) return null;
  if (normalized.startsWith('sanctions_engine_')) return normalized;
  return `sanctions_engine_${normalized.replace(/_/g, '')}`;
}

function parsePositiveInt(value, fieldName) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function parseUuid(value, fieldName) {
  const normalized = String(value ?? '').trim();
  if (!UUID_V4_REGEX.test(normalized)) {
    throw badRequest(`${fieldName} must be a valid UUID`);
  }
  return normalized;
}

function sanitizeOffenseLevel(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

async function getViolationDefinitionByClause(whereClause, params) {
  const result = await query(
    `SELECT
      vd.id,
      vd.name,
      vd.category,
      vd.severity,
      vd.is_escalatable,
      vd.offense_id,
      vd.violation_type
     FROM violation_definitions vd
     ${whereClause}
     LIMIT 1`,
    params
  );

  return result.rows[0] || null;
}

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

  return null;
}

async function getOffenseRowById(offenseId) {
  const result = await query(
    `SELECT id, code, category, description
     FROM offenses
     WHERE id = $1
     LIMIT 1`,
    [offenseId]
  );

  return result.rows[0] || null;
}

async function getViolationDefinitionByOffenseCode(offenseCode) {
  const normalizedCode = optionalText(offenseCode);
  if (!normalizedCode) return null;

  return getViolationDefinitionByClause(
    `INNER JOIN offenses o ON o.id = vd.offense_id
     WHERE LOWER(o.code) = LOWER($1)`,
    [normalizedCode]
  );
}

async function getClosestViolationDefinitionByDescription(offenseDescription) {
  const normalizedDescription = optionalText(offenseDescription);
  if (!normalizedDescription) return null;

  const candidates = await query(
    `SELECT
      vd.id,
      vd.name,
      vd.category,
      vd.severity,
      vd.is_escalatable,
      vd.offense_id,
      vd.violation_type,
      o.code AS offense_code,
      o.description AS offense_description
     FROM violation_definitions vd
     LEFT JOIN offenses o ON o.id = vd.offense_id`
  );

  let bestCandidate = null;
  let bestScore = 0;

  for (const row of candidates.rows) {
    const scoreByName = computeTokenOverlapScore(normalizedDescription, row.name);
    const scoreByOffenseDescription = computeTokenOverlapScore(normalizedDescription, row.offense_description);
    const score = Math.max(scoreByName, scoreByOffenseDescription);

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = row;
    }
  }

  // Threshold keeps fuzzy matching deterministic and avoids unrelated mappings.
  return bestScore >= 0.6 ? bestCandidate : null;
}

// Resolves violation definitions from direct id/name, or from offense references.
// Connection: used by POST /api/violations/log sanctions-engine workflow.
export async function resolveViolationDefinition(payload = {}) {
  if (payload.violationDefinitionId !== undefined && payload.violationDefinitionId !== null && payload.violationDefinitionId !== '') {
    const violationDefinitionId = parsePositiveInt(payload.violationDefinitionId, 'violationDefinitionId');
    const byId = await getViolationDefinitionByClause('WHERE vd.id = $1', [violationDefinitionId]);

    if (!byId) {
      throw notFound('Violation definition not found');
    }

    return byId;
  }

  const violationName = optionalText(payload.violationName);
  if (violationName) {
    const byName = await getViolationDefinitionByClause('WHERE LOWER(vd.name) = LOWER($1)', [violationName]);
    if (!byName) {
      throw notFound('Violation definition not found for provided violationName');
    }

    return byName;
  }

  const offenseId = await resolveOffenseId(payload);
  if (offenseId) {
    const byOffense = await getViolationDefinitionByClause('WHERE vd.offense_id = $1', [offenseId]);
    if (byOffense) {
      return byOffense;
    }

    const offense = await getOffenseRowById(offenseId);
    if (!offense) {
      throw notFound('Offense not found');
    }

    const byExactDescription = await getViolationDefinitionByClause('WHERE LOWER(vd.name) = LOWER($1)', [offense.description]);
    if (byExactDescription) {
      return byExactDescription;
    }

    const byFuzzyDescription = await getClosestViolationDefinitionByDescription(offense.description);
    if (byFuzzyDescription) {
      return byFuzzyDescription;
    }

    const policyCodeCandidate = toPolicyOffenseCodeCandidate(offense.code);
    if (policyCodeCandidate) {
      const byPolicyCode = await getViolationDefinitionByOffenseCode(policyCodeCandidate);
      if (byPolicyCode) {
        return byPolicyCode;
      }
    }

    throw notFound('No violation definition is mapped to the provided offense');
  }

  throw badRequest('Provide violationDefinitionId, violationName, offenseId, offenseCode, or offenseDescription');
}

// Counts prior active incidents for the same student and violation definition.
// Connection: offense-level calculation for rule escalation.
export async function countPriorOffensesForStudent(studentId, violationDefinition) {
  const normalizedStudentId = parseUuid(studentId, 'studentId');
  const violationId = parsePositiveInt(violationDefinition?.id, 'violationDefinitionId');
  const offenseId = parsePositiveInt(violationDefinition?.offense_id, 'offenseId');

  const result = await query(
    `SELECT COUNT(*)::int AS total
     FROM violations
     WHERE student_id = $1
       AND active = TRUE
       AND (
         violation_definition_id = $2
         OR (violation_definition_id IS NULL AND offense_id = $3)
       )`,
    [normalizedStudentId, violationId, offenseId]
  );

  return Number(result.rows[0]?.total || 0);
}

// Computes offense level from prior count and escalation policy.
// Connection: used before rule lookup to select the proper sanction set.
export function computeOffenseLevel(priorCount, isEscalatable, maxLevel = MAX_OFFENSE_LEVEL) {
  const safeMax = Math.max(1, sanitizeOffenseLevel(maxLevel));
  if (!isEscalatable) {
    return 1;
  }

  const safePriorCount = Math.max(0, Number.parseInt(String(priorCount ?? '0'), 10) || 0);
  return Math.min(safePriorCount + 1, safeMax);
}

// Retrieves all atomic sanction actions mapped to a violation + offense level rule.
// Connection: provides composable sanctions as data, not hardcoded logic.
export async function getActionsForOffenseLevel(violationDefinitionId, offenseLevel) {
  const violationId = parsePositiveInt(violationDefinitionId, 'violationDefinitionId');
  const level = sanitizeOffenseLevel(offenseLevel);

  const result = await query(SANCTIONS_LOOKUP_SQL, [violationId, level]);

  let ruleId = null;
  const actions = [];

  for (const row of result.rows) {
    if (row.rule_id) {
      ruleId = row.rule_id;
    }

    if (row.action_code) {
      actions.push({
        code: row.action_code,
        description: row.action_description,
        sequence: Number(row.sequence_no || actions.length + 1)
      });
    }
  }

  return {
    ruleId,
    actions
  };
}

// End-to-end sanction decision helper used by the violations log endpoint.
// Connection: resolves definition, computes offense level, then loads mapped actions.
export async function buildSanctionDecision({ studentId, payload = {} }) {
  const definition = await resolveViolationDefinition(payload);
  const priorOffenseCount = await countPriorOffensesForStudent(studentId, definition);
  const violationType = definition?.violation_type || 'PROGRESSIVE';
  const offenseLevel = violationType === 'DIRECT_MAJOR'
    ? 1
    : computeOffenseLevel(priorOffenseCount, definition.is_escalatable, MAX_OFFENSE_LEVEL);
  const { ruleId, actions } = await getActionsForOffenseLevel(definition.id, offenseLevel);

  return {
    violationDefinitionId: definition.id,
    violationName: definition.name,
    category: definition.category,
    severity: definition.severity,
    isEscalatable: definition.is_escalatable,
    offenseId: definition.offense_id,
    violationType,
    priorOffenseCount,
    offenseLevel,
    maxOffenseLevel: violationType === 'DIRECT_MAJOR' ? 1 : MAX_OFFENSE_LEVEL,
    ruleId,
    actions
  };
}
