import { query } from '../src/db/client.js';

async function main() {
  try {
    const res = await query(
      `SELECT id, original_violation_id, deleted_at
       FROM archived_violations
       WHERE original_violation_id = $1
       LIMIT 10`,
      ['13411d37-f571-4a3b-a634-94d941585883']
    );
    console.log('archives:', res.rows);
    process.exit(0);
  } catch (err) {
    console.error('error checking archives', err?.message || err);
    console.error(err?.stack || 'no stack');
    process.exit(1);
  }
}

main();
