import { query } from '../db/client.js';
import { badRequest, notFound } from '../utils/errors.js';

export const DEFAULT_ADVISER = 'Gemari';
export const SUPPORTED_GRADE_LEVELS = Object.freeze([7, 8, 9, 10, 11, 12]);
export const SPECIAL_PROGRAM_CODES = new Set(['STE', 'SPA', 'SPJ']);
export const STRAND_PROGRAM_CODES = new Set(['STEM', 'ABM', 'HUMSS', 'GAS', 'HE']);

export const ACADEMIC_PROGRAM_TYPE_CODES = Object.freeze({
  REGULAR: 'REGULAR',
  STRAND: 'STRAND',
  SPECIAL_PROGRAM: 'SPECIAL_PROGRAM'
});

export const ACADEMIC_PROGRAM_SEEDS = Object.freeze([
  {
    code: 'REGULAR',
    name: 'Regular',
    programTypeCode: ACADEMIC_PROGRAM_TYPE_CODES.REGULAR,
    sectionDisplayPrefix: null,
    sectionDisplaySeparator: '',
    sortOrder: 10
  },
  {
    code: 'STE',
    name: 'STE',
    programTypeCode: ACADEMIC_PROGRAM_TYPE_CODES.SPECIAL_PROGRAM,
    sectionDisplayPrefix: 'STE',
    sectionDisplaySeparator: '',
    sortOrder: 20
  },
  {
    code: 'SPA',
    name: 'SPA',
    programTypeCode: ACADEMIC_PROGRAM_TYPE_CODES.SPECIAL_PROGRAM,
    sectionDisplayPrefix: 'SPA',
    sectionDisplaySeparator: ' ',
    sortOrder: 30
  },
  {
    code: 'SPJ',
    name: 'SPJ',
    programTypeCode: ACADEMIC_PROGRAM_TYPE_CODES.SPECIAL_PROGRAM,
    sectionDisplayPrefix: 'SPJ',
    sectionDisplaySeparator: ' ',
    sortOrder: 40
  },
  {
    code: 'STEM',
    name: 'STEM',
    programTypeCode: ACADEMIC_PROGRAM_TYPE_CODES.STRAND,
    sectionDisplayPrefix: null,
    sectionDisplaySeparator: '',
    sortOrder: 50
  },
  {
    code: 'ABM',
    name: 'ABM',
    programTypeCode: ACADEMIC_PROGRAM_TYPE_CODES.STRAND,
    sectionDisplayPrefix: null,
    sectionDisplaySeparator: '',
    sortOrder: 60
  },
  {
    code: 'HUMSS',
    name: 'HUMSS',
    programTypeCode: ACADEMIC_PROGRAM_TYPE_CODES.STRAND,
    sectionDisplayPrefix: null,
    sectionDisplaySeparator: '',
    sortOrder: 70
  },
  {
    code: 'GAS',
    name: 'GAS',
    programTypeCode: ACADEMIC_PROGRAM_TYPE_CODES.STRAND,
    sectionDisplayPrefix: null,
    sectionDisplaySeparator: '',
    sortOrder: 80
  },
  {
    code: 'HE',
    name: 'HE',
    programTypeCode: ACADEMIC_PROGRAM_TYPE_CODES.STRAND,
    sectionDisplayPrefix: null,
    sectionDisplaySeparator: '',
    sortOrder: 90
  }
]);

export const GRADE_LEVEL_PROGRAM_SEEDS = Object.freeze(
  SUPPORTED_GRADE_LEVELS.flatMap((gradeLevel) => {
    const programCodes = gradeLevel <= 10
      ? ['REGULAR', 'STE', 'SPA', 'SPJ']
      : ['STEM', 'ABM', 'HUMSS', 'GAS', 'HE'];

    return programCodes.map((programCode) => ({
      gradeLevel,
      programCode
    }));
  })
);

export const DEFAULT_SECTION_LABEL_SEEDS = Object.freeze([
  { label: 'A', sortOrder: 1 },
  { label: 'B', sortOrder: 2 },
  { label: 'C', sortOrder: 3 },
  { label: 'D', sortOrder: 4 },
  { label: 'E', sortOrder: 5 },
  { label: '1', sortOrder: 101 },
  { label: '2', sortOrder: 102 },
  { label: '3', sortOrder: 103 }
]);

const PROGRAM_SEED_BY_CODE = new Map(
  ACADEMIC_PROGRAM_SEEDS.map((entry) => [entry.code, entry])
);

const PROGRAM_CODE_ALIASES = new Map([
  ['REGULAR', 'REGULAR'],
  ['GENERAL', 'REGULAR'],
  ['STEM', 'STEM'],
  ['ABM', 'ABM'],
  ['HUMSS', 'HUMSS'],
  ['HUMMS', 'HUMSS'],
  ['GAS', 'GAS'],
  ['HE', 'HE'],
  ['HOME ECONOMICS', 'HE'],
  ['HOMEECONOMICS', 'HE'],
  ['STE', 'STE'],
  ['SPA', 'SPA'],
  ['SPJ', 'SPJ']
]);

const PROGRAM_CODES_BY_GRADE = new Map(
  SUPPORTED_GRADE_LEVELS.map((gradeLevel) => {
    const codes = gradeLevel <= 10
      ? ['REGULAR', 'STE', 'SPA', 'SPJ']
      : ['STEM', 'ABM', 'HUMSS', 'GAS', 'HE'];

    return [gradeLevel, new Set(codes)];
  })
);

function optionalText(value) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

function parsePositiveInt(value, fieldName) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function normalizeProgramToken(value) {
  const normalized = optionalText(value);
  if (!normalized) {
    return null;
  }

  const token = normalized
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');

  return PROGRAM_CODE_ALIASES.get(token) || null;
}

function normalizeAlphabeticSectionLabel(value) {
  const normalized = optionalText(value);
  if (!normalized) {
    throw badRequest('sectionName is required');
  }

  const label = normalized.toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z]{1,3}$/.test(label)) {
    throw badRequest('Regular and strand sections must use alphabetic labels like A-E');
  }

  return label;
}

function normalizeNumericSectionLabel(value) {
  const normalized = optionalText(value);
  if (!normalized) {
    throw badRequest('sectionName is required');
  }

  const label = normalized.replace(/\s+/g, '');
  if (!/^[1-9]\d*$/.test(label)) {
    throw badRequest('Special program sections must use numeric labels like 1, 2, or 3');
  }

  return String(Number.parseInt(label, 10));
}

function parseSpecialSectionName(value) {
  const normalized = optionalText(value);
  if (!normalized) {
    return null;
  }

  const matched = normalized.match(/^(STE|SPA|SPJ)\s*([1-9]\d*)$/i);
  if (!matched) {
    return null;
  }

  return {
    programCode: matched[1].toUpperCase(),
    sectionLabel: String(Number.parseInt(matched[2], 10))
  };
}

function isProgramAllowedForGrade(gradeLevel, programCode) {
  return PROGRAM_CODES_BY_GRADE.get(gradeLevel)?.has(programCode) || false;
}

function computeSectionSortOrder(label) {
  if (/^\d+$/.test(label)) {
    return 100 + Number.parseInt(label, 10);
  }

  if (/^[A-Z]$/.test(label)) {
    return label.charCodeAt(0) - 64;
  }

  return 500 + label.length;
}

export function parseGradeLevel(value, fieldName = 'gradeLevel', { allowNull = false } = {}) {
  const normalized = optionalText(value);
  if (!normalized) {
    if (allowNull) return null;
    throw badRequest(`${fieldName} is required`);
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!SUPPORTED_GRADE_LEVELS.includes(parsed)) {
    throw badRequest(`${fieldName} must be between 7 and 12`);
  }

  return parsed;
}

export function getProgramSeed(programCode) {
  return PROGRAM_SEED_BY_CODE.get(programCode) || null;
}

export function formatSectionName(programCode, sectionLabel) {
  const program = getProgramSeed(programCode);
  if (!program) {
    return sectionLabel;
  }

  if (!program.sectionDisplayPrefix) {
    return sectionLabel;
  }

  return `${program.sectionDisplayPrefix}${program.sectionDisplaySeparator}${sectionLabel}`;
}

export function parseAcademicPlacement(input = {}, { requirePlacement = false } = {}) {
  const hasAcademicInput = [
    input.gradeLevel,
    input.sectionName,
    input.section,
    input.strand,
    input.program,
    input.programCode,
    input.programName,
    input.academicGroup
  ].some((value) => optionalText(value));

  if (!hasAcademicInput) {
    if (requirePlacement) {
      throw badRequest('gradeLevel, sectionName, and strand/program are required');
    }
    return null;
  }

  const gradeLevel = parseGradeLevel(input.gradeLevel, 'gradeLevel');
  const rawSectionName = optionalText(input.sectionName ?? input.section);
  if (!rawSectionName) {
    throw badRequest('sectionName is required when gradeLevel is provided');
  }

  const rawProgram = optionalText(
    input.programCode
    ?? input.programName
    ?? input.program
    ?? input.academicGroup
    ?? input.strand
  );

  const inferredSpecialSection = parseSpecialSectionName(rawSectionName);
  let programCode = normalizeProgramToken(rawProgram);

  if (gradeLevel <= 10) {
    if (!programCode) {
      programCode = inferredSpecialSection?.programCode || 'REGULAR';
    }
  } else if (!programCode) {
    throw badRequest('strand is required for grades 11 and 12');
  }

  if (!programCode) {
    throw badRequest('Provide a valid strand or program');
  }

  if (!isProgramAllowedForGrade(gradeLevel, programCode)) {
    const message = gradeLevel <= 10
      ? 'Grades 7 to 10 only allow Regular, STE, SPA, or SPJ'
      : 'Grades 11 and 12 only allow STEM, ABM, HUMSS, GAS, or HE';

    throw badRequest(message);
  }

  let sectionLabel = null;

  if (SPECIAL_PROGRAM_CODES.has(programCode)) {
    if (inferredSpecialSection && inferredSpecialSection.programCode !== programCode) {
      throw badRequest('sectionName does not match the selected special program');
    }

    sectionLabel = inferredSpecialSection
      ? inferredSpecialSection.sectionLabel
      : normalizeNumericSectionLabel(rawSectionName);
  } else {
    if (inferredSpecialSection) {
      throw badRequest('Special program section names are only valid for STE, SPA, or SPJ');
    }

    sectionLabel = normalizeAlphabeticSectionLabel(rawSectionName);
  }

  const program = getProgramSeed(programCode);

  return {
    gradeLevel,
    programCode,
    programName: program?.name || programCode,
    programType: program?.programTypeCode || null,
    sectionLabel,
    sectionName: formatSectionName(programCode, sectionLabel)
  };
}

async function findSectionCatalogRow({ gradeLevel, programCode, sectionLabel }) {
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
     WHERE grade_level = $1
       AND program_code = $2
       AND section_label = $3
     LIMIT 1`,
    [gradeLevel, programCode, sectionLabel]
  );

  return result.rows[0] || null;
}

async function getGradeLevelId(gradeLevel) {
  const result = await query(
    `SELECT id
     FROM grade_levels
     WHERE grade_level = $1
     LIMIT 1`,
    [gradeLevel]
  );

  const gradeLevelId = result.rows[0]?.id;
  if (!gradeLevelId) {
    throw notFound('Grade level catalog is not initialized');
  }

  return gradeLevelId;
}

async function getProgramId(programCode) {
  const result = await query(
    `SELECT id
     FROM academic_programs
     WHERE code = $1
     LIMIT 1`,
    [programCode]
  );

  const programId = result.rows[0]?.id;
  if (!programId) {
    throw notFound('Academic program catalog is not initialized');
  }

  return programId;
}

async function ensureSectionLabel(sectionLabel) {
  const existing = await query(
    `SELECT id
     FROM section_labels
     WHERE label = $1
     LIMIT 1`,
    [sectionLabel]
  );

  if (existing.rows.length) {
    return existing.rows[0].id;
  }

  const inserted = await query(
    `INSERT INTO section_labels (label, sort_order)
     VALUES ($1, $2)
     ON CONFLICT (label)
     DO UPDATE SET sort_order = LEAST(section_labels.sort_order, EXCLUDED.sort_order)
     RETURNING id`,
    [sectionLabel, computeSectionSortOrder(sectionLabel)]
  );

  return inserted.rows[0].id;
}

export async function getSectionCatalogRowById(sectionId) {
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
     WHERE id = $1
     LIMIT 1`,
    [parsePositiveInt(sectionId, 'sectionId')]
  );

  return result.rows[0] || null;
}

export async function resolveSectionId(payload = {}, { allowCreate = true } = {}) {
  const explicitSectionIdRaw = payload.sectionId;
  if (explicitSectionIdRaw !== undefined && explicitSectionIdRaw !== null && explicitSectionIdRaw !== '') {
    const existing = await getSectionCatalogRowById(explicitSectionIdRaw);
    if (!existing) {
      throw notFound('Section not found');
    }

    return existing.id;
  }

  const placement = parseAcademicPlacement(payload);
  if (!placement) {
    return null;
  }

  const existing = await findSectionCatalogRow(placement);
  if (existing) {
    return existing.id;
  }

  if (!allowCreate) {
    throw notFound('Section not found in the academic catalog');
  }

  const gradeLevelId = await getGradeLevelId(placement.gradeLevel);
  const programId = await getProgramId(placement.programCode);
  const sectionLabelId = await ensureSectionLabel(placement.sectionLabel);
  const adviser = optionalText(payload.adviser) || DEFAULT_ADVISER;

  const inserted = await query(
    `INSERT INTO sections (
      grade_level_id,
      program_id,
      section_label_id,
      adviser,
      updated_at
    )
    VALUES ($1, $2, $3, $4, now())
    ON CONFLICT (grade_level_id, program_id, section_label_id)
    DO UPDATE SET
      adviser = sections.adviser,
      updated_at = now()
    RETURNING id`,
    [gradeLevelId, programId, sectionLabelId, adviser]
  );

  return inserted.rows[0].id;
}

export async function upsertSectionCatalogEntry(payload = {}, { sectionId = null } = {}) {
  const placement = parseAcademicPlacement(payload, { requirePlacement: true });
  const adviser = optionalText(payload.adviser) || DEFAULT_ADVISER;
  const gradeLevelId = await getGradeLevelId(placement.gradeLevel);
  const programId = await getProgramId(placement.programCode);
  const sectionLabelId = await ensureSectionLabel(placement.sectionLabel);

  if (sectionId) {
    const normalizedSectionId = parsePositiveInt(sectionId, 'id');
    const result = await query(
      `UPDATE sections
       SET grade_level_id = $1,
           program_id = $2,
           section_label_id = $3,
           adviser = $4,
           updated_at = now()
       WHERE id = $5
       RETURNING id`,
      [gradeLevelId, programId, sectionLabelId, adviser, normalizedSectionId]
    );

    if (!result.rows.length) {
      throw notFound('Section not found');
    }

    return getSectionCatalogRowById(result.rows[0].id);
  }

  const inserted = await query(
    `INSERT INTO sections (
      grade_level_id,
      program_id,
      section_label_id,
      adviser,
      updated_at
    )
    VALUES ($1, $2, $3, $4, now())
    RETURNING id`,
    [gradeLevelId, programId, sectionLabelId, adviser]
  );

  return getSectionCatalogRowById(inserted.rows[0].id);
}
