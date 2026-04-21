import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { query } from './client.js';
import { logger } from '../utils/logger.js';
import { SANCTION_ACTION_SEEDS, VIOLATION_POLICY_SEEDS } from './sanctionsPolicyData.js';
import {
  ACADEMIC_PROGRAM_SEEDS,
  ACADEMIC_PROGRAM_TYPE_CODES,
  DEFAULT_ADVISER,
  DEFAULT_SECTION_LABEL_SEEDS,
  GRADE_LEVEL_PROGRAM_SEEDS,
  SUPPORTED_GRADE_LEVELS,
  parseAcademicPlacement
} from '../services/sectionCatalog.js';

// Converts policy keys into deterministic offense codes for sanctions-engine mappings.
// Connection: violation_definitions.offense_id links to offenses.id by this generated code.
function toPolicyOffenseCode(policyKey) {
  const key = String(policyKey ?? '').trim().toLowerCase();
  return `sanctions_engine_${key}`;
}

// Seeds sanctions-engine reference and rule tables using deterministic upserts.
// Connection: called by runMigrations after base schema creation statements complete.
async function seedSanctionsEngineData() {
  for (const action of SANCTION_ACTION_SEEDS) {
    await query(
      `INSERT INTO sanction_actions (code, description)
       VALUES ($1, $2)
       ON CONFLICT (code)
       DO UPDATE SET description = EXCLUDED.description`,
      [action.code, action.description]
    );
  }

  // Seed canonical sanctions into the sanctions table (idempotent)
  for (const action of SANCTION_ACTION_SEEDS) {
    await query(
      `INSERT INTO sanctions (code, label, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (code)
       DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description`,
      [action.code, action.code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), action.description]
    );
  }

  for (const policy of VIOLATION_POLICY_SEEDS) {
    const offenseCode = toPolicyOffenseCode(policy.key);
    const offenseCategory = `Policy ${policy.category}`;

    const offenseResult = await query(
      `INSERT INTO offenses (code, category, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (code)
       DO UPDATE SET
         category = EXCLUDED.category,
         description = EXCLUDED.description
       RETURNING id`,
      [offenseCode, offenseCategory, policy.name]
    );

    const offenseId = offenseResult.rows[0]?.id;
    if (!offenseId) {
      continue;
    }

    const severity = policy.severity === 'MAJOR' ? 'MAJOR' : 'MINOR';
    const isEscalatable = policy.isEscalatable !== false;
    const violationType = policy.violationType || (isEscalatable ? 'PROGRESSIVE' : 'DIRECT_MAJOR');

    const definitionResult = await query(
      `INSERT INTO violation_definitions (
        name,
        category,
        severity,
        is_escalatable,
        offense_id,
        violation_type,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (name)
      DO UPDATE SET
        category = EXCLUDED.category,
        severity = EXCLUDED.severity,
        is_escalatable = EXCLUDED.is_escalatable,
        offense_id = EXCLUDED.offense_id,
        violation_type = EXCLUDED.violation_type,
        updated_at = now()
      RETURNING id`,
      [policy.name, policy.category, severity, isEscalatable, offenseId, violationType]
    );

    const violationId = definitionResult.rows[0]?.id;
    if (!violationId) {
      continue;
    }

    const levelEntries = Object.entries(policy.rules || {})
      .map(([rawLevel, rawActions]) => {
        const level = Number.parseInt(String(rawLevel), 10);
        const actions = Array.isArray(rawActions)
          ? rawActions
            .map((actionCode) => String(actionCode ?? '').trim().toUpperCase())
            .filter(Boolean)
          : [];

        return [level, actions];
      })
      .filter(([level, actions]) => Number.isFinite(level) && level >= 1 && level <= 3 && actions.length > 0)
      .sort((left, right) => left[0] - right[0]);

    if (!levelEntries.length) {
      continue;
    }

    const definedLevels = levelEntries.map(([level]) => level);

    await query(
      `DELETE FROM violation_rules
       WHERE violation_id = $1
         AND offense_level <> ALL($2::int[])`,
      [violationId, definedLevels]
    );

    for (const [offenseLevel, actionCodes] of levelEntries) {
      const ruleResult = await query(
        `INSERT INTO violation_rules (violation_id, offense_level, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (violation_id, offense_level)
         DO UPDATE SET updated_at = now()
         RETURNING id`,
        [violationId, offenseLevel]
      );

      const ruleId = ruleResult.rows[0]?.id;
      if (!ruleId) {
        continue;
      }

      for (let index = 0; index < actionCodes.length; index += 1) {
        await query(
          `INSERT INTO violation_rule_actions (rule_id, action_code, sequence_no)
           VALUES ($1, $2, $3)
           ON CONFLICT (rule_id, action_code)
           DO UPDATE SET sequence_no = EXCLUDED.sequence_no`,
          [ruleId, actionCodes[index], index + 1]
        );
      }

      await query(
        `DELETE FROM violation_rule_actions
         WHERE rule_id = $1
           AND action_code <> ALL($2::text[])`,
        [ruleId, actionCodes]
      );
    }
  }

  await query(
    `UPDATE violations v
     SET violation_definition_id = vd.id
     FROM violation_definitions vd
     WHERE v.violation_definition_id IS NULL
       AND vd.offense_id = v.offense_id`
  );

  // Backfill newly added severity and violation_type columns on violations
  await query(
    `UPDATE violations v
     SET severity = vd.severity
     FROM violation_definitions vd
     WHERE v.violation_definition_id IS NOT NULL
       AND v.severity IS NULL
       AND vd.id = v.violation_definition_id`
  );

  await query(
    `UPDATE violations v
     SET violation_type = vd.violation_type
     FROM violation_definitions vd
     WHERE v.violation_definition_id IS NOT NULL
       AND v.violation_type IS NULL
       AND vd.id = v.violation_definition_id`
  );
}

async function tableExists(tableName) {
  const result = await query(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = $1
    ) AS exists`,
    [tableName]
  );

  return result.rows[0]?.exists === true;
}

async function columnExists(tableName, columnName) {
  const result = await query(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = $2
    ) AS exists`,
    [tableName, columnName]
  );

  return result.rows[0]?.exists === true;
}

async function prepareAcademicSectionTables() {
  await query(`DROP VIEW IF EXISTS vw_student_discipline_profile`);
  await query(`DROP VIEW IF EXISTS vw_violation_predictions_enriched`);
  await query(`DROP VIEW IF EXISTS vw_sections_catalog`);

  const hasSectionsTable = await tableExists('sections');
  const hasNormalizedSectionsTable = hasSectionsTable && await columnExists('sections', 'grade_level_id');
  const hasLegacySectionsTable = await tableExists('sections_legacy');

  if (hasSectionsTable && !hasNormalizedSectionsTable) {
    if (hasLegacySectionsTable) {
      await query(`DROP TABLE sections CASCADE`);
    } else {
      await query(`ALTER TABLE sections RENAME TO sections_legacy`);
    }
  }

  if (await tableExists('students')) {
    await query(`ALTER TABLE students DROP CONSTRAINT IF EXISTS students_section_id_fkey`);
  }
}

async function seedAcademicStructure() {
  for (const gradeLevel of SUPPORTED_GRADE_LEVELS) {
    await query(
      `INSERT INTO grade_levels (grade_level)
       VALUES ($1)
       ON CONFLICT (grade_level) DO NOTHING`,
      [gradeLevel]
    );
  }

  for (const code of Object.values(ACADEMIC_PROGRAM_TYPE_CODES)) {
    await query(
      `INSERT INTO academic_program_types (code, label)
       VALUES ($1, $2)
       ON CONFLICT (code)
       DO UPDATE SET label = EXCLUDED.label`,
      [code, code.replace(/_/g, ' ')]
    );
  }

  for (const program of ACADEMIC_PROGRAM_SEEDS) {
    await query(
      `INSERT INTO academic_programs (
        code,
        name,
        program_type_id,
        section_display_prefix,
        section_display_separator,
        sort_order
      )
      SELECT
        $1,
        $2,
        apt.id,
        $3,
        $4,
        $5
      FROM academic_program_types apt
      WHERE apt.code = $6
      ON CONFLICT (code)
      DO UPDATE SET
        name = EXCLUDED.name,
        program_type_id = EXCLUDED.program_type_id,
        section_display_prefix = EXCLUDED.section_display_prefix,
        section_display_separator = EXCLUDED.section_display_separator,
        sort_order = EXCLUDED.sort_order`,
      [
        program.code,
        program.name,
        program.sectionDisplayPrefix,
        program.sectionDisplaySeparator,
        program.sortOrder,
        program.programTypeCode
      ]
    );
  }

  for (const mapping of GRADE_LEVEL_PROGRAM_SEEDS) {
    await query(
      `INSERT INTO grade_level_programs (grade_level_id, program_id)
       SELECT gl.id, ap.id
       FROM grade_levels gl
       INNER JOIN academic_programs ap ON ap.code = $2
       WHERE gl.grade_level = $1
       ON CONFLICT (grade_level_id, program_id) DO NOTHING`,
      [mapping.gradeLevel, mapping.programCode]
    );
  }

  for (const label of DEFAULT_SECTION_LABEL_SEEDS) {
    await query(
      `INSERT INTO section_labels (label, sort_order)
       VALUES ($1, $2)
       ON CONFLICT (label)
       DO UPDATE SET sort_order = LEAST(section_labels.sort_order, EXCLUDED.sort_order)`,
      [label.label, label.sortOrder]
    );
  }

  const gradeLevels = await query(`SELECT id, grade_level FROM grade_levels`);
  const programs = await query(`SELECT id, code FROM academic_programs`);
  const labels = await query(`SELECT id, label FROM section_labels`);

  const gradeLevelIdByValue = new Map(gradeLevels.rows.map((row) => [row.grade_level, row.id]));
  const programIdByCode = new Map(programs.rows.map((row) => [row.code, row.id]));
  const labelIdByValue = new Map(labels.rows.map((row) => [row.label, row.id]));

  const defaultAlphaLabels = ['A', 'B', 'C', 'D', 'E'];
  const defaultNumericLabelsByProgramCode = {
    STE: ['1', '2', '3'],
    SPA: ['1', '2'],
    SPJ: ['1', '2']
  };

  for (const gradeLevel of SUPPORTED_GRADE_LEVELS) {
    if (gradeLevel <= 10) {
      const regularProgramId = programIdByCode.get('REGULAR');
      for (const label of defaultAlphaLabels) {
        await query(
          `INSERT INTO sections (
            grade_level_id,
            program_id,
            section_label_id,
            adviser,
            updated_at
          )
          VALUES ($1, $2, $3, $4, now())
          ON CONFLICT (grade_level_id, program_id, section_label_id) DO NOTHING`,
          [
            gradeLevelIdByValue.get(gradeLevel),
            regularProgramId,
            labelIdByValue.get(label),
            DEFAULT_ADVISER
          ]
        );
      }

      for (const [programCode, labelsForProgram] of Object.entries(defaultNumericLabelsByProgramCode)) {
        for (const label of labelsForProgram) {
          await query(
            `INSERT INTO sections (
              grade_level_id,
              program_id,
              section_label_id,
              adviser,
              updated_at
            )
            VALUES ($1, $2, $3, $4, now())
            ON CONFLICT (grade_level_id, program_id, section_label_id) DO NOTHING`,
            [
              gradeLevelIdByValue.get(gradeLevel),
              programIdByCode.get(programCode),
              labelIdByValue.get(label),
              DEFAULT_ADVISER
            ]
          );
        }
      }
    } else {
      for (const programCode of ['STEM', 'ABM', 'HUMSS', 'GAS', 'HE']) {
        for (const label of defaultAlphaLabels) {
          await query(
            `INSERT INTO sections (
              grade_level_id,
              program_id,
              section_label_id,
              adviser,
              updated_at
            )
            VALUES ($1, $2, $3, $4, now())
            ON CONFLICT (grade_level_id, program_id, section_label_id) DO NOTHING`,
            [
              gradeLevelIdByValue.get(gradeLevel),
              programIdByCode.get(programCode),
              labelIdByValue.get(label),
              DEFAULT_ADVISER
            ]
          );
        }
      }
    }
  }
}

async function migrateLegacySectionsTable() {
  if (!await tableExists('sections_legacy')) {
    return;
  }

  if (!await tableExists('students')) {
    await query(`DROP TABLE sections_legacy`);
    return;
  }

  const legacyRows = await query(
    `SELECT id, grade_level, section_name, strand
     FROM sections_legacy`
  );

  for (const row of legacyRows.rows) {
    let mappedSectionId = null;

    try {
      const placement = parseAcademicPlacement({
        gradeLevel: row.grade_level,
        sectionName: row.section_name,
        strand: row.strand
      });

      if (placement) {
        const sectionResult = await query(
          `SELECT id
           FROM vw_sections_catalog
           WHERE grade_level = $1
             AND program_code = $2
             AND section_label = $3
           LIMIT 1`,
          [placement.gradeLevel, placement.programCode, placement.sectionLabel]
        );

        mappedSectionId = sectionResult.rows[0]?.id || null;
      }
    } catch {
      mappedSectionId = null;
    }

    if (mappedSectionId) {
      await query(
        `UPDATE students
         SET section_id = $1
         WHERE section_id = $2`,
        [mappedSectionId, row.id]
      );
    } else {
      await query(
        `UPDATE students
         SET section_id = NULL
         WHERE section_id = $1`,
        [row.id]
      );
    }
  }

  await query(`DROP TABLE sections_legacy`);
}

async function restoreStudentsSectionForeignKey() {
  if (!await tableExists('students')) {
    return;
  }

  await query(
    `UPDATE students s
     SET section_id = NULL
     WHERE s.section_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM sections sec
         WHERE sec.id = s.section_id
       )`
  );

  await query(`ALTER TABLE students DROP CONSTRAINT IF EXISTS students_section_id_fkey`);
  await query(
    `ALTER TABLE students
     ADD CONSTRAINT students_section_id_fkey
     FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL`
  );
}

// Executes idempotent schema creation for the new backend.
// Connection: run by `npm run migrate` and consumed by all domain routes.
export async function runMigrations() {
  await prepareAcademicSectionTables();

  const statements = [
    // Enables UUID generation used by most primary keys.
    `CREATE EXTENSION IF NOT EXISTS pgcrypto`,

    // Accounts table is consumed by auth and account-management routes.
    `CREATE TABLE IF NOT EXISTS accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name VARCHAR(160) NOT NULL,
      email VARCHAR(160) UNIQUE NOT NULL,
      username VARCHAR(80) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('Admin','Guidance','Student')),
      grade VARCHAR(32),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    // Role normalization step for compatibility with older Teacher data.
    // Connection: keeps role semantics aligned with new auth guards.
    `UPDATE accounts
     SET role = 'Guidance'
     WHERE role = 'Teacher'`,

    // Enforces the new role taxonomy after compatibility update.
    // Connection: guarantees DB-level role integrity for auth middleware.
    `ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_role_check`,
    `ALTER TABLE accounts
     ADD CONSTRAINT accounts_role_check
     CHECK (role IN ('Admin','Guidance','Student'))`,

    // Password reset token table supports /auth/request-reset and /auth/reset.
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id BIGSERIAL PRIMARY KEY,
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      token VARCHAR(128) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    // 3NF academic catalog tables.
    // Connection: sections is rebuilt around grade/program/label foreign keys.
    `CREATE TABLE IF NOT EXISTS grade_levels (
      id SERIAL PRIMARY KEY,
      grade_level INTEGER NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (grade_level BETWEEN 7 AND 12)
    )`,

    `CREATE TABLE IF NOT EXISTS academic_program_types (
      id SERIAL PRIMARY KEY,
      code VARCHAR(40) NOT NULL UNIQUE,
      label VARCHAR(80) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS academic_programs (
      id SERIAL PRIMARY KEY,
      code VARCHAR(40) NOT NULL UNIQUE,
      name VARCHAR(80) NOT NULL,
      program_type_id INTEGER NOT NULL REFERENCES academic_program_types(id) ON DELETE RESTRICT,
      section_display_prefix VARCHAR(40),
      section_display_separator VARCHAR(10) NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 100,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS grade_level_programs (
      id BIGSERIAL PRIMARY KEY,
      grade_level_id INTEGER NOT NULL REFERENCES grade_levels(id) ON DELETE CASCADE,
      program_id INTEGER NOT NULL REFERENCES academic_programs(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (grade_level_id, program_id)
    )`,

    `CREATE TABLE IF NOT EXISTS section_labels (
      id SERIAL PRIMARY KEY,
      label VARCHAR(20) NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 100,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    // 3NF section catalog: grade/program/section label define one assignable section row.
    // Connection: students.section_id -> sections.id.
    `CREATE TABLE IF NOT EXISTS sections (
      id SERIAL PRIMARY KEY,
      grade_level_id INTEGER NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
      program_id INTEGER NOT NULL REFERENCES academic_programs(id) ON DELETE RESTRICT,
      section_label_id INTEGER NOT NULL REFERENCES section_labels(id) ON DELETE RESTRICT,
      adviser TEXT NOT NULL DEFAULT 'Gemari',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (grade_level_id, program_id, section_label_id)
    )`,

    // 3NF student master table.
    // Connection: stores student identity/contact only; grade/program/section are derived via section_id.
    `CREATE TABLE IF NOT EXISTS students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id INTEGER GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
      lrn TEXT UNIQUE,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      birthdate DATE,
      parent_contact TEXT,
      section_id INTEGER,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    // Strict 3NF alignment: full_name must not be physically stored in students.
    // Connection: all routes/views compute full name from first/middle/last at query time.
    `ALTER TABLE students DROP COLUMN IF EXISTS full_name`,

    // 3NF offense dictionary table.
    // Connection: violations.offense_id references this table.
    `CREATE TABLE IF NOT EXISTS offenses (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      category TEXT,
      description TEXT NOT NULL
    )`,

    // Rule-based sanctions engine reference tables.
    // Connection: violation_definitions -> violation_rules -> violation_rule_actions.
    `DO $$
     BEGIN
       -- Create severity enum if it does not exist, or add MODERATE if missing.
       IF NOT EXISTS (
         SELECT 1
         FROM pg_type
         WHERE typname = 'violation_severity'
       ) THEN
         CREATE TYPE violation_severity AS ENUM ('MINOR', 'MODERATE', 'MAJOR');
       ELSE
         IF NOT EXISTS (
           SELECT 1 FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = 'violation_severity' AND e.enumlabel = 'MODERATE'
         ) THEN
           ALTER TYPE violation_severity ADD VALUE 'MODERATE';
         END IF;
       END IF;
     END
     $$`,

    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1
         FROM pg_type
         WHERE typname = 'violation_type'
       ) THEN
         CREATE TYPE violation_type AS ENUM ('PROGRESSIVE', 'DIRECT_MAJOR');
       END IF;
     END
     $$`,

    `CREATE TABLE IF NOT EXISTS sanction_actions (
      code TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (code = upper(code))
    )`,

    `CREATE TABLE IF NOT EXISTS violation_definitions (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category CHAR(1) NOT NULL,
      severity violation_severity NOT NULL,
      is_escalatable BOOLEAN NOT NULL DEFAULT TRUE,
      offense_id INTEGER UNIQUE REFERENCES offenses(id) ON DELETE RESTRICT,
      violation_type violation_type NOT NULL DEFAULT 'PROGRESSIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (category IN ('A', 'B', 'C', 'D'))
    )`,

    `ALTER TABLE violation_definitions ADD COLUMN IF NOT EXISTS severity violation_severity`,
    `ALTER TABLE violation_definitions ADD COLUMN IF NOT EXISTS is_escalatable BOOLEAN`,
    `ALTER TABLE violation_definitions ADD COLUMN IF NOT EXISTS offense_id INTEGER REFERENCES offenses(id) ON DELETE RESTRICT`,
    `ALTER TABLE violation_definitions ADD COLUMN IF NOT EXISTS violation_type violation_type`,
    `UPDATE violation_definitions
     SET severity = 'MINOR'
     WHERE severity IS NULL`,
    `UPDATE violation_definitions
     SET is_escalatable = TRUE
     WHERE is_escalatable IS NULL`,
    `UPDATE violation_definitions
     SET violation_type = 'PROGRESSIVE'
     WHERE violation_type IS NULL`,
    `ALTER TABLE violation_definitions ALTER COLUMN severity SET DEFAULT 'MINOR'`,
    `ALTER TABLE violation_definitions ALTER COLUMN severity SET NOT NULL`,
    `ALTER TABLE violation_definitions ALTER COLUMN is_escalatable SET DEFAULT TRUE`,
    `ALTER TABLE violation_definitions ALTER COLUMN is_escalatable SET NOT NULL`,
    `ALTER TABLE violation_definitions ALTER COLUMN violation_type SET DEFAULT 'PROGRESSIVE'`,
    `ALTER TABLE violation_definitions ALTER COLUMN violation_type SET NOT NULL`,

    `CREATE TABLE IF NOT EXISTS violation_rules (
      id BIGSERIAL PRIMARY KEY,
      violation_id INTEGER NOT NULL REFERENCES violation_definitions(id) ON DELETE CASCADE,
      offense_level INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (violation_id, offense_level),
      CHECK (offense_level BETWEEN 1 AND 3)
    )`,

    `CREATE TABLE IF NOT EXISTS violation_rule_actions (
      id BIGSERIAL PRIMARY KEY,
      rule_id BIGINT NOT NULL REFERENCES violation_rules(id) ON DELETE CASCADE,
      action_code TEXT NOT NULL REFERENCES sanction_actions(code) ON DELETE RESTRICT,
      sequence_no INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (rule_id, action_code),
      CHECK (sequence_no > 0)
    )`,

    // 3NF lookup tables for violation/appeal/message content domains.
    // Connection: all content tables reference these lookup keys instead of raw text.
    `CREATE TABLE IF NOT EXISTS violation_statuses (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS resolution_types (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS sanctions (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS appeal_statuses (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS message_types (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS message_statuses (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE TABLE IF NOT EXISTS predictive_models (
      id SERIAL PRIMARY KEY,
      model_version VARCHAR(120) UNIQUE NOT NULL,
      source_service VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    // Seed lookup values used by normalized content rows.
    // Connection: guarantees stable foreign-key targets for status/sanction/message mappings.
    `INSERT INTO violation_statuses (code, label)
     VALUES
       ('pending', 'Pending'),
       ('in_progress', 'In Progress'),
       ('appealed', 'Appealed'),
       ('resolved', 'Resolved'),
       ('dismissed', 'Dismissed')
     ON CONFLICT (code) DO NOTHING`,

    `INSERT INTO resolution_types (code, label)
     VALUES
       ('none', 'None'),
       ('warning', 'Warning'),
       ('parent_conference', 'Parent Conference'),
       ('guidance_counseling', 'Guidance Counseling'),
       ('suspension', 'Suspension'),
       ('expulsion', 'Expulsion'),
       ('other', 'Other')
     ON CONFLICT (code) DO NOTHING`,

    `INSERT INTO appeal_statuses (code, label)
     VALUES
       ('pending', 'Pending'),
       ('approved', 'Approved'),
       ('rejected', 'Rejected')
     ON CONFLICT (code) DO NOTHING`,

    `INSERT INTO message_types (code, label)
     VALUES
       ('warning_notice', 'Warning Notice'),
       ('minor_offense_notice', 'Minor Offense Notice'),
       ('major_offense_notice', 'Major Offense Notice'),
       ('suspension_notice', 'Suspension Notice'),
       ('general_notice', 'General Notice')
     ON CONFLICT (code) DO NOTHING`,

    `INSERT INTO message_statuses (code, label)
     VALUES
       ('queued', 'Queued'),
       ('sent', 'Sent'),
       ('failed', 'Failed')
     ON CONFLICT (code) DO NOTHING`,

    // 3NF violations fact table.
    // Connection: holds incident-level records; no student grade/strand/offense text duplication.
    `CREATE TABLE IF NOT EXISTS violations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      offense_id INTEGER NOT NULL REFERENCES offenses(id) ON DELETE RESTRICT,
      incident_date DATE NOT NULL,
      description TEXT,
      sanction TEXT,
      status TEXT,
      resolution TEXT,
      incident_notes TEXT,
      sanction_id INTEGER REFERENCES sanctions(id) ON DELETE SET NULL,
      status_id INTEGER REFERENCES violation_statuses(id) ON DELETE RESTRICT,
      resolution_id INTEGER REFERENCES resolution_types(id) ON DELETE SET NULL,
      evidence JSONB,
      repeat_count_at_insert INTEGER NOT NULL DEFAULT 1,
      remarks TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ
    )`,

    // Keeps reruns safe: legacy text columns may already be dropped after first normalization pass.
    // Connection: required by downstream UPDATE/INSERT normalization statements in this migration.
    `ALTER TABLE violations ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE violations ADD COLUMN IF NOT EXISTS sanction TEXT`,
    `ALTER TABLE violations ADD COLUMN IF NOT EXISTS status TEXT`,
    `ALTER TABLE violations ADD COLUMN IF NOT EXISTS resolution TEXT`,
    `ALTER TABLE violations ADD COLUMN IF NOT EXISTS violation_definition_id INTEGER REFERENCES violation_definitions(id) ON DELETE SET NULL`,
    `ALTER TABLE violations ADD COLUMN IF NOT EXISTS severity violation_severity`,
    `ALTER TABLE violations ADD COLUMN IF NOT EXISTS violation_type violation_type`,

    // Violation logs table used by sanctions engine progression tracking.
    // Connection: POST /api/violations/log writes one row per logged incident.
    `CREATE TABLE IF NOT EXISTS violation_logs (
      id BIGSERIAL PRIMARY KEY,
      student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      violation_id INTEGER NOT NULL REFERENCES violation_definitions(id) ON DELETE RESTRICT,
      violation_record_id UUID REFERENCES violations(id) ON DELETE SET NULL,
      offense_level INTEGER NOT NULL,
      logged_at DATE NOT NULL DEFAULT CURRENT_DATE,
      actions TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (offense_level BETWEEN 1 AND 3)
    )`,

    // Archived violations snapshot table for deleted/retired incidents.
    // Stores a JSONB payload for modelling while keeping lightweight indexed columns
    // for querying by student/offense/date.
    `CREATE TABLE IF NOT EXISTS archived_violations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      original_violation_id UUID,
      student_id UUID,
      offense_id INTEGER,
      sanction_id INTEGER,
      incident_date DATE,
      severity violation_severity,
      violation_type violation_type,
      deleted_by UUID REFERENCES accounts(id) ON DELETE SET NULL,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    `CREATE INDEX IF NOT EXISTS archived_violations_student_idx ON archived_violations (student_id)`,
    `CREATE INDEX IF NOT EXISTS archived_violations_offense_idx ON archived_violations (offense_id)`,
    `CREATE INDEX IF NOT EXISTS archived_violations_deleted_at_idx ON archived_violations (deleted_at)`,

    // Normalize legacy text content in violations into lookup foreign keys.
    // Connection: prepares strict 3NF columns used by future violations APIs.
    `UPDATE violations
     SET incident_notes = description
     WHERE incident_notes IS NULL
       AND description IS NOT NULL`,

    `INSERT INTO sanctions (code, label, description)
     SELECT DISTINCT
       lower(regexp_replace(trim(sanction), '[^a-zA-Z0-9]+', '_', 'g')) AS code,
       trim(sanction) AS label,
       trim(sanction) AS description
     FROM violations
     WHERE sanction IS NOT NULL
       AND trim(sanction) <> ''
     ON CONFLICT (code) DO NOTHING`,

    `UPDATE violations v
     SET sanction_id = s.id
     FROM sanctions s
     WHERE v.sanction_id IS NULL
       AND v.sanction IS NOT NULL
       AND trim(v.sanction) <> ''
       AND s.code = lower(regexp_replace(trim(v.sanction), '[^a-zA-Z0-9]+', '_', 'g'))`,

    `UPDATE violations v
     SET status_id = vs.id
     FROM violation_statuses vs
     WHERE v.status_id IS NULL
       AND vs.code = lower(regexp_replace(COALESCE(NULLIF(trim(v.status), ''), 'pending'), '[^a-zA-Z0-9]+', '_', 'g'))`,

    `UPDATE violations
     SET status_id = (
       SELECT id FROM violation_statuses WHERE code = 'pending' LIMIT 1
     )
     WHERE status_id IS NULL`,

    `UPDATE violations v
     SET resolution_id = rt.id
     FROM resolution_types rt
     WHERE v.resolution_id IS NULL
       AND v.resolution IS NOT NULL
       AND trim(v.resolution) <> ''
       AND rt.code = lower(regexp_replace(trim(v.resolution), '[^a-zA-Z0-9]+', '_', 'g'))`,

    `ALTER TABLE violations ALTER COLUMN status_id SET NOT NULL`,
    `ALTER TABLE violations DROP COLUMN IF EXISTS description`,
    `ALTER TABLE violations DROP COLUMN IF EXISTS sanction`,
    `ALTER TABLE violations DROP COLUMN IF EXISTS status`,
    `ALTER TABLE violations DROP COLUMN IF EXISTS resolution`,

    // Appeals workflow table linked to normalized students and violations.
    // Connection: appeal status is normalized via appeal_statuses.
    `CREATE TABLE IF NOT EXISTS appeals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      violation_id UUID REFERENCES violations(id) ON DELETE CASCADE,
      appeal_text TEXT NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'Pending',
      status_id INTEGER REFERENCES appeal_statuses(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    // Strict 3NF for appeals: student is derived via violation relationship, not stored redundantly.
    // Connection: routes join appeals -> violations -> students for all student attributes.
    `ALTER TABLE appeals DROP COLUMN IF EXISTS student_id`,
    `ALTER TABLE appeals ALTER COLUMN violation_id SET NOT NULL`,

    // Keeps reruns safe: appeal status text may already be dropped after first normalization pass.
    // Connection: required by appeal status_id backfill statement below.
    `ALTER TABLE appeals ADD COLUMN IF NOT EXISTS status VARCHAR(40)`,

    // Normalize legacy appeal status text to status_id key.
    // Connection: prevents free-text status drift.
    `UPDATE appeals a
     SET status_id = aps.id
     FROM appeal_statuses aps
     WHERE a.status_id IS NULL
       AND aps.code = lower(regexp_replace(COALESCE(NULLIF(trim(a.status), ''), 'pending'), '[^a-zA-Z0-9]+', '_', 'g'))`,

    `UPDATE appeals
     SET status_id = (
       SELECT id FROM appeal_statuses WHERE code = 'pending' LIMIT 1
     )
     WHERE status_id IS NULL`,

    `ALTER TABLE appeals ALTER COLUMN status_id SET NOT NULL`,
    `ALTER TABLE appeals DROP COLUMN IF EXISTS status`,

    // Appeal chat thread table used by appeal messaging views.
    `CREATE TABLE IF NOT EXISTS appeal_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      appeal_id UUID NOT NULL REFERENCES appeals(id) ON DELETE CASCADE,
      sender_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    // Remove sender_role duplication; role is derived from accounts table.
    // Connection: keeps appeal_messages in 3NF with no transitive role dependency.
    `ALTER TABLE appeal_messages DROP COLUMN IF EXISTS sender_role`,

    // Message log audit table for SMS dispatch tracking.
    // Connection: message_type/status are normalized using lookup tables.
    `CREATE TABLE IF NOT EXISTS message_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id TEXT NOT NULL,
      student_id UUID REFERENCES students(id) ON DELETE SET NULL,
      violation_id UUID REFERENCES violations(id) ON DELETE SET NULL,
      message_type TEXT,
      message_status TEXT,
      message_type_id INTEGER REFERENCES message_types(id) ON DELETE RESTRICT,
      message_status_id INTEGER REFERENCES message_statuses(id) ON DELETE RESTRICT,
      date_sent TIMESTAMPTZ NOT NULL DEFAULT now(),
      sender_account_id UUID,
      phone_hash TEXT,
      error_detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,

    // Strict linkage rule for message logs: either student_id OR violation_id, never both.
    // Connection: prevents transitive student duplication when violation_id already determines student.
    `UPDATE message_logs
     SET student_id = NULL
     WHERE violation_id IS NOT NULL
       AND student_id IS NOT NULL`,
    `ALTER TABLE message_logs DROP CONSTRAINT IF EXISTS message_logs_link_target_check`,
    `ALTER TABLE message_logs
     ADD CONSTRAINT message_logs_link_target_check
     CHECK (
       (violation_id IS NOT NULL AND student_id IS NULL)
       OR (violation_id IS NULL AND student_id IS NOT NULL)
       OR (manual_phone_encrypted IS NOT NULL AND trim(manual_phone_encrypted) <> '')
     )`,

    // Keeps reruns safe: legacy message text status/type columns may already be dropped after first normalization pass.
    // Connection: required by message status/type backfill statements below.
    `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS message_type TEXT`,
    `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS message_status TEXT`,
    `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS message_text TEXT`,
    `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS manual_phone_encrypted TEXT`,
    `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS provider_message_id TEXT`,
    `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS provider_response JSON`,
    `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ NULL`,
    `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0`,

    // Normalize legacy message type/status text into lookup keys.
    // Connection: prevents inconsistent status/type strings in logs.
    `UPDATE message_logs ml
     SET message_type_id = mt.id
     FROM message_types mt
     WHERE ml.message_type_id IS NULL
       AND ml.message_type IS NOT NULL
       AND trim(ml.message_type) <> ''
       AND mt.code = lower(regexp_replace(trim(ml.message_type), '[^a-zA-Z0-9]+', '_', 'g'))`,

    `UPDATE message_logs ml
     SET message_status_id = ms.id
     FROM message_statuses ms
     WHERE ml.message_status_id IS NULL
       AND ms.code = lower(regexp_replace(COALESCE(NULLIF(trim(ml.message_status), ''), 'queued'), '[^a-zA-Z0-9]+', '_', 'g'))`,

    `UPDATE message_logs
     SET message_status_id = (
       SELECT id FROM message_statuses WHERE code = 'queued' LIMIT 1
     )
     WHERE message_status_id IS NULL`,

    `ALTER TABLE message_logs ALTER COLUMN message_status_id SET NOT NULL`,
    `ALTER TABLE message_logs DROP COLUMN IF EXISTS student_name`,
    `ALTER TABLE message_logs DROP COLUMN IF EXISTS student_name_hash`,
    `ALTER TABLE message_logs DROP COLUMN IF EXISTS violation_type`,
    `ALTER TABLE message_logs DROP COLUMN IF EXISTS message_type`,
    `ALTER TABLE message_logs DROP COLUMN IF EXISTS message_status`,
    `ALTER TABLE message_logs DROP COLUMN IF EXISTS sender_name`,

    // Predictive inference persistence table for analytics and dashboards.
    // Connection: model metadata normalized through predictive_models.
    `CREATE TABLE IF NOT EXISTS violation_predictions (
      id BIGSERIAL PRIMARY KEY,
      violation_id UUID NOT NULL REFERENCES violations(id) ON DELETE CASCADE,
      student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      model_version VARCHAR(120) NOT NULL,
      source_service VARCHAR(255),
      model_id INTEGER REFERENCES predictive_models(id) ON DELETE RESTRICT,
      repeat_probability DOUBLE PRECISION NOT NULL CHECK (repeat_probability >= 0 AND repeat_probability <= 1),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (violation_id, model_version)
    )`,

    // Keeps reruns safe: legacy predictive metadata columns may already be dropped after first normalization pass.
    // Connection: required by predictive model_id backfill statements below.
    `ALTER TABLE violation_predictions ADD COLUMN IF NOT EXISTS student_id UUID`,
    `ALTER TABLE violation_predictions ADD COLUMN IF NOT EXISTS model_version VARCHAR(120)`,
    `ALTER TABLE violation_predictions ADD COLUMN IF NOT EXISTS source_service VARCHAR(255)`,

    // Normalize predictive model metadata from text into model_id key.
    // Connection: predictive analytics can join violation_predictions -> predictive_models.
    `INSERT INTO predictive_models (model_version, source_service)
     SELECT DISTINCT model_version, source_service
     FROM violation_predictions
     WHERE model_version IS NOT NULL
       AND trim(model_version) <> ''
     ON CONFLICT (model_version) DO NOTHING`,

    `INSERT INTO predictive_models (model_version, source_service)
     VALUES ('unknown', 'unknown')
     ON CONFLICT (model_version) DO NOTHING`,

    `UPDATE violation_predictions vp
     SET model_id = pm.id
     FROM predictive_models pm
     WHERE vp.model_id IS NULL
       AND pm.model_version = vp.model_version`,

    `UPDATE violation_predictions
     SET model_id = (
       SELECT id FROM predictive_models WHERE model_version = 'unknown' LIMIT 1
     )
     WHERE model_id IS NULL`,

    `ALTER TABLE violation_predictions DROP CONSTRAINT IF EXISTS violation_predictions_violation_id_model_version_key`,
    `ALTER TABLE violation_predictions DROP CONSTRAINT IF EXISTS violation_predictions_violation_id_model_id_key`,
    `ALTER TABLE violation_predictions ALTER COLUMN model_id SET NOT NULL`,
    `ALTER TABLE violation_predictions ADD CONSTRAINT violation_predictions_violation_id_model_id_key UNIQUE (violation_id, model_id)`,
    `ALTER TABLE violation_predictions DROP COLUMN IF EXISTS student_id`,
    `ALTER TABLE violation_predictions DROP COLUMN IF EXISTS model_version`,
    `ALTER TABLE violation_predictions DROP COLUMN IF EXISTS source_service`,

    // 3NF academic section catalog view used by routes that still need legacy-looking columns.
    // Connection: exposes grade_level/section_name/strand from normalized lookup tables.
    `CREATE OR REPLACE VIEW vw_sections_catalog AS
     SELECT
       sec.id,
       gl.grade_level,
       ap.code AS program_code,
       ap.name AS program_name,
       apt.code AS program_type,
       sl.label AS section_label,
       CASE
         WHEN COALESCE(ap.section_display_prefix, '') = '' THEN sl.label
         ELSE ap.section_display_prefix || ap.section_display_separator || sl.label
       END AS section_name,
       ap.name AS strand,
       sec.adviser,
       sec.created_at,
       sec.updated_at
     FROM sections sec
     INNER JOIN grade_levels gl ON gl.id = sec.grade_level_id
     INNER JOIN academic_programs ap ON ap.id = sec.program_id
     INNER JOIN academic_program_types apt ON apt.id = ap.program_type_id
     INNER JOIN section_labels sl ON sl.id = sec.section_label_id`,

    // 3NF read model view for required student profile fields.
    // Connection: students list/profile endpoints can consume this view to avoid repetitive joins.
    `CREATE OR REPLACE VIEW vw_student_discipline_profile AS
     SELECT
       s.id AS student_uuid,
       s.student_id,
       s.lrn,
       btrim(s.first_name || ' ' || COALESCE(s.middle_name || ' ', '') || s.last_name) AS name,
       s.birthdate,
       sec.grade_level AS grade,
       sec.section_name AS section,
       sec.strand,
       s.parent_contact,
       latest_violation.violation
     FROM students s
     LEFT JOIN vw_sections_catalog sec ON sec.id = s.section_id
     LEFT JOIN LATERAL (
       SELECT COALESCE(o.description, v.incident_notes) AS violation
       FROM violations v
       LEFT JOIN offenses o ON o.id = v.offense_id
       WHERE v.student_id = s.id
         AND v.active = TRUE
       ORDER BY v.incident_date DESC, v.created_at DESC
       LIMIT 1
     ) AS latest_violation ON TRUE`,

    // 3NF read model view for enriched predictive analytics without storing duplicated columns.
    // Connection: analytics endpoints can query this view instead of denormalized prediction columns.
    `CREATE OR REPLACE VIEW vw_violation_predictions_enriched AS
     SELECT
       vp.id,
       vp.violation_id,
       vp.repeat_probability,
       vp.created_at,
       pm.model_version,
       pm.source_service,
       v.incident_date,
       s.id AS student_id,
       sec.grade_level,
       sec.section_name,
       sec.strand,
       o.description AS offense_description
     FROM violation_predictions vp
     INNER JOIN predictive_models pm ON pm.id = vp.model_id
     INNER JOIN violations v ON v.id = vp.violation_id
     INNER JOIN students s ON s.id = v.student_id
     LEFT JOIN vw_sections_catalog sec ON sec.id = s.section_id
     LEFT JOIN offenses o ON o.id = v.offense_id`,

    // Core indexes to keep joins and list endpoints responsive.
    `CREATE INDEX IF NOT EXISTS idx_students_full_name_expr ON students (btrim(first_name || ' ' || COALESCE(middle_name || ' ', '') || last_name))`,
    `CREATE INDEX IF NOT EXISTS idx_students_section_id ON students (section_id)`,
    `CREATE INDEX IF NOT EXISTS idx_grade_level_programs_grade_program ON grade_level_programs (grade_level_id, program_id)`,
    `CREATE INDEX IF NOT EXISTS idx_academic_programs_type_sort ON academic_programs (program_type_id, sort_order, code)`,
    `CREATE INDEX IF NOT EXISTS idx_section_labels_sort ON section_labels (sort_order, label)`,
    `CREATE INDEX IF NOT EXISTS idx_sections_grade_program_label ON sections (grade_level_id, program_id, section_label_id)`,
    `CREATE INDEX IF NOT EXISTS idx_offenses_code ON offenses (code)`,
    `CREATE INDEX IF NOT EXISTS idx_violation_definitions_category ON violation_definitions (category)`,
    `CREATE INDEX IF NOT EXISTS idx_violation_definitions_severity ON violation_definitions (severity)`,
    `CREATE INDEX IF NOT EXISTS idx_violation_definitions_offense_id ON violation_definitions (offense_id)`,
    `CREATE INDEX IF NOT EXISTS idx_violation_rules_violation_level ON violation_rules (violation_id, offense_level)`,
    `CREATE INDEX IF NOT EXISTS idx_violation_rule_actions_rule_sequence ON violation_rule_actions (rule_id, sequence_no)`,
    `CREATE INDEX IF NOT EXISTS idx_violations_student_id ON violations (student_id)`,
    `CREATE INDEX IF NOT EXISTS idx_violations_offense_id ON violations (offense_id)`,
    `CREATE INDEX IF NOT EXISTS idx_violations_violation_definition_id ON violations (violation_definition_id)`,
    `CREATE INDEX IF NOT EXISTS idx_violations_incident_date ON violations (incident_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_violations_status_id ON violations (status_id)`,
    `CREATE INDEX IF NOT EXISTS idx_violation_logs_student_violation_date ON violation_logs (student_id, violation_id, logged_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_violation_logs_violation_record_id ON violation_logs (violation_record_id)`,
    `CREATE INDEX IF NOT EXISTS idx_message_logs_student_id ON message_logs (student_id)`,
    `CREATE INDEX IF NOT EXISTS idx_message_logs_message_status_id ON message_logs (message_status_id)`,
    `CREATE INDEX IF NOT EXISTS idx_message_logs_date_sent ON message_logs (date_sent DESC)`,
    `DROP INDEX IF EXISTS idx_sections_grade_section`,
    `DROP INDEX IF EXISTS idx_appeals_student_id`,
    `CREATE INDEX IF NOT EXISTS idx_appeals_violation_id ON appeals (violation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_appeals_status_id ON appeals (status_id)`,
    `CREATE INDEX IF NOT EXISTS idx_violation_predictions_model_id ON violation_predictions (model_id)`
  ];

  for (const statement of statements) {
    await query(statement);
  }

  await seedAcademicStructure();
  await migrateLegacySectionsTable();
  await restoreStudentsSectionForeignKey();
  await seedSanctionsEngineData();

  logger.info('Database migrations completed', {
    steps: statements.length,
    policySeedCount: VIOLATION_POLICY_SEEDS.length,
    actionSeedCount: SANCTION_ACTION_SEEDS.length
  });
}

const executedScriptUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (executedScriptUrl && import.meta.url === executedScriptUrl) {
  runMigrations()
    .then(() => {
      logger.info('Migration command finished successfully');
      process.exit(0);
    })
    .catch((error) => {
      // Log full stack for diagnostics (temporary)
      logger.error('Migration command failed', { message: error.message, stack: error.stack });
      // Also print stack to stderr so running `npm run migrate` shows the trace.
      console.error(error.stack);
      process.exit(1);
    });
}
