import { logger } from '../utils/logger.js';

// Archives a normalized violation payload and related snapshots into
// `archived_violations`. Expects a connected `client` (from getClient())
// so callers can control transaction boundaries.
//
// Parameters:
// - client: pooled pg client (client.query)
// - normalizedRow: object returned by `toViolationResponse()` for the row
// - meta: { deletedBy: <accountId> }
export async function archiveViolation(client, normalizedRow, meta = {}) {
  const deletedBy = meta.deletedBy || null;

  // Snapshot related violation_logs for modelling purposes.
  const logsRes = await client.query(
    `SELECT id, student_id, violation_id, violation_record_id, offense_level, logged_at, actions, created_at
     FROM violation_logs
     WHERE violation_record_id = $1`,
    [normalizedRow.id]
  );

  const payload = {
    violation: normalizedRow,
    violationLogs: Array.isArray(logsRes.rows) ? logsRes.rows : []
  };

  const insertSql = `INSERT INTO archived_violations (
      original_violation_id,
      student_id,
      offense_id,
      sanction_id,
      incident_date,
      severity,
      violation_type,
      deleted_by,
      payload
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`;

  const params = [
    normalizedRow.id || null,
    normalizedRow.studentId || null,
    normalizedRow.offenseId || null,
    normalizedRow.sanctionId || null,
    normalizedRow.incidentDate || null,
    normalizedRow.severity || null,
    normalizedRow.violationType || null,
    deletedBy,
    JSON.stringify(payload)
  ];

  const result = await client.query(insertSql, params);
  const archiveId = result.rows[0]?.id || null;

  logger.info('Archived violation', { originalId: normalizedRow.id, archiveId });
  return archiveId;
}

export default { archiveViolation };
