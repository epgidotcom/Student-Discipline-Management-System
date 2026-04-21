import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';

// Loads .env early so branch-specific DB URLs can be selected for test execution.
// Connection: keeps integration DB target stable even when shell DATABASE_URL is stale.
const dotenvResult = dotenv.config();
const dotenvParsed = dotenvResult.parsed || {};

// Seeds minimum runtime env before importing backend modules.
// Connection: src/config/env.js validates these values at module load.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL =
  dotenvParsed.DATABASE_URL_STAGING ||
  dotenvParsed.DATABASE_URL_DEVELOPMENT ||
  dotenvParsed.DATABASE_URL_PRODUCTION ||
  dotenvParsed.DATABASE_URL ||
  dotenvParsed.TEST_DATABASE_URL ||
  process.env.DATABASE_URL_STAGING ||
  process.env.DATABASE_URL_DEVELOPMENT ||
  process.env.DATABASE_URL_PRODUCTION ||
  process.env.DATABASE_URL ||
  process.env.TEST_DATABASE_URL ||
  'postgresql://user:pass@localhost:5432/sdms';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '';

let app;
let query;
let runMigrations;
let closePool;
let signToken;

let server = null;
let baseUrl = null;
let dbReady = false;
let dbFailureReason = 'Database not initialized. Set DATABASE_URL_STAGING (or DATABASE_URL / TEST_DATABASE_URL) to a reachable Neon/PostgreSQL test database.';

// Starts HTTP server once for integration tests.
// Connection: all route integration checks call this server over fetch.
async function startServer() {
  if (server) {
    return;
  }

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}

// Stops HTTP server and DB pool after test suite execution.
// Connection: ensures clean shutdown between local and CI runs.
async function stopServer() {
  if (server) {
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
    server = null;
    baseUrl = null;
  }

  if (closePool) {
    await closePool();
  }
}

// Truncates mutable domain tables for deterministic integration tests.
// Connection: called before each test to isolate route behavior checks.
async function resetMutableTables() {
  await query(`
    TRUNCATE TABLE
      appeal_messages,
      appeals,
      message_logs,
      violation_logs,
      violation_rule_actions,
      violation_rules,
      violation_definitions,
      sanction_actions,
      violation_predictions,
      violations,
      students,
      sections,
      section_labels,
      grade_level_programs,
      academic_programs,
      academic_program_types,
      grade_levels,
      offenses,
      sanctions,
      accounts,
      password_reset_tokens
    RESTART IDENTITY CASCADE
  `);

  // Re-seed lookup rows in case test DB was previously modified.
  await runMigrations();
}

// Inserts one account row and returns a valid bearer token.
// Connection: route integration tests use this to exercise role guards.
async function createAccountWithToken({ role, fullName, email, username, grade = null }) {
  const insert = await query(
    `INSERT INTO accounts (full_name, email, username, password_hash, role, grade)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, full_name, email, username, role, grade`,
    [fullName, email, username, 'test-hash', role, grade]
  );

  const account = insert.rows[0];
  const token = signToken({
    id: account.id,
    role: account.role,
    username: account.username
  });

  return {
    account,
    token
  };
}

// Performs JSON HTTP requests against the test server.
// Connection: used by all integration cases to call live route handlers.
async function requestJson(path, { method = 'GET', token = null, body = null } = {}) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  return {
    status: response.status,
    data
  };
}

// Skips a test when the DB is not reachable/configured for integration execution.
// Connection: allows smoke/unit tests to pass without local PostgreSQL.
function skipIfDbUnavailable(t) {
  if (!dbReady) {
    t.skip(`Integration DB unavailable: ${dbFailureReason}`);
    return true;
  }
  return false;
}

before(async () => {
  const appModule = await import('../src/app.js');
  const dbModule = await import('../src/db/client.js');
  const migrateModule = await import('../src/db/migrate.js');
  const authModule = await import('../src/middleware/auth.js');

  app = appModule.default;
  query = dbModule.query;
  closePool = dbModule.closePool;
  runMigrations = migrateModule.runMigrations;
  signToken = authModule.signToken;

  try {
    await query('SELECT 1 AS ok');
    dbReady = true;
    await runMigrations();
    await startServer();
  } catch (error) {
    dbReady = false;
    const reason = String(error?.message || '').trim();
    dbFailureReason = reason || 'Unable to connect. Set DATABASE_URL_STAGING (or DATABASE_URL / TEST_DATABASE_URL) to a reachable Neon/PostgreSQL test database.';
  }
});

after(async () => {
  await stopServer();
});

// Verifies students/offenses/violations end-to-end creation flow with auth guards.
// Connection: ensures core discipline workflow contracts are DB-backed and operational.
test('core discipline workflow endpoints persist records', async (t) => {
  if (skipIfDbUnavailable(t)) return;

  await resetMutableTables();

  const { token } = await createAccountWithToken({
    role: 'Guidance',
    fullName: 'Guidance User',
    email: 'guidance@example.com',
    username: 'guidance.user'
  });

  const createdStudent = await requestJson('/api/students', {
    method: 'POST',
    token,
    body: {
      fullName: 'Juan Dela Cruz',
      lrn: '202600000001',
      gradeLevel: 11,
      sectionName: 'A',
      strand: 'STEM',
      parentContact: '+639111111111',
      birthdate: '2008-07-10'
    }
  });

  assert.equal(createdStudent.status, 201);
  assert.ok(createdStudent.data?.id);
  assert.equal(createdStudent.data?.fullName, 'Juan Dela Cruz');

  const createdOffense = await requestJson('/api/offenses', {
    method: 'POST',
    token,
    body: {
      code: 'bullying',
      category: 'Major',
      description: 'Bullying'
    }
  });

  assert.equal(createdOffense.status, 201);
  assert.ok(createdOffense.data?.id);

  const createdViolation = await requestJson('/api/violations', {
    method: 'POST',
    token,
    body: {
      studentId: createdStudent.data.id,
      offenseId: createdOffense.data.id,
      incidentDate: '2026-04-10',
      incidentNotes: 'Verbal harassment reported in class.',
      statusCode: 'pending',
      sanctionLabel: 'Warning',
      evidence: {
        files: ['evidence-1.jpg']
      }
    }
  });

  assert.equal(createdViolation.status, 201);
  assert.ok(createdViolation.data?.id);
  assert.equal(createdViolation.data?.offenseCode, 'bullying');
  assert.equal(createdViolation.data?.studentLrn, createdStudent.data?.lrn);
  assert.equal(createdViolation.data?.statusCode, 'pending');
  assert.equal(createdViolation.data?.gradeLevel, 11);
  assert.equal(createdViolation.data?.sectionName, 'A');
  assert.equal(createdViolation.data?.strand, 'STEM');

  const violationStatuses = await requestJson('/api/violations/statuses', {
    token
  });

  assert.equal(violationStatuses.status, 200);
  assert.equal(Array.isArray(violationStatuses.data), true);
  assert.ok(violationStatuses.data.some((statusRow) => statusRow.code === 'appealed'));

  const appealedViolation = await requestJson(`/api/violations/${createdViolation.data.id}/status`, {
    method: 'PATCH',
    token,
    body: {
      statusCode: 'appealed'
    }
  });

  assert.equal(appealedViolation.status, 200);
  assert.equal(appealedViolation.data?.statusCode, 'appealed');

  const resolvedViolation = await requestJson(`/api/violations/${createdViolation.data.id}/status`, {
    method: 'PATCH',
    token,
    body: {
      statusCode: 'resolved'
    }
  });

  assert.equal(resolvedViolation.status, 200);
  assert.equal(resolvedViolation.data?.statusCode, 'resolved');

  const appealedOnly = await requestJson('/api/violations?statusCode=appealed', {
    token
  });

  assert.equal(appealedOnly.status, 200);
  assert.equal(Array.isArray(appealedOnly.data?.data), true);
  assert.equal(appealedOnly.data.data.length, 0);

  const resolvedOnly = await requestJson('/api/violations?statusCode=resolved', {
    token
  });

  assert.equal(resolvedOnly.status, 200);
  assert.equal(Array.isArray(resolvedOnly.data?.data), true);
  assert.ok(resolvedOnly.data.data.some((row) => row.id === createdViolation.data.id));

  const filteredViolations = await requestJson('/api/violations?gradeLevel=11&sectionName=A&strand=STEM', {
    token
  });

  assert.equal(filteredViolations.status, 200);
  assert.equal(Array.isArray(filteredViolations.data?.data), true);
  assert.ok(filteredViolations.data.data.some((row) => row.id === createdViolation.data.id));

  const listViolations = await requestJson('/api/violations', {
    token
  });

  assert.equal(listViolations.status, 200);
  assert.equal(Array.isArray(listViolations.data?.data), true);
  assert.ok(listViolations.data.data.length >= 1);

  const deletedViolation = await requestJson(`/api/violations/${createdViolation.data.id}`, {
    method: 'DELETE',
    token
  });

  assert.equal(deletedViolation.status, 204);

  const listAfterDelete = await requestJson('/api/violations', {
    token
  });

  assert.equal(listAfterDelete.status, 200);
  assert.equal(Array.isArray(listAfterDelete.data?.data), true);
  assert.equal(listAfterDelete.data.data.some((row) => row.id === createdViolation.data.id), false);
});

// Verifies rule-based sanctions endpoint computes offense levels and mapped actions dynamically.
// Connection: validates POST /api/violations/log behavior for escalation and multi-action rules.
test('violations log endpoint computes offense-level sanctions from policy tables', async (t) => {
  if (skipIfDbUnavailable(t)) return;

  await resetMutableTables();

  const { token } = await createAccountWithToken({
    role: 'Guidance',
    fullName: 'Sanctions Engine User',
    email: 'sanctions.engine.user@example.com',
    username: 'sanctions.engine.user'
  });

  const studentRes = await requestJson('/api/students', {
    method: 'POST',
    token,
    body: {
      firstName: 'Ana',
      lastName: 'Policy',
      lrn: '202600000210',
      gradeLevel: 10,
      sectionName: 'A',
      strand: 'Regular'
    }
  });

  assert.equal(studentRes.status, 201);
  assert.ok(studentRes.data?.id);

  const legacyTardinessOffense = await requestJson('/api/offenses', {
    method: 'POST',
    token,
    body: {
      code: 'B2',
      category: 'Attendance & Punctuality',
      description: 'Habitual tardiness (frequently arriving late to classes within a week).'
    }
  });

  assert.equal(legacyTardinessOffense.status, 201);

  const legacyPreview = await requestJson('/api/violations/sanctions-preview', {
    method: 'POST',
    token,
    body: {
      studentId: studentRes.data.id,
      offenseId: legacyTardinessOffense.data.id
    }
  });

  assert.equal(legacyPreview.status, 200);
  assert.equal(legacyPreview.data?.sanctionDecision?.offenseLevel, 1);
  assert.equal(legacyPreview.data?.sanctionDecision?.violationName, 'Habitual tardiness reaching one week');
  assert.deepEqual(
    legacyPreview.data?.sanctionDecision?.actions?.map((entry) => entry.code),
    ['PARENT_CONFERENCE']
  );

  const cellphonePolicy = await query(
    `SELECT id
     FROM violation_definitions
     WHERE name = $1
     LIMIT 1`,
    ['Use of cellphone during class']
  );

  assert.equal(cellphonePolicy.rows.length, 1);
  const cellphoneDefinitionId = cellphonePolicy.rows[0].id;

  const previewBeforeCreate = await requestJson('/api/violations/sanctions-preview', {
    method: 'POST',
    token,
    body: {
      studentId: studentRes.data.id,
      violationDefinitionId: cellphoneDefinitionId
    }
  });

  assert.equal(previewBeforeCreate.status, 200);
  assert.equal(previewBeforeCreate.data?.sanctionDecision?.offenseLevel, 1);
  assert.equal(previewBeforeCreate.data?.suggestedSanction?.label, 'Warning');
  assert.equal(previewBeforeCreate.data?.suggestedSanction?.exists, false);

  const firstLog = await requestJson('/api/violations/log', {
    method: 'POST',
    token,
    body: {
      studentId: studentRes.data.id,
      violationDefinitionId: cellphoneDefinitionId,
      incidentDate: '2026-04-10',
      incidentNotes: 'Student used cellphone during discussion.'
    }
  });

  assert.equal(firstLog.status, 201);
  assert.equal(firstLog.data?.sanctionDecision?.offenseLevel, 1);
  assert.equal(firstLog.data?.sanctionDecision?.severity, 'MINOR');
  assert.deepEqual(
    firstLog.data?.sanctionDecision?.actions?.map((entry) => entry.code),
    ['WARNING']
  );
  assert.equal(firstLog.data?.violation?.repeatCountAtInsert, 1);
  assert.equal(firstLog.data?.violation?.sanctionLabel, 'Warning');
  assert.equal(firstLog.data?.violation?.sanctionCode, 'engine_warning');

  const secondLog = await requestJson('/api/violations/log', {
    method: 'POST',
    token,
    body: {
      studentId: studentRes.data.id,
      violationDefinitionId: cellphoneDefinitionId,
      incidentDate: '2026-04-11',
      incidentNotes: 'Repeated cellphone use during class activity.'
    }
  });

  assert.equal(secondLog.status, 201);
  assert.equal(secondLog.data?.sanctionDecision?.offenseLevel, 2);
  assert.deepEqual(
    secondLog.data?.sanctionDecision?.actions?.map((entry) => entry.code),
    ['CONFISCATION', 'PARENT_NOTIFICATION']
  );
  assert.equal(secondLog.data?.violation?.repeatCountAtInsert, 2);
  assert.equal(secondLog.data?.violation?.sanctionLabel, 'Confiscation + Parent Notification');
  assert.equal(secondLog.data?.violation?.sanctionCode, 'engine_confiscation__parent_notification');

  const thirdLog = await requestJson('/api/violations/log', {
    method: 'POST',
    token,
    body: {
      studentId: studentRes.data.id,
      violationDefinitionId: cellphoneDefinitionId,
      incidentDate: '2026-04-12',
      incidentNotes: 'Third cellphone incident within the quarter.'
    }
  });

  assert.equal(thirdLog.status, 201);
  assert.equal(thirdLog.data?.sanctionDecision?.offenseLevel, 3);
  assert.deepEqual(
    thirdLog.data?.sanctionDecision?.actions?.map((entry) => entry.code),
    ['COUNSELING']
  );
  assert.equal(thirdLog.data?.violation?.repeatCountAtInsert, 3);
  assert.equal(thirdLog.data?.violation?.sanctionLabel, 'Counseling');
  assert.equal(thirdLog.data?.violation?.sanctionCode, 'engine_counseling');

  const fourthLog = await requestJson('/api/violations/log', {
    method: 'POST',
    token,
    body: {
      studentId: studentRes.data.id,
      violationDefinitionId: cellphoneDefinitionId,
      incidentDate: '2026-04-13',
      incidentNotes: 'Fourth cellphone incident should remain at capped level.'
    }
  });

  assert.equal(fourthLog.status, 201);
  assert.equal(fourthLog.data?.sanctionDecision?.offenseLevel, 3);
  assert.deepEqual(
    fourthLog.data?.sanctionDecision?.actions?.map((entry) => entry.code),
    ['COUNSELING']
  );
  assert.equal(fourthLog.data?.violation?.repeatCountAtInsert, 3);
  assert.equal(fourthLog.data?.violation?.sanctionLabel, 'Counseling');
  assert.equal(fourthLog.data?.violation?.sanctionCode, 'engine_counseling');

  const accessoryPolicy = await query(
    `SELECT id
     FROM violation_definitions
     WHERE name = $1
     LIMIT 1`,
    ['Wearing dangerous accessories (spikes, metal buckles)']
  );

  assert.equal(accessoryPolicy.rows.length, 1);
  const accessoryDefinitionId = accessoryPolicy.rows[0].id;

  const accessoryStudentRes = await requestJson('/api/students', {
    method: 'POST',
    token,
    body: {
      firstName: 'Ben',
      lastName: 'Accessory',
      lrn: '202600000211',
      gradeLevel: 10,
      sectionName: 'A',
      strand: 'Regular'
    }
  });

  assert.equal(accessoryStudentRes.status, 201);

  const accessoryFirst = await requestJson('/api/violations/log', {
    method: 'POST',
    token,
    body: {
      studentId: accessoryStudentRes.data.id,
      violationDefinitionId: accessoryDefinitionId,
      incidentDate: '2026-04-10',
      incidentNotes: 'Dangerous accessory brought to school.'
    }
  });

  assert.equal(accessoryFirst.status, 201);
  assert.equal(accessoryFirst.data?.sanctionDecision?.offenseLevel, 1);
  assert.deepEqual(accessoryFirst.data?.sanctionDecision?.actions || [], []);
  assert.equal(accessoryFirst.data?.violation?.sanctionId, null);
  assert.equal(accessoryFirst.data?.violation?.sanctionLabel, null);

  await requestJson('/api/violations/log', {
    method: 'POST',
    token,
    body: {
      studentId: accessoryStudentRes.data.id,
      violationDefinitionId: accessoryDefinitionId,
      incidentDate: '2026-04-11',
      incidentNotes: 'Second dangerous accessory violation.'
    }
  });

  const accessoryThird = await requestJson('/api/violations/log', {
    method: 'POST',
    token,
    body: {
      studentId: accessoryStudentRes.data.id,
      violationDefinitionId: accessoryDefinitionId,
      incidentDate: '2026-04-12',
      incidentNotes: 'Third dangerous accessory violation.'
    }
  });

  assert.equal(accessoryThird.status, 201);
  assert.equal(accessoryThird.data?.sanctionDecision?.offenseLevel, 3);
  assert.deepEqual(
    accessoryThird.data?.sanctionDecision?.actions?.map((entry) => entry.code),
    ['SUSPENSION']
  );
});

// Verifies junior-high students default to Regular when no program is provided.
// Connection: single student form now resolves Grade 7-10 placements from the new catalog.
test('students create defaults junior-high students to Regular program', async (t) => {
  if (skipIfDbUnavailable(t)) return;

  await resetMutableTables();

  const { token } = await createAccountWithToken({
    role: 'Guidance',
    fullName: 'Grade Only Creator',
    email: 'grade.only.creator@example.com',
    username: 'grade.only.creator'
  });

  const createdStudent = await requestJson('/api/students', {
    method: 'POST',
    token,
    body: {
      firstName: 'Grade',
      lastName: 'Only',
      lrn: '202600000120',
      gradeLevel: 8,
      sectionName: 'A'
    }
  });

  assert.equal(createdStudent.status, 201);
  assert.equal(createdStudent.data?.gradeLevel, 8);
  assert.equal(createdStudent.data?.sectionName, 'A');
  assert.equal(createdStudent.data?.strand, 'Regular');
});

// Verifies special-program sections are accepted for Grades 7-10.
// Connection: new junior-high academic mechanics include STE/SPA/SPJ alongside Regular.
test('students create accepts special program section names', async (t) => {
  if (skipIfDbUnavailable(t)) return;

  await resetMutableTables();

  const { token } = await createAccountWithToken({
    role: 'Guidance',
    fullName: 'Special Program Creator',
    email: 'special.program.creator@example.com',
    username: 'special.program.creator'
  });

  const createdStudent = await requestJson('/api/students', {
    method: 'POST',
    token,
    body: {
      firstName: 'Special',
      lastName: 'Learner',
      lrn: '202600000122',
      gradeLevel: 9,
      sectionName: 'STE1'
    }
  });

  assert.equal(createdStudent.status, 201);
  assert.equal(createdStudent.data?.gradeLevel, 9);
  assert.equal(createdStudent.data?.sectionName, 'STE1');
  assert.equal(createdStudent.data?.strand, 'STE');
});

// Verifies hard-delete endpoint removes student row from DB.
// Connection: admin student UI delete action now uses DELETE /api/students/:studentRef.
test('students delete endpoint permanently removes student record', async (t) => {
  if (skipIfDbUnavailable(t)) return;

  await resetMutableTables();

  const { token } = await createAccountWithToken({
    role: 'Guidance',
    fullName: 'Delete Executor',
    email: 'delete.executor@example.com',
    username: 'delete.executor'
  });

  const createdStudent = await requestJson('/api/students', {
    method: 'POST',
    token,
    body: {
      firstName: 'Delete',
      lastName: 'Me',
      lrn: '202600000121',
      gradeLevel: 11,
      sectionName: 'A',
      strand: 'STEM'
    }
  });

  assert.equal(createdStudent.status, 201);
  assert.ok(createdStudent.data?.id);

  const statusLookup = await query(
    `SELECT id
     FROM message_statuses
     WHERE code = 'queued'
     LIMIT 1`
  );
  assert.equal(statusLookup.rows.length, 1);

  await query(
    `INSERT INTO message_logs (message_id, student_id, message_status_id, phone_hash)
     VALUES ($1, $2, $3, $4)`,
    ['delete-test-message', createdStudent.data.id, statusLookup.rows[0].id, 'hash_delete_test']
  );

  const deleted = await requestJson(`/api/students/${createdStudent.data.id}`, {
    method: 'DELETE',
    token
  });

  assert.equal(deleted.status, 204);

  const fetchDeleted = await requestJson(`/api/students/${createdStudent.data.id}`, {
    token
  });

  assert.equal(fetchDeleted.status, 404);

  const studentCount = await query(
    `SELECT COUNT(*)::int AS total
     FROM students
     WHERE id = $1`,
    [createdStudent.data.id]
  );
  assert.equal(studentCount.rows[0]?.total || 0, 0);

  const messageLogCount = await query(
    `SELECT COUNT(*)::int AS total
     FROM message_logs
     WHERE student_id = $1`,
    [createdStudent.data.id]
  );
  assert.equal(messageLogCount.rows[0]?.total || 0, 0);
});

// Verifies appeals/messages/settings/analytics routes with normalized schema relations.
// Connection: covers remaining backend modules required before predictive/frontend phases.
test('appeals messages settings analytics endpoints operate with guidance role', async (t) => {
  if (skipIfDbUnavailable(t)) return;

  await resetMutableTables();

  const { token } = await createAccountWithToken({
    role: 'Guidance',
    fullName: 'Guidance Reviewer',
    email: 'guidance.reviewer@example.com',
    username: 'guidance.reviewer'
  });

  const studentRes = await requestJson('/api/students', {
    method: 'POST',
    token,
    body: {
      firstName: 'Maria',
      lastName: 'Santos',
      lrn: '202600000002',
      gradeLevel: 12,
      sectionName: 'B',
      strand: 'ABM'
    }
  });

  assert.equal(studentRes.status, 201);

  const offenseRes = await requestJson('/api/offenses', {
    method: 'POST',
    token,
    body: {
      code: 'late_submission',
      category: 'Minor',
      description: 'Late submission'
    }
  });

  assert.equal(offenseRes.status, 201);

  const violationRes = await requestJson('/api/violations', {
    method: 'POST',
    token,
    body: {
      studentId: studentRes.data.id,
      offenseId: offenseRes.data.id,
      incidentDate: '2026-04-08',
      incidentNotes: 'Assignment submitted after deadline.'
    }
  });

  assert.equal(violationRes.status, 201);

  const otherStudentRes = await requestJson('/api/students', {
    method: 'POST',
    token,
    body: {
      firstName: 'Paolo',
      lastName: 'Reyes',
      lrn: '202600000003',
      gradeLevel: 11,
      sectionName: 'C',
      strand: 'HUMSS'
    }
  });

  assert.equal(otherStudentRes.status, 201);

  const mismatchedAppealRes = await requestJson('/api/appeals', {
    method: 'POST',
    token,
    body: {
      studentId: otherStudentRes.data.id,
      violationId: violationRes.data.id,
      appealText: 'This should fail because student does not match violation.'
    }
  });

  assert.equal(mismatchedAppealRes.status, 400);

  const appealRes = await requestJson('/api/appeals', {
    method: 'POST',
    token,
    body: {
      studentId: studentRes.data.id,
      violationId: violationRes.data.id,
      appealText: 'Requesting reconsideration due to emergency.'
    }
  });

  assert.equal(appealRes.status, 201);
  assert.ok(appealRes.data?.id);

  const appealMessageRes = await requestJson(`/api/appeals/${appealRes.data.id}/messages`, {
    method: 'POST',
    token,
    body: {
      content: 'Please submit supporting documents.'
    }
  });

  assert.equal(appealMessageRes.status, 201);

  const settingsSanctionRes = await requestJson('/api/settings/sanctions', {
    method: 'POST',
    token,
    body: {
      code: 'guidance_warning',
      label: 'Guidance Warning',
      description: 'Formal warning from guidance office.'
    }
  });

  assert.equal(settingsSanctionRes.status, 201);
  assert.equal(settingsSanctionRes.data?.code, 'guidance_warning');

  const messageLogRes = await requestJson('/api/messages', {
    method: 'POST',
    token,
    body: {
      studentId: studentRes.data.id,
      violationId: violationRes.data.id,
      messageTypeCode: 'warning_notice',
      messageStatusCode: 'queued',
      phoneHash: 'hash_abc123'
    }
  });

  assert.equal(messageLogRes.status, 201);
  assert.ok(messageLogRes.data?.id);

  const mismatchedMessageRes = await requestJson('/api/messages', {
    method: 'POST',
    token,
    body: {
      studentId: otherStudentRes.data.id,
      violationId: violationRes.data.id,
      messageTypeCode: 'warning_notice',
      messageStatusCode: 'queued',
      phoneHash: 'hash_bad_match'
    }
  });

  assert.equal(mismatchedMessageRes.status, 400);

  const analyticsRes = await requestJson('/api/analytics/overview', {
    token
  });

  assert.equal(analyticsRes.status, 200);
  assert.ok(analyticsRes.data?.students >= 1);
  assert.ok(analyticsRes.data?.violations >= 1);
});

// Verifies website-power role restrictions block Student users on admin routes.
// Connection: enforces RBAC guard expectation for backend-sensitive endpoints.
test('student role is blocked from website-power settings routes', async (t) => {
  if (skipIfDbUnavailable(t)) return;

  await resetMutableTables();

  const { token } = await createAccountWithToken({
    role: 'Student',
    fullName: 'Student User',
    email: 'student.user@example.com',
    username: 'student.user',
    grade: '11'
  });

  const response = await requestJson('/api/settings/sanctions', {
    token
  });

  assert.equal(response.status, 403);
  assert.equal(response.data?.error?.code, 'FORBIDDEN');
});

// Verifies batch student upload supports mixed row outcomes with a 207 summary.
// Connection: admin batch upload workflow depends on inserted/skipped/failed reporting.
test('students batch endpoint returns partial success summary for mixed rows', async (t) => {
  if (skipIfDbUnavailable(t)) return;

  await resetMutableTables();

  const { token } = await createAccountWithToken({
    role: 'Guidance',
    fullName: 'Batch Guidance',
    email: 'batch.guidance@example.com',
    username: 'batch.guidance'
  });

  const existingStudent = await requestJson('/api/students', {
    method: 'POST',
    token,
    body: {
      firstName: 'Existing',
      lastName: 'Student',
      lrn: '202600000900',
      gradeLevel: 11,
      sectionName: 'A',
      strand: 'STEM'
    }
  });

  assert.equal(existingStudent.status, 201);

  const batchResponse = await requestJson('/api/students/batch', {
    method: 'POST',
    token,
    body: {
      students: [
        {
          full_name: 'Batch Success',
          lrn: '202600000901',
          birthdate: '2008-02-01',
          grade: '11',
          section: 'A',
          strand: 'STEM',
          parent_contact: '09170000001'
        },
        {
          full_name: 'Batch Duplicate',
          lrn: '202600000900',
          birthdate: '2008-02-02',
          grade: '11',
          section: 'A',
          strand: 'STEM'
        },
        {
          full_name: 'Batch Invalid Date',
          lrn: '202600000902',
          birthdate: 'not-a-date',
          grade: '11',
          section: 'A',
          strand: 'STEM'
        }
      ]
    }
  });

  assert.equal(batchResponse.status, 207);
  assert.equal(batchResponse.data?.inserted, 1);
  assert.equal(batchResponse.data?.skipped, 1);
  assert.equal(batchResponse.data?.failed, 1);
  assert.equal(Array.isArray(batchResponse.data?.errors), true);
  assert.ok(batchResponse.data.errors.length >= 2);
});

// Verifies batch endpoint returns 400 when all rows fail validation.
// Connection: frontend uses this response to show row-level validation errors.
test('students batch endpoint returns 400 summary when all rows fail', async (t) => {
  if (skipIfDbUnavailable(t)) return;

  await resetMutableTables();

  const { token } = await createAccountWithToken({
    role: 'Guidance',
    fullName: 'Batch Validator',
    email: 'batch.validator@example.com',
    username: 'batch.validator'
  });

  const batchResponse = await requestJson('/api/students/batch', {
    method: 'POST',
    token,
    body: {
      students: [
        {
          full_name: 'No Grade Or Section'
        }
      ]
    }
  });

  assert.equal(batchResponse.status, 400);
  assert.equal(batchResponse.data?.inserted, 0);
  assert.equal(batchResponse.data?.failed, 1);
  assert.equal(Array.isArray(batchResponse.data?.errors), true);
  assert.ok(batchResponse.data.errors.length >= 1);
});

// Verifies batch endpoint returns 201 when all submitted rows are valid.
// Connection: frontend success path expects fully successful summary payload.
test('students batch endpoint returns 201 when all rows are inserted', async (t) => {
  if (skipIfDbUnavailable(t)) return;

  await resetMutableTables();

  const { token } = await createAccountWithToken({
    role: 'Guidance',
    fullName: 'Batch Success User',
    email: 'batch.success@example.com',
    username: 'batch.success'
  });

  const batchResponse = await requestJson('/api/students/batch', {
    method: 'POST',
    token,
    body: {
      students: [
        {
          full_name: 'All Good One',
          lrn: '202600000910',
          birthdate: '2008-03-01',
          grade: '11',
          section: 'A',
          strand: 'STEM',
          parent_contact: '09170000010'
        },
        {
          full_name: 'All Good Two',
          lrn: '202600000911',
          birthdate: '2008-03-02',
          grade: '11',
          section: 'A',
          strand: 'STEM',
          parent_contact: '09170000011'
        }
      ]
    }
  });

  assert.equal(batchResponse.status, 201);
  assert.equal(batchResponse.data?.inserted, 2);
  assert.equal(batchResponse.data?.skipped, 0);
  assert.equal(batchResponse.data?.failed, 0);
  assert.equal(Array.isArray(batchResponse.data?.details), true);
});

// Verifies batch endpoint rejects empty students arrays.
// Connection: prevents accidental blank batch submissions from UI.
test('students batch endpoint rejects empty students array', async (t) => {
  if (skipIfDbUnavailable(t)) return;

  await resetMutableTables();

  const { token } = await createAccountWithToken({
    role: 'Guidance',
    fullName: 'Batch Empty User',
    email: 'batch.empty@example.com',
    username: 'batch.empty'
  });

  const batchResponse = await requestJson('/api/students/batch', {
    method: 'POST',
    token,
    body: {
      students: []
    }
  });

  assert.equal(batchResponse.status, 400);
  assert.equal(batchResponse.data?.error?.code, 'BAD_REQUEST');
  assert.ok(String(batchResponse.data?.error?.message || '').includes('must not be empty'));
});

// Verifies batch endpoint enforces authentication before processing rows.
// Connection: frontend batch upload depends on consistent auth guard behavior.
test('students batch endpoint requires authentication', async (t) => {
  if (skipIfDbUnavailable(t)) return;

  await resetMutableTables();

  const response = await requestJson('/api/students/batch', {
    method: 'POST',
    body: {
      students: [
        {
          full_name: 'No Auth User',
          grade: '11',
          section: 'A',
          strand: 'STEM'
        }
      ]
    }
  });

  assert.equal(response.status, 401);
  assert.equal(response.data?.error?.code, 'UNAUTHORIZED');
});

// Verifies student-role users are blocked from batch upload actions.
// Connection: batch route must remain website-power only.
test('students batch endpoint blocks student role', async (t) => {
  if (skipIfDbUnavailable(t)) return;

  await resetMutableTables();

  const { token } = await createAccountWithToken({
    role: 'Student',
    fullName: 'Student Batch User',
    email: 'student.batch@example.com',
    username: 'student.batch',
    grade: '11'
  });

  const response = await requestJson('/api/students/batch', {
    method: 'POST',
    token,
    body: {
      students: [
        {
          full_name: 'Blocked User',
          grade: '11',
          section: 'A',
          strand: 'STEM'
        }
      ]
    }
  });

  assert.equal(response.status, 403);
  assert.equal(response.data?.error?.code, 'FORBIDDEN');
});

// Verifies defensive row-count cap for batch processing.
// Connection: protects backend throughput from oversized batch requests.
test('students batch endpoint rejects oversized payloads', async (t) => {
  if (skipIfDbUnavailable(t)) return;

  await resetMutableTables();

  const { token } = await createAccountWithToken({
    role: 'Guidance',
    fullName: 'Batch Cap Checker',
    email: 'batch.cap@example.com',
    username: 'batch.cap'
  });

  const oversizedRows = Array.from({ length: 1001 }, (_, index) => ({
    full_name: `Overflow Student ${index + 1}`,
    grade: '11',
    section: 'A',
    strand: 'STEM'
  }));

  const response = await requestJson('/api/students/batch', {
    method: 'POST',
    token,
    body: {
      students: oversizedRows
    }
  });

  assert.equal(response.status, 400);
  assert.ok(String(response.data?.error?.message || '').includes('must not exceed 1000'));
});
