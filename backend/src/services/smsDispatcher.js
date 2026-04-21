import { query } from '../db/client.js';
import { sendSms } from './smsProviders/iprogtech.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const POLL_MS = Number(env.DISPATCH_POLL_INTERVAL_MS || 5000);
const BATCH_SIZE = 10;
const MAX_RETRIES = Number(env.DISPATCH_MAX_RETRIES ?? 3);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePhoneNumber(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  // Accept 11-digit local format (e.g., 09171234567) or international with leading +63
  if (/^63\d{10}$/.test(digits)) return digits;
  if (/^\d{11}$/.test(digits)) return digits;
  return null;
}

async function resolvePhonesForRow(row) {
  const phones = [];

  if (row.student_id) {
    try {
      const res = await query(`SELECT parent_contact FROM students WHERE id = $1 LIMIT 1`, [row.student_id]);
      const parentContact = res.rows[0]?.parent_contact || null;
      const normalized = normalizePhoneNumber(parentContact);
      if (normalized) phones.push(normalized);
    } catch (err) {
      logger.warn('smsDispatcher.resolvePhonesForRow failed to read student contact', { id: row.id, error: err?.message });
    }
  }

  if (row.manual_phone_encrypted) {
    // For now, manual_phone_encrypted is treated as a plaintext list (commas/newlines).
    const raw = String(row.manual_phone_encrypted || '');
    const parts = raw.split(/[\n,]+/).map(p => p.trim()).filter(Boolean);
    for (const p of parts) {
      const n = normalizePhoneNumber(p);
      if (n) phones.push(n);
    }
  }

  return phones;
}

export async function processBatch() {
  // Avoid picking up rows created in the last couple seconds to prevent
  // race conditions with immediate-send (`sendNow`) requests which
  // insert then immediately attempt delivery. This small delay reduces
  // duplicate sends while keeping dispatch latency low.
  const rowsRes = await query(
    `SELECT ml.* FROM message_logs ml
     WHERE ml.message_status_id = (SELECT id FROM message_statuses WHERE code = 'queued' LIMIT 1)
       AND ml.created_at <= now() - interval '2 seconds'
     ORDER BY ml.created_at ASC
     LIMIT $1`,
    [BATCH_SIZE]
  );

  if (!rowsRes.rows.length) return 0;

  for (const row of rowsRes.rows) {
    const phones = await resolvePhonesForRow(row);
    if (!phones.length) {
      // No recipients found; mark as failed
      await query(
        `UPDATE message_logs SET message_status_id = (SELECT id FROM message_statuses WHERE code = 'failed' LIMIT 1), provider_response = $1 WHERE id = $2`,
        [JSON.stringify({ error: 'no_recipient_found' }), row.id]
      );
      continue;
    }

    for (const phone of phones) {
      try {
        const providerResp = await sendSms({ phone, message: row.message_text || '' });
        await query(
          `UPDATE message_logs
           SET provider_message_id = $1,
               provider_response = $2,
               delivered_at = now(),
               message_status_id = (SELECT id FROM message_statuses WHERE code = 'sent' LIMIT 1)
           WHERE id = $3`,
          [providerResp.providerMessageId, JSON.stringify(providerResp.raw || {}), row.id]
        );
      } catch (err) {
        logger.error('smsDispatcher failed to send', { id: row.id, phone, error: err?.message });
        const retryCount = (row.retry_count || 0) + 1;
        const shouldFail = retryCount > MAX_RETRIES;
        await query(
          `UPDATE message_logs
           SET retry_count = $1,
               provider_response = $2,
               message_status_id = (SELECT id FROM message_statuses WHERE code = $3 LIMIT 1)
           WHERE id = $4`,
          [
            retryCount,
            JSON.stringify({ error: err?.message || String(err) }),
            shouldFail ? 'failed' : 'queued',
            row.id
          ]
        );
      }
    }
  }

  return rowsRes.rows.length;
}

export async function startDispatcher() {
  logger.info('Starting SMS dispatcher', { pollMs: POLL_MS, batchSize: BATCH_SIZE });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const processed = await processBatch();
      if (processed === 0) await sleep(POLL_MS);
    } catch (err) {
      logger.error('smsDispatcher main loop error', { error: err?.message || String(err) });
      await sleep(POLL_MS);
    }
  }
}

export default startDispatcher;
