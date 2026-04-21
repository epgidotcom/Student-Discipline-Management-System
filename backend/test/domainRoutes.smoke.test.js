import test from 'node:test';
import assert from 'node:assert/strict';

// Provides required env defaults before loading backend modules.
// Connection: src/config/env.js validates these values at import time.
function seedTestEnv() {
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/sdms';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '';
}

// Verifies domain route modules can be imported without syntax/runtime errors.
// Connection: catches early regressions before deeper integration tests are added.
test('domain route modules compile', async () => {
  seedTestEnv();

  const appeals = await import('../src/routes/appeals.js');
  const analytics = await import('../src/routes/analytics.js');
  const messages = await import('../src/routes/messages.js');
  const settings = await import('../src/routes/settings.js');
  const students = await import('../src/routes/students.js');
  const offenses = await import('../src/routes/offenses.js');
  const violations = await import('../src/routes/violations.js');

  assert.equal(typeof appeals.default, 'function');
  assert.equal(typeof analytics.default, 'function');
  assert.equal(typeof messages.default, 'function');
  assert.equal(typeof settings.default, 'function');
  assert.equal(typeof students.default, 'function');
  assert.equal(typeof offenses.default, 'function');
  assert.equal(typeof violations.default, 'function');
});

// Verifies the app mounts all new domain routers under the expected API prefixes.
// Connection: frontend integration relies on these stable URL bases.
test('app mounts students/offenses/violations routes', async () => {
  seedTestEnv();

  const { default: app } = await import('../src/app.js');

  const mountPatterns = (app?._router?.stack || [])
    .filter((layer) => layer?.name === 'router')
    .map((layer) => String(layer.regexp));

  assert.ok(mountPatterns.includes('/^\\/api\\/students\\/?(?=\\/|$)/i'));
  assert.ok(mountPatterns.includes('/^\\/api\\/offenses\\/?(?=\\/|$)/i'));
  assert.ok(mountPatterns.includes('/^\\/api\\/violations\\/?(?=\\/|$)/i'));
  assert.ok(mountPatterns.includes('/^\\/api\\/appeals\\/?(?=\\/|$)/i'));
  assert.ok(mountPatterns.includes('/^\\/api\\/messages\\/?(?=\\/|$)/i'));
  assert.ok(mountPatterns.includes('/^\\/api\\/settings\\/?(?=\\/|$)/i'));
  assert.ok(mountPatterns.includes('/^\\/api\\/analytics\\/?(?=\\/|$)/i'));
});
