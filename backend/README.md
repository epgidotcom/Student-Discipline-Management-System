# SDMS Backend (New Architecture)

This folder contains the new Node.js backend for SDMS.

## Current scaffold status

- Express bootstrap is ready in `src/app.js` and `src/server.js`.
- Runtime configuration validation is centralized in `src/config/env.js`.
- Logging and error flow are centralized in `src/utils/logger.js` and `src/utils/errors.js`.
- Middleware pipeline is in `src/middleware/`.
- Database client bootstrap is in `src/db/client.js`.
- Migration baseline is in `src/db/migrate.js`.
- Initial operational endpoints are in `src/routes/health.js`, `src/routes/auth.js`, and `src/routes/accounts.js`.
- Domain endpoints are now available in `src/routes/students.js`, `src/routes/offenses.js`, and `src/routes/violations.js`.
- Additional core backend endpoints are now available in `src/routes/appeals.js`, `src/routes/messages.js`, `src/routes/settings.js`, and `src/routes/analytics.js`.
- Predictive inference integration is implemented in `src/services/predictive.js` and triggered by violation create/update/status routes.
- Route smoke tests are in `test/domainRoutes.smoke.test.js`.
- Predictive payload mapping test is in `test/predictive.service.test.js`.
- Neon/PostgreSQL integration tests are in `test/backend.integration.test.js` (auto-skip when no DB is configured).

## Module connection map

- `src/server.js` -> `src/app.js` -> `src/routes/*` + `src/middleware/*`
- `src/server.js` + `src/db/client.js` -> `src/config/env.js`
- `src/app.js` + `src/middleware/errorHandler.js` -> `src/utils/logger.js`
- `src/routes/health.js` -> `src/db/client.js`
- `src/routes/auth.js` + `src/routes/accounts.js` -> `src/middleware/auth.js` -> `src/db/client.js`
- `src/routes/students.js` -> `src/middleware/auth.js` -> `src/db/client.js`
- `src/routes/offenses.js` -> `src/middleware/auth.js` -> `src/db/client.js`
- `src/routes/violations.js` -> `src/middleware/auth.js` -> `src/db/client.js`
- `src/routes/appeals.js` -> `src/middleware/auth.js` -> `src/db/client.js`
- `src/routes/messages.js` -> `src/middleware/auth.js` -> `src/db/client.js`
- `src/routes/settings.js` -> `src/middleware/auth.js` -> `src/db/client.js`
- `src/routes/analytics.js` -> `src/middleware/auth.js` -> `src/db/client.js`
- `src/routes/violations.js` -> `src/services/predictive.js` -> predictive FastAPI `/infer` -> normalized prediction tables
- `npm run migrate` -> `src/db/migrate.js` -> `src/db/client.js`
- `npm test` -> `test/domainRoutes.smoke.test.js` -> route/app imports
- `npm test` -> `test/predictive.service.test.js` -> predictive payload contract check

## Run

```bash
npm install
npm run dev
```

## Integration tests (Neon)

You can use branch-specific URLs instead of a dedicated test URL:

- `DATABASE_URL_DEVELOPMENT`
- `DATABASE_URL_STAGING`
- `DATABASE_URL_PRODUCTION`

Resolution order in `src/config/env.js` is:

1. `DATABASE_URL` (explicit override)
2. Branch URL selected by `DATABASE_PROFILE` (`development|staging|production`) or by `NODE_ENV` (`test` defaults to `staging`)
3. `TEST_DATABASE_URL` (legacy fallback)

For integration tests, define at least `DATABASE_URL_STAGING` (recommended) or `DATABASE_URL`.

Then run:

```bash
npm test
```

## Notes

- This scaffold is backend-first and contract-first.
- Auth, accounts, students, offenses, and violations scaffolds are implemented.
- Auth, accounts, students, offenses, violations, appeals, messages, settings, and analytics route scaffolds are implemented.
- Predictive-service wiring from violations routes is implemented but backend completion work remains focused on Neon-backed integration testing.
- Next step is full integration tests against a live Neon test database for end-to-end workflow validation.

## Rule-Based Sanctions Engine

The backend includes a data-driven sanctions engine designed for escalation-based discipline workflows.

### Core schema

- `violation_definitions`
	- canonical violation catalog (`A|B|C|D` category)
	- `severity` enum (`MINOR|MAJOR`)
	- `is_escalatable` policy switch
	- mapped to `offenses.id`
- `sanction_actions`
	- atomic sanction action dictionary (for example `WARNING`, `SUSPENSION`, `LEGAL_LIABILITY`)
- `violation_rules`
	- maps one violation definition to an `offense_level` (`1..3`)
- `violation_rule_actions`
	- many-to-many rule-to-action mapping (supports multiple actions per offense level)
- `violation_logs`
	- records sanctions-engine logging events (`student_id`, `violation_id`, `offense_level`, `logged_at`, action code array)

The existing `violations` table remains the source of incident records and now also carries `violation_definition_id` when available.

### Seed behavior

- Actions are seeded idempotently from `src/db/sanctionsPolicyData.js`.
- Violation definitions and 1st/2nd/3rd offense rules are seeded idempotently from the same policy file.
- Missing offense levels are intentionally left unmapped (no fallback sanctions are auto-generated).

### API endpoint

- `POST /api/violations/sanctions-preview`
	- Computes offense level and mapped actions without creating a violation row.
	- Returns `sanctionDecision` and `suggestedSanction` for frontend mapping preview.
- `POST /api/violations/log`
	- Computes offense level from prior records for the same student and violation definition.
	- Caps offense level at 3.
	- Fetches all mapped actions for the computed level.
	- Creates a `violations` incident record and a `violation_logs` row.
	- If no manual sanction is provided, auto-generates a deterministic sanction record from action codes and assigns `violations.sanction_id`.

Example request body:

```json
{
	"studentId": "550e8400-e29b-41d4-a716-446655440000",
	"violationDefinitionId": 12,
	"incidentDate": "2026-04-16",
	"incidentNotes": "Observed incident details."
}
```

Key response shape:

```json
{
	"violation": {
		"id": "...",
		"studentId": "...",
		"offenseId": 14,
		"violationDefinitionId": 12,
		"repeatCountAtInsert": 2
	},
	"sanctionDecision": {
		"violationDefinitionId": 12,
		"violationName": "Use of cellphone during class",
		"category": "A",
		"severity": "MINOR",
		"isEscalatable": true,
		"priorOffenseCount": 1,
		"offenseLevel": 2,
		"maxOffenseLevel": 3,
		"actions": [
			{ "code": "CONFISCATION", "description": "...", "sequence": 1 },
			{ "code": "PARENT_NOTIFICATION", "description": "...", "sequence": 2 }
		]
	}
}
```

### Dynamic sanctions query

The engine resolves sanctions from relational rules dynamically (not hardcoded). Core query pattern:

```sql
SELECT
	vr.id AS rule_id,
	vr.offense_level,
	vra.sequence_no,
	sa.code AS action_code,
	sa.description AS action_description
FROM violation_rules vr
LEFT JOIN violation_rule_actions vra ON vra.rule_id = vr.id
LEFT JOIN sanction_actions sa ON sa.code = vra.action_code
WHERE vr.violation_id = $1
	AND vr.offense_level = $2
ORDER BY vra.sequence_no ASC, sa.code ASC;
```

## SMS Dispatcher (one-way messages)

This backend includes a lightweight SMS dispatcher that polls queued message logs and sends messages via a configured SMS provider (iProgTech by default).

Environment variables (see `.env.example`):

- `IPROG_API_TOKEN` — API token for the iProgTech SMS gateway.
- `ENCRYPTION_KEY` — Optional symmetric key for encrypting manual phone entries (recommended).
- `DISPATCH_POLL_INTERVAL_MS` — How often the dispatcher polls for queued messages (default `5000`).
- `DISPATCH_MAX_RETRIES` — Number of retry attempts before marking a message as `failed` (default `3`).

Start the dispatcher locally with:

```bash
npm run sms:worker
```

In production, run the worker as a supervised process (PM2, systemd) and ensure `IPROG_API_TOKEN` and `ENCRYPTION_KEY` are set securely.
