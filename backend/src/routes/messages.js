import crypto from 'crypto';
import { Router } from 'express';

import { query } from '../db/client.js';
import { requireAuth, requireWebsitePower } from '../middleware/auth.js';
import { badRequest, notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { sendSms } from '../services/smsProviders/iprogtech.js';

const router = Router();

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Converts optional values to normalized text/null values for DB writes.
// Connection: used by message create/update routes.
function optionalText(value) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

// Parses UUID references used by message log linkage fields.
// Connection: used for studentId and violationId validation.
function parseUuidOrNull(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalized = String(value).trim();
  if (!UUID_V4_REGEX.test(normalized)) {
    throw badRequest(`${fieldName} must be a valid UUID`);
  }

  return normalized;
}

// Resolves message type key using id or code.
// Connection: message creation endpoint writes normalized message_type_id.
async function resolveMessageTypeId(payload, fallbackCode = 'general_notice') {
  if (payload.messageTypeId !== undefined && payload.messageTypeId !== null && payload.messageTypeId !== '') {
    const parsed = Number.parseInt(String(payload.messageTypeId).trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw badRequest('messageTypeId must be a positive integer');
    }

    const result = await query(
      `SELECT id
       FROM message_types
       WHERE id = $1
       LIMIT 1`,
      [parsed]
    );

    if (!result.rows.length) {
      throw notFound('Message type not found');
    }

    return parsed;
  }

  const code = optionalText(payload.messageTypeCode) || fallbackCode;
  const result = await query(
    `SELECT id
     FROM message_types
     WHERE LOWER(code) = LOWER($1)
     LIMIT 1`,
    [code]
  );

  if (!result.rows.length) {
    throw notFound('Message type not found for provided messageTypeCode');
  }

  return result.rows[0].id;
}

// Resolves message delivery status using id or code.
// Connection: creation and status-update endpoints write normalized message_status_id.
async function resolveMessageStatusId(payload, fallbackCode = 'queued') {
  if (payload.messageStatusId !== undefined && payload.messageStatusId !== null && payload.messageStatusId !== '') {
    const parsed = Number.parseInt(String(payload.messageStatusId).trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw badRequest('messageStatusId must be a positive integer');
    }

    const result = await query(
      `SELECT id
       FROM message_statuses
       WHERE id = $1
       LIMIT 1`,
      [parsed]
    );

    if (!result.rows.length) {
      throw notFound('Message status not found');
    }

    return parsed;
  }

  const code = optionalText(payload.messageStatusCode) || fallbackCode;
  const result = await query(
    `SELECT id
     FROM message_statuses
     WHERE LOWER(code) = LOWER($1)
     LIMIT 1`,
    [code]
  );

  if (!result.rows.length) {
    throw notFound('Message status not found for provided messageStatusCode');
  }

  return result.rows[0].id;
}

// Creates deterministic message external ids for tracking.
// Connection: inserted into message_logs.message_id on create requests.
function generateMessageId() {
  return `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function normalizePhoneNumber(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (/^63\d{10}$/.test(digits)) return digits;
  if (/^\d{11}$/.test(digits)) return digits;
  return null;
}

// Provides reusable hydrated SQL query for message log list/detail responses.
// Connection: used by GET /api/messages endpoint.
function messageLogSelectSql(whereClause, orderClause = '') {
  return `
    SELECT
      ml.id,
      ml.message_id,
      COALESCE(ml.student_id, v.student_id) AS student_id,
      btrim(s.first_name || ' ' || COALESCE(s.middle_name || ' ', '') || s.last_name) AS student_name,
      ml.violation_id,
      o.code AS offense_code,
      o.description AS offense_description,
      ml.message_type_id,
      mt.code AS message_type_code,
      mt.label AS message_type_label,
      ml.message_status_id,
      ms.code AS message_status_code,
      ms.label AS message_status_label,
      ml.date_sent,
      ml.sender_account_id,
      a.full_name AS sender_name,
      a.role AS sender_role,
      ml.phone_hash,
      ml.manual_phone_encrypted,
      ml.error_detail,
      ml.message_text,
      ml.provider_message_id,
      ml.provider_response,
      ml.delivered_at,
      ml.retry_count,
      ml.created_at
    FROM message_logs ml
    LEFT JOIN violations v ON v.id = ml.violation_id
    LEFT JOIN students s ON s.id = COALESCE(ml.student_id, v.student_id)
    LEFT JOIN offenses o ON o.id = v.offense_id
    INNER JOIN message_types mt ON mt.id = ml.message_type_id
    INNER JOIN message_statuses ms ON ms.id = ml.message_status_id
    LEFT JOIN accounts a ON a.id = ml.sender_account_id
    ${whereClause}
    ${orderClause}
  `;
}

// Maps message log rows to API response contracts.
// Connection: used by list/create/status-update route responses.
function toMessageResponse(row) {
  return {
    id: row.id,
    messageId: row.message_id,
    studentId: row.student_id,
    studentName: row.student_name,
    violationId: row.violation_id,
    offenseCode: row.offense_code,
    offenseDescription: row.offense_description,
    messageType: {
      id: row.message_type_id,
      code: row.message_type_code,
      label: row.message_type_label
    },
    messageStatus: {
      id: row.message_status_id,
      code: row.message_status_code,
      label: row.message_status_label
    },
    dateSent: row.date_sent,
    sender: {
      accountId: row.sender_account_id,
      name: row.sender_name,
      role: row.sender_role
    },
    phoneHash: row.phone_hash,
    manualPhoneEncrypted: row.manual_phone_encrypted || null,
    messageText: row.message_text || null,
    errorDetail: row.error_detail,
    createdAt: row.created_at
  };
}

// Lists message logs with optional student/status/type filtering.
// Connection: message logs page -> /api/messages.
router.get('/', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const clauses = [];
    const params = [];

    if (req.query.studentId) {
      params.push(parseUuidOrNull(req.query.studentId, 'studentId'));
      clauses.push(`COALESCE(ml.student_id, v.student_id) = $${params.length}`);
    }

    if (req.query.violationId) {
      params.push(parseUuidOrNull(req.query.violationId, 'violationId'));
      clauses.push(`ml.violation_id = $${params.length}`);
    }

    if (req.query.messageTypeCode) {
      params.push(String(req.query.messageTypeCode).trim());
      clauses.push(`LOWER(mt.code) = LOWER($${params.length})`);
    }

    if (req.query.messageStatusCode) {
      params.push(String(req.query.messageStatusCode).trim());
      clauses.push(`LOWER(ms.code) = LOWER($${params.length})`);
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const result = await query(
      messageLogSelectSql(whereClause, 'ORDER BY ml.date_sent DESC, ml.created_at DESC'),
      params
    );

    res.status(200).json(result.rows.map(toMessageResponse));
  } catch (error) {
    logger.error('Error in POST /api/messages handler', {
      requestId: req.requestId || 'unknown',
      message: error?.message || null,
      stack: error?.stack || null,
      payload: typeof req.body === 'object' ? req.body : String(req.body || '')
    });
    try {
      const tmp = os.tmpdir();
      const out = {
        time: new Date().toISOString(),
        requestId: req.requestId || 'unknown',
        error: error?.message || null,
        stack: error?.stack || null,
        payload: typeof req.body === 'object' ? req.body : String(req.body || '')
      };
      fs.appendFileSync(path.join(tmp, 'sdms_message_errors.log'), JSON.stringify(out) + '\n');
    } catch (err) {
      logger.error('Failed to write sdms_message_errors.log', { message: err?.message || null });
    }
    next(error);
  }
});

// Creates a queued message-log entry (SMS dispatch integration point).
// Connection: messages compose/send action -> /api/messages.
router.post('/', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const payload = req.body || {};
    logger.info('POST /api/messages payload received', { requestId: req.requestId, keys: Object.keys(payload), previewOnly: payload.previewOnly });
    logger.info('POST /api/messages raw body snippet', { requestId: req.requestId, raw: String(req.rawBody || '').slice(0, 1000) });

    const studentId = parseUuidOrNull(payload.studentId, 'studentId');
    const violationId = parseUuidOrNull(payload.violationId, 'violationId');
    const phoneHash = optionalText(payload.phoneHash);
    const manualPhones = optionalText(payload.manualPhones || payload.manual_phone || payload.manual_phone_encrypted);
    const messageText = optionalText(payload.messageText || payload.message_text);
    const errorDetail = optionalText(payload.errorDetail);
    const previewOnly = payload.previewOnly === true || String(payload.previewOnly || '').toLowerCase() === 'true';

    // Allow preview-only requests even when no recipient is present.
    // For actual sends, require either studentId, violationId, or manualPhones.
    if (!previewOnly && !studentId && !violationId && !manualPhones) {
      throw badRequest('Provide either studentId, violationId, or manualPhones');
    }

    let storedStudentId = studentId;

    if (violationId) {
      const violationResult = await query(
        `SELECT id, student_id
         FROM violations
         WHERE id = $1
         LIMIT 1`,
        [violationId]
      );

      if (!violationResult.rows.length) {
        throw notFound('Violation not found');
      }

      if (studentId && studentId !== violationResult.rows[0].student_id) {
        throw badRequest('studentId does not match the provided violationId');
      }

      // Do not persist redundant student_id when violation_id already determines the student.
      storedStudentId = null;
    }

    if (storedStudentId) {
      const studentResult = await query(
        `SELECT id
         FROM students
         WHERE id = $1
         LIMIT 1`,
        [storedStudentId]
      );

      if (!studentResult.rows.length) {
        throw notFound('Student not found');
      }
    }

    const messageTypeId = await resolveMessageTypeId(payload, 'general_notice');
    const messageStatusId = await resolveMessageStatusId(payload, 'queued');
    logger.info('Resolved message type/status', { requestId: req.requestId, messageTypeId, messageStatusId });
    const messageId = generateMessageId();

    // Preview-only flow: return generated or provided message without inserting a queue row.
    if (previewOnly) {
      const preview = messageText || `School Discipline Notice:\n${payload.messageTypeCode || 'Notice'} for ${studentId || violationId || 'student'}.\n\nThis is a one-way message and replies are not monitored.`;
      return res.status(200).json({ message: preview });
    }

    const insertResult = await query(
      `INSERT INTO message_logs (
        message_id,
        student_id,
        violation_id,
        message_type_id,
        message_status_id,
        sender_account_id,
        phone_hash,
        error_detail,
        message_text,
        manual_phone_encrypted
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id`,
      [
        messageId,
        storedStudentId,
        violationId,
        messageTypeId,
        messageStatusId,
        req.user.id,
        phoneHash,
        errorDetail,
        messageText,
        manualPhones,
      ]
    );

    const createdResult = await query(
      messageLogSelectSql('WHERE ml.id = $1', 'LIMIT 1'),
      [insertResult.rows[0].id]
    );

    // If caller requested immediate delivery, attempt to send now rather than leaving it only in the queue.
    const createdRow = createdResult.rows[0];
    const sendNow = payload.sendNow === true || String(payload.sendNow || '').toLowerCase() === 'true';

    if (sendNow) {
      const phones = [];

      if (createdRow.student_id) {
        try {
          const pRes = await query(`SELECT parent_contact FROM students WHERE id = $1 LIMIT 1`, [createdRow.student_id]);
          const parentContact = pRes.rows[0]?.parent_contact || null;
          const normalized = normalizePhoneNumber(parentContact);
          if (normalized) phones.push(normalized);
        } catch (err) {
          logger.warn('Immediate send: failed to lookup student parent contact', { id: createdRow.id, error: err?.message });
        }
      }

      if (createdRow.manual_phone_encrypted) {
        const raw = String(createdRow.manual_phone_encrypted || '');
        const parts = raw.split(/[;,\n\r]+/).map(p => p.trim()).filter(Boolean);
        for (const p of parts) {
          const n = normalizePhoneNumber(p);
          if (n) phones.push(n);
        }
      }

      if (!phones.length) {
        await query(
          `UPDATE message_logs SET message_status_id = (SELECT id FROM message_statuses WHERE code = 'failed' LIMIT 1), provider_response = $1 WHERE id = $2`,
          [JSON.stringify({ error: 'no_recipient_found' }), createdRow.id]
        );

        const rehydrated = await query(messageLogSelectSql('WHERE ml.id = $1', 'LIMIT 1'), [createdRow.id]);
        return res.status(200).json(toMessageResponse(rehydrated.rows[0]));
      }

      let anySent = false;

      for (const phone of phones) {
        try {
          const providerResp = await sendSms({ phone, message: createdRow.message_text || '' });
          await query(
            `UPDATE message_logs
             SET provider_message_id = $1,
                 provider_response = $2,
                 delivered_at = now(),
                 message_status_id = (SELECT id FROM message_statuses WHERE code = 'sent' LIMIT 1)
             WHERE id = $3`,
            [providerResp.providerMessageId, JSON.stringify(providerResp.rawResponse || providerResp.raw || {}), createdRow.id]
          );
          anySent = true;
        } catch (err) {
          logger.error('Immediate send failed', { id: createdRow.id, phone, error: err?.message });
          await query(
            `UPDATE message_logs SET provider_response = $1, message_status_id = (SELECT id FROM message_statuses WHERE code = 'failed' LIMIT 1) WHERE id = $2`,
            [JSON.stringify({ error: err?.message || String(err) }), createdRow.id]
          );
        }
      }

      const final = await query(messageLogSelectSql('WHERE ml.id = $1', 'LIMIT 1'), [createdRow.id]);
      return res.status(anySent ? 200 : 500).json(toMessageResponse(final.rows[0]));
    }

    res.status(201).json(toMessageResponse(createdResult.rows[0]));
  } catch (error) {
    next(error);
  }
});

// Updates one message-log delivery status and optional error detail.
// Connection: SMS dispatch callback/update action -> /api/messages/:id/status.
router.patch('/:id/status', requireAuth, requireWebsitePower, async (req, res, next) => {
  try {
    const messageLogId = parseUuidOrNull(req.params.id, 'id');
    const payload = req.body || {};

    const statusId = await resolveMessageStatusId(payload, null);
    const errorDetail = payload.errorDetail !== undefined ? optionalText(payload.errorDetail) : undefined;

    const fields = [];
    const params = [];

    params.push(statusId);
    fields.push(`message_status_id = $${params.length}`);

    if (errorDetail !== undefined) {
      params.push(errorDetail);
      fields.push(`error_detail = $${params.length}`);
    }

    fields.push('date_sent = now()');

    params.push(messageLogId);

    const updateResult = await query(
      `UPDATE message_logs
       SET ${fields.join(', ')}
       WHERE id = $${params.length}
       RETURNING id`,
      params
    );

    if (!updateResult.rows.length) {
      throw notFound('Message log not found');
    }

    const hydratedResult = await query(
      messageLogSelectSql('WHERE ml.id = $1', 'LIMIT 1'),
      [messageLogId]
    );

    res.status(200).json(toMessageResponse(hydratedResult.rows[0]));
  } catch (error) {
    next(error);
  }
});

export default router;
