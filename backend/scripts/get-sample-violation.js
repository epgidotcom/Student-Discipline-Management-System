import { query } from '../src/db/client.js';

async function main() {
  try {
    const res = await query('SELECT id FROM violations LIMIT 5');
    console.log('sampleViolations:', res.rows.map(r => r.id));
    process.exit(0);
  } catch (err) {
    console.error('error fetching violations', err?.message || err);
    console.error(err?.stack || 'no stack');
    process.exit(1);
  }
}

main();
