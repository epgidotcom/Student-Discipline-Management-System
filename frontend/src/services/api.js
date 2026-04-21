import { optionalText } from '../utils/optionalText.js';

const AUTH_KEY = 'sdms_auth_v1';
const AUTH_LEGACY_KEYS = ['sdms_auth', 'sdms_auth_v0'];
const API_BASE_STORAGE_KEY = 'sdms:api-base';
export const AUTH_EXPIRED_EVENT = 'sdms:auth-expired';

function emitAuthExpired(reason = 'unauthorized') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { reason } }));
}

function parseStoredPayload(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isValidAuthPayload(payload) {
  const token = optionalText(payload?.token);
  if (!token) return false;
  if (!payload?.account || typeof payload.account !== 'object') return false;
  return true;
}

function normalizeAuthPayload(payload) {
  if (!isValidAuthPayload(payload)) return null;
  return {
    token: optionalText(payload.token),
    account: payload.account
  };
}

export function getAuthPayload() {
  const currentRaw = localStorage.getItem(AUTH_KEY);
  const current = parseStoredPayload(currentRaw);
  const normalizedCurrent = normalizeAuthPayload(current);
  if (normalizedCurrent) {
    return normalizedCurrent;
  }

  if (currentRaw) {
    localStorage.removeItem(AUTH_KEY);
  }

  for (const key of AUTH_LEGACY_KEYS) {
    const legacyRaw = localStorage.getItem(key);
    const legacyPayload = parseStoredPayload(legacyRaw);
    const normalizedLegacy = normalizeAuthPayload(legacyPayload);

    if (!normalizedLegacy) {
      if (legacyRaw) {
        localStorage.removeItem(key);
      }
      continue;
    }

    localStorage.setItem(AUTH_KEY, JSON.stringify(normalizedLegacy));
    localStorage.removeItem(key);
    return normalizedLegacy;
  }

  return null;
}

export function saveAuthPayload(payload) {
  const normalized = normalizeAuthPayload(payload);
  if (!normalized) {
    clearAuthPayload();
    return null;
  }

  localStorage.setItem(AUTH_KEY, JSON.stringify(normalized));
  for (const key of AUTH_LEGACY_KEYS) {
    localStorage.removeItem(key);
  }

  return normalized;
}

export function clearAuthPayload() {
  localStorage.removeItem(AUTH_KEY);
  for (const key of AUTH_LEGACY_KEYS) {
    localStorage.removeItem(key);
  }
}

function computeApiBase() {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  const origin = window.location.origin && window.location.origin !== 'null' ? window.location.origin : '';
  const localOrigins = ['localhost', '127.0.0.1'];
  const isFile = protocol === 'file:';

  const envBase = optionalText(import.meta.env.VITE_API_BASE);
  const storedBase = optionalText(localStorage.getItem(API_BASE_STORAGE_KEY));
  const preferredBase = envBase || storedBase;

  const fallbackRemote = 'https://web-based-student-discipline-management.onrender.com';
  const fallbackLocal = 'http://localhost:3000';

  if (preferredBase) {
    return preferredBase.replace(/\/+$/, '');
  }

  if (isFile) {
    return fallbackLocal;
  }

  if (origin) {
    return origin.replace(/\/+$/, '');
  }

  return fallbackRemote;
}

function getApiRoot() {
  const base = computeApiBase().replace(/\/+$/, '');
  const currentOrigin = window.location.origin && window.location.origin !== 'null' ? window.location.origin.replace(/\/+$/, '') : '';

  // When base matches current origin (local Vite dev or same-origin deploy), use relative API path.
  if (currentOrigin && base === currentOrigin) {
    return '/api';
  }

  return `${base}/api`;
}

export async function apiRequest(path, { method = 'GET', body, auth = true } = {}) {
  const token = optionalText(getAuthPayload()?.token);
  const headers = {
    Accept: 'application/json'
  };

  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  if (auth && !token) {
    clearAuthPayload();
    emitAuthExpired('missing-token');
    const error = new Error('Session expired. Please log in again.');
    error.status = 401;
    throw error;
  }

  if (auth && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${getApiRoot()}${path}`, {
      method,
      headers,
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined
    });
  } catch {
    const error = new Error(`Unable to reach backend at ${getApiRoot()}. Make sure SDMS backend is running.`);
    error.status = 0;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    if (auth && response.status === 401) {
      clearAuthPayload();
      emitAuthExpired('unauthorized');
    }

    let message = `Request failed with status ${response.status}`;

    if (typeof payload === 'string' && payload.trim()) {
      message = payload;
    } else if (typeof payload === 'object' && payload !== null) {
      const directMessage = typeof payload.message === 'string' ? payload.message : null;
      const nestedErrorMessage = typeof payload.error?.message === 'string' ? payload.error.message : null;
      const directError = typeof payload.error === 'string' ? payload.error : null;
      message = directMessage || nestedErrorMessage || directError || message;
    }

    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

/**
 * Convenience wrapper to send a message via the backend message queue.
 * body: { studentId?, violationId?, messageTypeCode?, messageText?, manualPhones?, previewOnly? }
 */
export async function sendMessage(body, options = {}) {
  return apiRequest('/messages', { method: 'POST', body, auth: options.auth !== false });
}
