'use strict';

/**
 * Google sign-in:
 * 1) GIS ID token (needs GOOGLE_CLIENT_ID only) — preferred in the browser
 * 2) OAuth redirect code flow (needs CLIENT_ID + CLIENT_SECRET) — fallback
 */

const crypto = require('crypto');
const { logSecure, sanitizePlainText } = require('./security');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const STATE_TTL_MS = 10 * 60 * 1000;

/** @type {Map<string, { createdAt: number, next: string }>} */
const pendingStates = new Map();

function getClientId() {
  return String(process.env.GOOGLE_CLIENT_ID || '').trim();
}

function getClientSecret() {
  return String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
}

function isConfigured() {
  return Boolean(getClientId());
}

function hasSecret() {
  return Boolean(getClientId() && getClientSecret());
}

function publicConfig() {
  return {
    google: isConfigured(),
    clientId: getClientId() || null,
    redirect: hasSecret(),
  };
}

function redirectUri(origin) {
  const base = String(origin || process.env.OUGI_SITE_ORIGIN || 'http://127.0.0.1:5050').replace(
    /\/$/,
    ''
  );
  return `${base}/api/account/google/callback`;
}

function pruneStates() {
  const now = Date.now();
  for (const [k, v] of pendingStates) {
    if (!v || now - v.createdAt > STATE_TTL_MS) pendingStates.delete(k);
  }
}

function createState(nextPath) {
  pruneStates();
  const state = crypto.randomBytes(24).toString('hex');
  pendingStates.set(state, { createdAt: Date.now(), next: sanitizeNext(nextPath) });
  return state;
}

function consumeState(state) {
  pruneStates();
  const key = String(state || '');
  const row = pendingStates.get(key);
  pendingStates.delete(key);
  if (!row) return null;
  if (Date.now() - row.createdAt > STATE_TTL_MS) return null;
  return row;
}

function sanitizeNext(nextPath) {
  const raw = String(nextPath || 'pay.html').trim();
  if (!raw || raw.includes('://') || raw.startsWith('//') || raw.includes('\\')) {
    return 'pay.html';
  }
  if (!/^[a-zA-Z0-9._\-/?=&%]+$/.test(raw)) return 'pay.html';
  if (!raw.includes('.html')) return 'pay.html';
  return raw.slice(0, 200);
}

function buildAuthUrl(origin, nextPath) {
  if (!hasSecret()) {
    throw Object.assign(new Error('Google redirect sign-in is not configured.'), { statusCode: 503 });
  }
  const state = createState(nextPath);
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    access_type: 'online',
  });
  return { url: `${AUTH_URL}?${params}`, state };
}

async function exchangeCode(code, origin) {
  if (!hasSecret()) {
    throw Object.assign(new Error('Google sign-in is not configured.'), { statusCode: 503 });
  }
  const body = new URLSearchParams({
    code: String(code || ''),
    client_id: getClientId(),
    client_secret: getClientSecret(),
    redirect_uri: redirectUri(origin),
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    logSecure('google_token_exchange_failed', {
      result: 'fail',
      error: String(json.error || res.status),
    });
    throw Object.assign(new Error('Google sign-in failed.'), { statusCode: 401 });
  }
  return json;
}

async function fetchProfile(accessToken) {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.sub || !json.email) {
    logSecure('google_userinfo_failed', { result: 'fail', error: String(res.status) });
    throw Object.assign(new Error('Could not read Google profile.'), { statusCode: 401 });
  }
  if (json.email_verified === false) {
    throw Object.assign(new Error('Google email is not verified.'), { statusCode: 401 });
  }
  return {
    googleId: String(json.sub),
    email: String(json.email).toLowerCase(),
    name: sanitizePlainText(json.name || json.given_name || json.email.split('@')[0], 80),
  };
}

/**
 * Verify a Google Identity Services ID token (JWT) via Google tokeninfo.
 */
async function verifyIdToken(idToken) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Google sign-in is not configured.'), { statusCode: 503 });
  }
  const token = String(idToken || '').trim();
  if (!token || token.length > 4096) {
    throw Object.assign(new Error('Invalid Google token.'), { statusCode: 400 });
  }
  const res = await fetch(`${TOKENINFO_URL}?id_token=${encodeURIComponent(token)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.sub || !json.email) {
    logSecure('google_id_token_invalid', {
      result: 'fail',
      error: String(json.error || json.error_description || res.status),
    });
    throw Object.assign(new Error('Google sign-in failed.'), { statusCode: 401 });
  }
  const aud = String(json.aud || '');
  const clientId = getClientId();
  if (aud !== clientId) {
    logSecure('google_id_token_aud_mismatch', { result: 'fail' });
    throw Object.assign(new Error('Google sign-in failed.'), { statusCode: 401 });
  }
  if (String(json.email_verified) !== 'true' && json.email_verified !== true) {
    throw Object.assign(new Error('Google email is not verified.'), { statusCode: 401 });
  }
  return {
    googleId: String(json.sub),
    email: String(json.email).toLowerCase(),
    name: sanitizePlainText(json.name || json.given_name || json.email.split('@')[0], 80),
  };
}

module.exports = {
  isConfigured,
  hasSecret,
  publicConfig,
  getClientId,
  redirectUri,
  buildAuthUrl,
  consumeState,
  sanitizeNext,
  exchangeCode,
  fetchProfile,
  verifyIdToken,
};
