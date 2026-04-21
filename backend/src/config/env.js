import dotenv from 'dotenv';
import { z } from 'zod';

// Loads .env before any other module reads process.env.
// Connection: imported by server bootstrap and DB client modules.
const dotenvResult = dotenv.config();
const dotenvParsed = dotenvResult.parsed || {};

// Local .env values override inherited shell vars to avoid stale session collisions.
// Connection: keeps backend DB target consistent with backend/.env during local runs.
const mergedEnv = {
	...process.env,
	...dotenvParsed
};

// Validates all runtime config used by backend modules.
// Connection: values are consumed by src/server.js, src/app.js, src/db/client.js, and predictive integration.
const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	PORT: z.coerce.number().int().positive().default(3000),
	DATABASE_URL: z.string().optional(),
	DATABASE_URL_DEVELOPMENT: z.string().optional(),
	DATABASE_URL_STAGING: z.string().optional(),
	DATABASE_URL_PRODUCTION: z.string().optional(),
	TEST_DATABASE_URL: z.string().optional(),
	DATABASE_PROFILE: z.enum(['development', 'staging', 'production']).optional(),
	ALLOWED_ORIGINS: z.string().default(''),
	JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
	FRONTEND_BASE_URL: z.string().url().optional(),
	RECAPTCHA_SECRET: z.string().optional(),
	RECAPTCHA_ALLOW_INVALID_RESPONSE: z.string().optional(),
	GMAIL_USER: z.string().optional(),
	GMAIL_PASS: z.string().optional(),
	IPROG_API_TOKEN: z.string().optional(),
	ENCRYPTION_KEY: z.string().optional(),
	DISPATCH_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
	DISPATCH_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
	PREDICTIVE_SERVICE_URL: z.string().optional(),
	PREDICTIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
	PREDICTIVE_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1)
});

const parsed = envSchema.safeParse(mergedEnv);

if (!parsed.success) {
	const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
	throw new Error(`Invalid environment configuration\n${details.join('\n')}`);
}

const insecureJwtPlaceholders = new Set(['<your-strong-secret>', 'changeme', 'default', 'secret']);
const normalizedJwtSecret = String(parsed.data.JWT_SECRET || '').trim().toLowerCase();
const isProduction = parsed.data.NODE_ENV === 'production';
const allowInvalidRecaptchaInEnv = String(parsed.data.RECAPTCHA_ALLOW_INVALID_RESPONSE || '').trim().toLowerCase() === 'true';

if (isProduction && insecureJwtPlaceholders.has(normalizedJwtSecret)) {
	throw new Error('Invalid environment configuration\nJWT_SECRET must be replaced with a strong production secret.');
}

if (isProduction && allowInvalidRecaptchaInEnv) {
	throw new Error('Invalid environment configuration\nRECAPTCHA_ALLOW_INVALID_RESPONSE must be false in production.');
}

if (isProduction && !String(parsed.data.RECAPTCHA_SECRET || '').trim()) {
	throw new Error('Invalid environment configuration\nRECAPTCHA_SECRET is required in production.');
}

function nonEmpty(value) {
	const normalized = String(value ?? '').trim();
	return normalized.length ? normalized : null;
}

function resolveDatabaseUrl(config) {
	const explicitDatabaseUrl = nonEmpty(config.DATABASE_URL);
	if (explicitDatabaseUrl) {
		return explicitDatabaseUrl;
	}

	const profileFromNodeEnv = config.NODE_ENV === 'test' ? 'staging' : config.NODE_ENV;
	const activeProfile = config.DATABASE_PROFILE || profileFromNodeEnv;

	const profileToUrl = {
		development: nonEmpty(config.DATABASE_URL_DEVELOPMENT),
		staging: nonEmpty(config.DATABASE_URL_STAGING),
		production: nonEmpty(config.DATABASE_URL_PRODUCTION)
	};

	const profileDatabaseUrl = profileToUrl[activeProfile];
	if (profileDatabaseUrl) {
		return profileDatabaseUrl;
	}

	const legacyTestDatabaseUrl = nonEmpty(config.TEST_DATABASE_URL);
	if (legacyTestDatabaseUrl) {
		return legacyTestDatabaseUrl;
	}

	throw new Error(
		[
			'Invalid environment configuration',
			'DATABASE_URL is required, or configure DATABASE_URL_DEVELOPMENT/DATABASE_URL_STAGING/DATABASE_URL_PRODUCTION.',
			'Optional DATABASE_PROFILE selects one branch URL explicitly (development|staging|production).',
			'Legacy fallback TEST_DATABASE_URL is also accepted.'
		].join('\n')
	);
}

const resolvedDatabaseUrl = resolveDatabaseUrl(parsed.data);

const normalizedConfig = {
	...parsed.data,
	DATABASE_URL: resolvedDatabaseUrl
};

// Immutable env object used as the only source of runtime config.
export const env = Object.freeze(normalizedConfig);
