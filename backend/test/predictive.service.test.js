import test from 'node:test';
import assert from 'node:assert/strict';

// Provides minimum env required by config/env.js while importing service modules.
// Connection: backend module imports validate env at load time.
function seedTestEnv() {
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/sdms';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '';
}

// Verifies inference payload mapping from normalized violation rows.
// Connection: protects compatibility between violations route data and predictive service contract.
test('buildInferencePayload maps violation row fields', async () => {
  seedTestEnv();

  const { buildInferencePayload } = await import('../src/services/predictive.js');

  const payload = buildInferencePayload({
    offense_id: 12,
    offense_description: 'Bullying',
    sanction_label: 'Warning',
    evidence: { files: ['photo1.jpg'] },
    status_label: 'Pending',
    student_active: true,
    incident_date: '2026-04-09T00:00:00.000Z'
  });

  assert.equal(payload.offense_id, 12);
  assert.equal(payload.description, 'Bullying');
  assert.equal(payload.sanction, 'Warning');
  assert.equal(payload.evidence, 'present');
  assert.equal(payload.status, 'Pending');
  assert.equal(payload.active, 1);
  assert.equal(payload.incident_year, 2026);
  assert.equal(payload.incident_month, 4);
  assert.equal(payload.incident_day, 9);
  assert.equal(payload.incident_dayofweek, 4);
});
