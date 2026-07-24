const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { dataDir, dataFile } = require('../src/utils/data-paths');
const DATA = dataDir();
const SESSIONS_PATH = dataFile('admin-sessions.json');
const CSRF_PATH = dataFile('csrf-tokens.json');

const MAX_BODY = 32 * 1024; // 32KB
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h
const CSRF_TTL_MS = 2 * 60 * 60 * 1000;
const COOKIE_NAME = 'ougi_admin_sid';
const COOKIE_BUYER_TOKEN = 'ougi_buyer_tok';
const COOKIE_BUYER_THREAD = 'ougi_buyer_tid';
const AUDIT_PATH = dataFile('security-audit.log');
const RATE = new Map(); // key -> { count, reset }

const COMMON_PASSWORDS = new Set(
  [
    'password',
    'password123',
    'password1234',
    '12345678',
    '123456789',
    '1234567890',
    'qwerty123',
    'letmein',
    'admin',
    'admin123',
    'welcome1',
    'monkey123',
    'dragon123',
    'ougi-admin-change-me',
    'changeme',
    'changeme123',
  ].map((s) => s.toLowerCase())
);

const DANGEROUS_UPLOAD_EXTS = new Set([
  '.exe',
  '.dll',
  '.bat',
  '.cmd',
  '.php',
  '.js',
  '.mjs',
  '.cjs',
  '.jar',
  '.sh',
  '.ps1',
  '.vbs',
  '.scr',
  '.com',
  '.msi',
  '.wasm',
]);


function ensureData() {
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
}

function loadJson(file, fallback) {
  ensureData();
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.log(
      `[security] ${JSON.stringify({
        ts: new Date().toISOString(),
        action: 'json_parse_failed',
        result: 'fail',
        file: path.basename(file),
        error: err.code || 'parse_error',
      })}`
    );
    return fallback;
  }
}

function saveJson(file, data) {
  ensureData();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length !== bb.length) {
    // still compare to reduce timing signal on length
    crypto.timingSafeEqual(aa, aa);
    return false;
  }
  return crypto.timingSafeEqual(aa, bb);
}

/** Escape text for safe HTML insertion */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizePlainText(s, max = 1000) {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, max);
}

function isValidDiscordName(s) {
  const v = sanitizePlainText(s, 64);
  // Discord usernames: 2-32 typically; allow display-ish names
  return /^[a-zA-Z0-9._\-\s]{2,64}$/.test(v);
}

function isValidEmail(s) {
  const v = sanitizePlainText(s, 120).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 120;
}

function isValidThreadId(s) {
  return /^[a-f0-9]{8,32}$/i.test(String(s || ''));
}

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.socket.remoteAddress || 'unknown';
}

function rateLimit(key, { limit = 30, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const row = RATE.get(key);
  if (!row || now > row.reset) {
    RATE.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }
  row.count += 1;
  if (row.count > limit) return { ok: false, remaining: 0, retryAfterMs: row.reset - now };
  return { ok: true, remaining: limit - row.count };
}

function securityHeaders(res, { isAdminPage = false } = {}) {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self' https://formsubmit.co",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: https:",
    "font-src 'self' https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
    // Stripe.js + Google Identity Services
    "script-src 'self' https://js.stripe.com https://accounts.google.com https://apis.google.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com https://accounts.google.com",
    "connect-src 'self' https://api.stripe.com https://formsubmit.co https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com",
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-XSS-Protection', '0'); // rely on CSP; legacy header can cause issues

  if (process.env.OUGI_FORCE_HTTPS === '1') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  if (isAdminPage) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
  }
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function setCookie(res, name, value, { maxAgeSec, httpOnly = true, sameSite = 'Strict', path: cookiePath = '/' } = {}) {
  const secure = process.env.OUGI_FORCE_HTTPS === '1' || process.env.NODE_ENV === 'production';
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${cookiePath}`,
    `SameSite=${sameSite}`,
  ];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (maxAgeSec != null) parts.push(`Max-Age=${maxAgeSec}`);
  const prev = res.getHeader('Set-Cookie');
  const next = parts.join('; ');
  if (!prev) res.setHeader('Set-Cookie', next);
  else if (Array.isArray(prev)) res.setHeader('Set-Cookie', [...prev, next]);
  else res.setHeader('Set-Cookie', [prev, next]);
}

function clearCookie(res, name, cookiePath = '/') {
  setCookie(res, name, '', { maxAgeSec: 0, path: cookiePath });
}

function setBuyerCookies(res, { threadId, buyerToken }) {
  // Scope chat cookies to API paths to reduce CSRF surface on static pages
  setCookie(res, COOKIE_BUYER_TOKEN, buyerToken, {
    maxAgeSec: 7 * 24 * 3600,
    sameSite: 'Strict',
    path: '/api/chat',
  });
  setCookie(res, COOKIE_BUYER_THREAD, threadId, {
    maxAgeSec: 7 * 24 * 3600,
    sameSite: 'Strict',
    path: '/api/chat',
  });
}

function clearBuyerCookies(res) {
  clearCookie(res, COOKIE_BUYER_TOKEN, '/api/chat');
  clearCookie(res, COOKIE_BUYER_THREAD, '/api/chat');
}

function getBuyerAuth(req) {
  const cookies = parseCookies(req);
  return {
    buyerToken: cookies[COOKIE_BUYER_TOKEN] || null,
    threadId: cookies[COOKIE_BUYER_THREAD] || null,
  };
}

/** Reject weak / common admin passwords (never truncate). */
function validatePasswordStrength(password) {
  const p = String(password ?? '');
  if (p.length < 12) return { ok: false, message: 'Password must be at least 12 characters.' };
  if (p.length > 200) return { ok: false, message: 'Password is too long.' };
  if (COMMON_PASSWORDS.has(p.toLowerCase())) {
    return { ok: false, message: 'Password is too common.' };
  }
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) {
    return { ok: false, message: 'Password must include letters and numbers.' };
  }
  return { ok: true };
}

function isDangerousUploadFilename(filename) {
  const name = String(filename || '').toLowerCase().trim();
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return true;
  }
  // double extensions: image.png.exe
  const parts = name.split('.').filter(Boolean);
  if (parts.length >= 2) {
    const last = `.${parts[parts.length - 1]}`;
    const prev = `.${parts[parts.length - 2]}`;
    if (DANGEROUS_UPLOAD_EXTS.has(last)) return true;
    if (DANGEROUS_UPLOAD_EXTS.has(prev) && ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt'].includes(last)) {
      return true;
    }
  }
  return false;
}

function pruneSessions(store) {
  const now = Date.now();
  for (const [id, s] of Object.entries(store.sessions || {})) {
    if (!s || now > s.expiresAt) delete store.sessions[id];
  }
}

function createAdminSession(meta = {}) {
  const store = loadJson(SESSIONS_PATH, { sessions: {} });
  pruneSessions(store);
  const sid = randomToken(32);
  store.sessions[sid] = {
    id: sid,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    lastSeenAt: Date.now(),
    staffName: sanitizePlainText(meta.staffName || meta.name || 'Staff', 32),
    staffId: meta.staffId ? sanitizePlainText(meta.staffId, 64) : null,
    staffEmail: meta.staffEmail
      ? sanitizePlainText(meta.staffEmail, 120).toLowerCase()
      : null,
    role: meta.role === 'admin' ? 'admin' : 'staff',
    ip: meta.ip || null,
  };
  saveJson(SESSIONS_PATH, store);
  return sid;
}

function getAdminSession(req) {
  const cookies = parseCookies(req);
  const sid = cookies[COOKIE_NAME];
  if (!sid) return null;
  const store = loadJson(SESSIONS_PATH, { sessions: {} });
  pruneSessions(store);
  const s = store.sessions[sid];
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    delete store.sessions[sid];
    saveJson(SESSIONS_PATH, store);
    return null;
  }
  s.lastSeenAt = Date.now();
  s.expiresAt = Date.now() + SESSION_TTL_MS;
  saveJson(SESSIONS_PATH, store);
  return s;
}

function destroyAdminSession(req, res) {
  const cookies = parseCookies(req);
  const sid = cookies[COOKIE_NAME];
  if (sid) {
    const store = loadJson(SESSIONS_PATH, { sessions: {} });
    delete store.sessions[sid];
    saveJson(SESSIONS_PATH, store);
  }
  clearCookie(res, COOKIE_NAME);
}

function issueCsrf(sessionId) {
  const store = loadJson(CSRF_PATH, { tokens: {} });
  const now = Date.now();
  for (const [k, v] of Object.entries(store.tokens)) {
    if (!v || now > v.expiresAt) delete store.tokens[k];
  }
  const token = randomToken(24);
  store.tokens[token] = {
    sessionId: sessionId || null,
    expiresAt: now + CSRF_TTL_MS,
  };
  saveJson(CSRF_PATH, store);
  return token;
}

function validateCsrf(token, sessionId) {
  if (!token || String(token).length > 128) return false;
  const store = loadJson(CSRF_PATH, { tokens: {} });
  const row = store.tokens[String(token)];
  if (!row) return false;
  if (Date.now() > row.expiresAt) {
    delete store.tokens[token];
    saveJson(CSRF_PATH, store);
    return false;
  }
  if (sessionId && row.sessionId && row.sessionId !== sessionId) return false;
  return true;
}

function consumeCsrf(token) {
  const store = loadJson(CSRF_PATH, { tokens: {} });
  delete store.tokens[String(token)];
  saveJson(CSRF_PATH, store);
}

function safePublicThread(thread) {
  if (!thread) return null;
  return {
    id: thread.id,
    buyerName: thread.buyerName,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    order: thread.order
      ? {
          planId: thread.order.planId || thread.order.plan || null,
          planName: thread.order.planName || null,
          amount: thread.order.amount ?? null,
          method: thread.order.method || null,
          orderId: thread.order.orderId || null,
        }
      : null,
    messages: (thread.messages || []).map((m) => ({
      id: m.id,
      from: m.from,
      name: m.name,
      text: m.text,
      at: m.at,
    })),
  };
}

function resolveSafePath(publicRoot, pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0] || '/');
  if (decoded.includes('\0')) return null;
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  if (rel.includes('..') || path.isAbsolute(rel)) return null;
  const root = path.resolve(publicRoot);
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep) && full !== root) return null;
  return full;
}

function readBodyLimited(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        if (!raw.trim()) return resolve({});
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          return reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }));
        }
        resolve(data);
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function logSecure(event, details = {}) {
  const safe = { ...details };
  delete safe.password;
  delete safe.token;
  delete safe.secret;
  delete safe.buyerToken;
  delete safe.adminSecret;
  delete safe.csrf;
  const entry = {
    ts: new Date().toISOString(),
    action: event,
    result: safe.result || (safe.ok === false ? 'fail' : 'ok'),
    ip: safe.ip || undefined,
    userId: safe.userId || safe.staffName || undefined,
    ...safe,
  };
  delete entry.ok;
  const line = JSON.stringify(entry);
  console.log(`[security] ${line}`);
  try {
    ensureData();
    fs.appendFileSync(AUDIT_PATH, line + '\n', { mode: 0o600 });
    const st = fs.statSync(AUDIT_PATH);
    // Cap audit log ~2MB to limit disk DoS
    if (st.size > 2 * 1024 * 1024) {
      const keep = fs.readFileSync(AUDIT_PATH, 'utf8').split('\n').slice(-2000).join('\n');
      fs.writeFileSync(AUDIT_PATH, keep.endsWith('\n') ? keep : keep + '\n', { mode: 0o600 });
    }
  } catch (err) {
    console.log(`[security] {"ts":"${new Date().toISOString()}","action":"audit_write_failed","result":"fail"}`);
  }
}

module.exports = {
  COOKIE_NAME,
  COOKIE_BUYER_TOKEN,
  COOKIE_BUYER_THREAD,
  MAX_BODY,
  escapeHtml,
  sanitizePlainText,
  isValidDiscordName,
  isValidEmail,
  isValidThreadId,
  clientIp,
  rateLimit,
  securityHeaders,
  parseCookies,
  setCookie,
  clearCookie,
  setBuyerCookies,
  clearBuyerCookies,
  getBuyerAuth,
  createAdminSession,
  getAdminSession,
  destroyAdminSession,
  issueCsrf,
  validateCsrf,
  consumeCsrf,
  safePublicThread,
  resolveSafePath,
  readBodyLimited,
  logSecure,
  timingSafeEqualStr,
  randomToken,
  validatePasswordStrength,
  isDangerousUploadFilename,
};
