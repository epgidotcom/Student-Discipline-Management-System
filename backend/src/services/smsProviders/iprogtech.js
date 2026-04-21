import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const ENDPOINT = 'https://sms.iprogtech.com/api/v1/sms_messages';

// Lightweight adapter for iProgTech SMS gateway.
// Usage: await sendSms({ phone: '09171234567', message: 'text' })
export async function sendSms({ phone, message } = {}) {
  const token = env.IPROG_API_TOKEN || process.env.IPROG_API_TOKEN;
  if (!token) {
    throw new Error('IPROG_API_TOKEN is not configured in environment');
  }

  const body = {
    api_token: token,
    phone_number: String(phone || '').trim(),
    message: String(message || '')
  };

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      const err = new Error(`iProgTech SMS request failed with status ${res.status}`);
      err.payload = json;
      throw err;
    }

    return {
      providerMessageId: json?.id || json?.message_id || json?.data?.id || null,
      rawResponse: json
    };
  } catch (err) {
    logger.error('iprogtech.sendSms failed', { error: err?.message || String(err) });
    throw err;
  }
}

