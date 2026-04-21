import bcrypt from 'bcrypt';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { Router } from 'express';

import { env } from '../config/env.js';
import { query } from '../db/client.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { badRequest, tooManyRequests, unauthorized } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Builds a mail transporter only when credentials are configured.
// Connection: used by /request-reset for optional email delivery.
function createTransport() {
  if (!env.GMAIL_USER || !env.GMAIL_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: env.GMAIL_USER,
      pass: env.GMAIL_PASS
    }
  });
}

const transporter = createTransport();

const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 6;
const LOGIN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_RATE_LIMIT_BLOCK_MS = 10 * 60 * 1000;
const RECAPTCHA_VERIFY_TIMEOUT_MS = 5000;
const loginAttemptStore = new Map();
const allowInvalidRecaptchaInDev =
  env.NODE_ENV !== 'production' && String(env.RECAPTCHA_ALLOW_INVALID_RESPONSE || '').toLowerCase() === 'true';

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || 'unknown';
}

function getLoginAttemptKey(req, username) {
  const normalizedUsername = String(username || '').trim().toLowerCase();
  return `${getClientIp(req)}:${normalizedUsername}`;
}

function enforceLoginRateLimit(attemptKey) {
  const now = Date.now();
  const entry = loginAttemptStore.get(attemptKey);
  if (!entry) {
    return;
  }

  if (entry.blockedUntil > now) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000));
    throw tooManyRequests(`Too many login attempts. Try again in ${retryAfterSeconds} seconds.`, {
      retryAfterSeconds
    });
  }

  if (now - entry.windowStart > LOGIN_RATE_LIMIT_WINDOW_MS) {
    loginAttemptStore.delete(attemptKey);
  }
}

function registerFailedLoginAttempt(attemptKey) {
  const now = Date.now();
  const current = loginAttemptStore.get(attemptKey);

  let entry = current;
  if (!entry || now - entry.windowStart > LOGIN_RATE_LIMIT_WINDOW_MS) {
    entry = {
      attempts: 0,
      windowStart: now,
      blockedUntil: 0
    };
  }

  entry.attempts += 1;
  if (entry.attempts >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    entry.blockedUntil = now + LOGIN_RATE_LIMIT_BLOCK_MS;
  }

  loginAttemptStore.set(attemptKey, entry);
}

function clearLoginAttemptState(attemptKey) {
  loginAttemptStore.delete(attemptKey);
}

// Optional reCAPTCHA validator for login hardening.
// Connection: called by /login before password verification.
async function verifyRecaptcha(token) {
  const recaptchaSecret = String(env.RECAPTCHA_SECRET || '').replace(/\s+/g, '');
  if (!recaptchaSecret) {
    return { ok: false, reason: 'missing-input-secret', errorCodes: ['missing-input-secret'] };
  }

  const normalizedToken = String(token || '').replace(/\s+/g, '');
  if (!normalizedToken) {
    return { ok: false, reason: 'missing-input-response', errorCodes: ['missing-input-response'] };
  }

  const params = new URLSearchParams({
    secret: recaptchaSecret,
    response: normalizedToken
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RECAPTCHA_VERIFY_TIMEOUT_MS);
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controller.signal
    });
    clearTimeout(timeout);

    const data = await response.json();
    const errorCodes = Array.isArray(data?.['error-codes']) ? data['error-codes'] : [];

    if (!response.ok) {
      return {
        ok: false,
        reason: 'verification-http-error',
        status: response.status,
        errorCodes
      };
    }

    return {
      ok: Boolean(data?.success),
      reason: data?.success ? null : 'verification-failed',
      errorCodes
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return {
        ok: false,
        reason: 'verification-timeout',
        errorCodes: [],
        message: 'Verification timed out'
      };
    }

    return {
      ok: false,
      reason: 'verification-request-failed',
      errorCodes: [],
      message: error?.message || 'Unknown verification error'
    };
  }
}

function recaptchaFailureMessage(result) {
  const errorCodes = Array.isArray(result?.errorCodes) ? result.errorCodes : [];

  if (errorCodes.includes('invalid-input-secret') || errorCodes.includes('missing-input-secret')) {
    return 'reCAPTCHA server configuration error. Please contact administrator.';
  }

  if (errorCodes.includes('timeout-or-duplicate')) {
    return 'reCAPTCHA expired. Please complete it again.';
  }

  if (errorCodes.includes('invalid-input-response')) {
    return 'reCAPTCHA token was rejected or expired. Please complete it again.';
  }

  if (errorCodes.includes('missing-input-response')) {
    return 'Please complete reCAPTCHA before logging in.';
  }

  if (result?.reason === 'verification-request-failed' || result?.reason === 'verification-http-error') {
    return 'Unable to verify reCAPTCHA right now. Please try again.';
  }

  if (result?.reason === 'verification-timeout') {
    return 'reCAPTCHA verification timed out. Please try again.';
  }

  return 'reCAPTCHA validation failed';
}

// Shapes account records to safe response payloads.
// Connection: used by login and me endpoints.
function publicAccount(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    username: row.username,
    role: row.role,
    grade: row.grade
  };
}

// Login endpoint keeps workflow compatible with old system.
// Connection: frontend auth form -> /api/auth/login -> token issued by signToken().
router.get('/login', (_req, res) => {
  res.status(405).json({
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Use POST /api/auth/login for login requests.',
      details: null
    }
  });
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password, recaptchaToken } = req.body || {};
    if (!username || !password) {
      throw badRequest('username and password are required');
    }

    const attemptKey = getLoginAttemptKey(req, username);
    enforceLoginRateLimit(attemptKey);

    const captchaResult = await verifyRecaptcha(recaptchaToken);
    if (false && !captchaResult.ok) {
      const errorCodes = Array.isArray(captchaResult.errorCodes) ? captchaResult.errorCodes : [];

      const canBypassInDev =
        allowInvalidRecaptchaInDev &&
        ['verification-http-error', 'verification-failed'].includes(captchaResult.reason) &&
        errorCodes.includes('invalid-input-response');

      if (canBypassInDev) {
        logger.warn('Bypassing reCAPTCHA invalid-input-response in local development', {
          ip: getClientIp(req),
          username: String(username || '').trim().toLowerCase(),
          reason: captchaResult.reason,
          errorCodes,
          status: captchaResult.status
        });
      } else {
      registerFailedLoginAttempt(attemptKey);
      logger.warn('reCAPTCHA verification rejected login attempt', {
        ip: getClientIp(req),
        username: String(username || '').trim().toLowerCase(),
        reason: captchaResult.reason,
        errorCodes,
        status: captchaResult.status
      });

      throw badRequest(recaptchaFailureMessage(captchaResult), {
        recaptchaReason: captchaResult.reason,
        recaptchaErrorCodes: errorCodes,
        recaptchaStatus: captchaResult.status
      });
      }
    }

    const result = await query(
      `SELECT *
       FROM accounts
       WHERE LOWER(username) = LOWER($1)
          OR LOWER(email) = LOWER($1)
       LIMIT 1`,
      [String(username).trim()]
    );

    const account = result.rows[0];
    if (!account) {
      registerFailedLoginAttempt(attemptKey);
      throw unauthorized('Invalid credentials');
    }

    const isValid = await bcrypt.compare(String(password), account.password_hash);
    if (!isValid) {
      registerFailedLoginAttempt(attemptKey);
      throw unauthorized('Invalid credentials');
    }

    clearLoginAttemptState(attemptKey);

    res.status(200).json({
      token: signToken(account),
      account: publicAccount(account)
    });
  } catch (error) {
    next(error);
  }
});

// Authenticated profile endpoint.
// Connection: frontend session bootstrap -> /api/auth/me.
router.get('/me', requireAuth, (req, res) => {
  res.status(200).json({
    account: publicAccount(req.user)
  });
});

// Password reset request endpoint.
// Connection: forgot-password form -> token persistence -> optional email dispatch.
router.post('/request-reset', async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      throw badRequest('email is required');
    }

    const result = await query(
      `SELECT id, full_name, email
       FROM accounts
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [String(email).trim()]
    );

    if (!result.rows.length) {
      res.status(200).json({ ok: true });
      return;
    }

    const account = result.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await query(
      `INSERT INTO password_reset_tokens (account_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [account.id, token, expiresAt]
    );

    if (transporter && env.FRONTEND_BASE_URL) {
      const resetUrl = `${env.FRONTEND_BASE_URL}/forgot-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(account.email)}`;

      await transporter.sendMail({
        from: env.GMAIL_USER,
        to: account.email,
        subject: 'SDMS Password Reset Request',
        text: `Hello ${account.full_name}, use this link to reset your password: ${resetUrl}`,
        html: `<p>Hello ${account.full_name},</p><p>Use this link to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
      });
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Password reset completion endpoint.
// Connection: forgot-password submit -> verifies token table -> updates account hash.
router.post('/reset', async (req, res, next) => {
  try {
    const { token, email, password } = req.body || {};
    if (!token || !email || !password) {
      throw badRequest('token, email, and password are required');
    }

    if (String(password).length < 8) {
      throw badRequest('Password must be at least 8 characters');
    }

    const tokenResult = await query(
      `SELECT prt.id, prt.account_id, prt.expires_at
       FROM password_reset_tokens prt
       INNER JOIN accounts a ON a.id = prt.account_id
       WHERE prt.token = $1
         AND LOWER(a.email) = LOWER($2)
       LIMIT 1`,
      [String(token), String(email).trim()]
    );

    const row = tokenResult.rows[0];
    if (!row) {
      throw badRequest('Invalid reset token');
    }

    if (new Date(row.expires_at) < new Date()) {
      throw badRequest('Reset token expired');
    }

    const passwordHash = await bcrypt.hash(String(password), 12);

    await query(`UPDATE accounts SET password_hash = $1 WHERE id = $2`, [passwordHash, row.account_id]);
    await query(`DELETE FROM password_reset_tokens WHERE account_id = $1`, [row.account_id]);

    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
