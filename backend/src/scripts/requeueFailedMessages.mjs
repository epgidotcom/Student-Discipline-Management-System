import { query } from '../db/client.js';

(async () => {
  try {
    // Requeue messages that failed within the last 24 hours.
    const res = await query(`
      UPDATE message_logs
      SET message_status_id = (SELECT id FROM message_statuses WHERE code = 'queued' LIMIT 1),
          provider_message_id = NULL,
          provider_response = NULL,
          retry_count = 0,
          error_detail = NULL
      WHERE message_status_id = (SELECT id FROM message_statuses WHERE code = 'failed' LIMIT 1)
        AND created_at >= now() - INTERVAL '24 hours'
      RETURNING id, message_id, manual_phone_encrypted, message_text
    `);

    console.log('Requeued rows:', res.rowCount);
    for (const r of res.rows) {
      console.log(r);
    }
    process.exit(0);
  } catch (err) {
    console.error('Requeue failed:', err?.message || String(err));
    process.exit(2);
  }
})();
