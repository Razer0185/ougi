'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {
  sanitizePlainText,
  isValidEmail,
  isValidDiscordName,
  validatePasswordStrength,
  randomToken,
  logSecure,
  parseCookies,
  setCookie,
  clearCookie,
} = require('./security');

const { dataFile } = require('../src/utils/data-paths');
const USERS_PATH = dataFile('users.json');
const USER_SESSIONS_PATH = dataFile('user-sessions.json');
const COOKIE_USER = 'ougi_user_sid';
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const BCRYPT_ROUNDS = 12;

function ensure() {
  const dir = path.dirname(USERS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(USERS_PATH)) {
    fs.writeFileSync(USERS_PATH, JSON.stringify({ users: {} }, null, 2), { mode: 0o600 });
  }
  if (!fs.existsSync(USER_SESSIONS_PATH)) {
    fs.writeFileSync(USER_SESSIONS_PATH, JSON.stringify({ sessions: {} }, null, 2), { mode: 0o600 });
  }
}

function loadUsers() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  } catch (err) {
    logSecure('users_load_failed', { result: 'fail', error: err.code || 'parse' });
    return { users: {} };
  }
}

function saveUsers(data) {
  ensure();
  fs.writeFileSync(USERS_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function loadSessions() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(USER_SESSIONS_PATH, 'utf8'));
  } catch (err) {
    logSecure('user_sessions_load_failed', { result: 'fail', error: err.code || 'parse' });
    return { sessions: {} };
  }
}

function saveSessions(data) {
  ensure();
  fs.writeFileSync(USER_SESSIONS_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    discord: u.discord,
    createdAt: u.createdAt,
    authProvider: u.googleId ? 'google' : 'password',
    hasPassword: Boolean(u.passwordHash),
  };
}

function findByEmail(email) {
  const key = String(email || '').toLowerCase();
  const data = loadUsers();
  return Object.values(data.users).find((u) => u.email === key) || null;
}

function findByGoogleId(googleId) {
  const key = String(googleId || '');
  if (!key) return null;
  const data = loadUsers();
  return Object.values(data.users).find((u) => u.googleId === key) || null;
}

function discordFromEmail(email) {
  const local = String(email || '')
    .split('@')[0]
    .replace(/[^a-zA-Z0-9._\-]/g, '')
    .slice(0, 32);
  return local.length >= 2 ? local : 'ougi-user';
}

/**
 * Create or link a Google account. Links by googleId first, then email.
 */
function upsertFromGoogle({ googleId, email, name }) {
  if (!googleId || !isValidEmail(email)) {
    throw Object.assign(new Error('Invalid Google profile.'), { statusCode: 400 });
  }
  const normalizedEmail = sanitizePlainText(email, 120).toLowerCase();
  const cleanName = sanitizePlainText(name, 80) || normalizedEmail.split('@')[0];
  const data = loadUsers();
  let user = findByGoogleId(googleId) || findByEmail(normalizedEmail);

  if (user) {
    user.googleId = googleId;
    user.email = normalizedEmail;
    if (cleanName) user.name = cleanName;
    user.updatedAt = Date.now();
    data.users[user.id] = user;
    saveUsers(data);
    logSecure('user_google_login', { result: 'ok', userId: user.id });
    return publicUser(user);
  }

  const id = crypto.randomBytes(12).toString('hex');
  user = {
    id,
    email: normalizedEmail,
    passwordHash: null,
    googleId: String(googleId),
    name: cleanName,
    discord: discordFromEmail(normalizedEmail),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  data.users[id] = user;
  saveUsers(data);
  logSecure('user_google_register', { result: 'ok', userId: id });
  return publicUser(user);
}

function getById(id) {
  return loadUsers().users[String(id)] || null;
}

async function register({ email, password, name, discord }) {
  if (!isValidEmail(email)) {
    throw Object.assign(new Error('Enter a valid email.'), { statusCode: 400 });
  }
  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    throw Object.assign(new Error(strength.message), { statusCode: 400 });
  }
  if (!isValidDiscordName(discord)) {
    throw Object.assign(new Error('Enter a valid Discord username.'), { statusCode: 400 });
  }
  const cleanName = sanitizePlainText(name, 80);
  if (!cleanName || cleanName.length < 2) {
    throw Object.assign(new Error('Enter your name.'), { statusCode: 400 });
  }

  const normalizedEmail = sanitizePlainText(email, 120).toLowerCase();
  if (findByEmail(normalizedEmail)) {
    throw Object.assign(new Error('An account with that email already exists.'), { statusCode: 409 });
  }

  const id = crypto.randomBytes(12).toString('hex');
  const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  const user = {
    id,
    email: normalizedEmail,
    passwordHash,
    name: cleanName,
    discord: sanitizePlainText(discord, 64),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const data = loadUsers();
  data.users[id] = user;
  saveUsers(data);
  logSecure('user_registered', { result: 'ok', userId: id });
  return publicUser(user);
}

async function verifyLogin(email, password) {
  const user = findByEmail(email);
  if (user && !user.passwordHash) {
    // Google-only account — password login not available
    await bcrypt.compare(String(password || ''), '$2a$12$invalidhashinvalidhashinvalidhu');
    return null;
  }
  // Constant-ish work even when missing
  const hash = user?.passwordHash || '$2a$12$invalidhashinvalidhashinvalidhu';
  let ok = false;
  try {
    ok = await bcrypt.compare(String(password || ''), hash);
  } catch (err) {
    logSecure('user_login_compare_failed', { result: 'fail', error: err.code || 'bcrypt' });
    ok = false;
  }
  if (!user || !ok) return null;
  return user;
}

function createSession(userId, meta = {}) {
  const store = loadSessions();
  const now = Date.now();
  for (const [sid, s] of Object.entries(store.sessions)) {
    if (!s || now > s.expiresAt) delete store.sessions[sid];
  }
  const sid = randomToken(32);
  store.sessions[sid] = {
    id: sid,
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    lastSeenAt: now,
    ip: meta.ip || null,
  };
  saveSessions(store);
  return sid;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const sid = cookies[COOKIE_USER];
  if (!sid) return null;
  const store = loadSessions();
  const s = store.sessions[sid];
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    delete store.sessions[sid];
    saveSessions(store);
    return null;
  }
  const user = getById(s.userId);
  if (!user) {
    delete store.sessions[sid];
    saveSessions(store);
    return null;
  }
  s.lastSeenAt = Date.now();
  s.expiresAt = Date.now() + SESSION_TTL_MS;
  saveSessions(store);
  return { session: s, user };
}

function destroySession(req, res) {
  const cookies = parseCookies(req);
  const sid = cookies[COOKIE_USER];
  if (sid) {
    const store = loadSessions();
    delete store.sessions[sid];
    saveSessions(store);
  }
  clearCookie(res, COOKIE_USER, '/');
}

function setUserCookie(res, sid) {
  setCookie(res, COOKIE_USER, sid, {
    maxAgeSec: Math.floor(SESSION_TTL_MS / 1000),
    sameSite: 'Strict',
    path: '/',
  });
}

function requireUser(req) {
  const auth = getSession(req);
  if (!auth) {
    throw Object.assign(new Error('Login required.'), { statusCode: 401 });
  }
  return auth;
}

async function deleteAccount(userId, password, { confirmDelete } = {}) {
  const user = getById(userId);
  if (!user) {
    throw Object.assign(new Error('Not found.'), { statusCode: 404 });
  }
  if (user.passwordHash) {
    const ok = await bcrypt.compare(String(password || ''), user.passwordHash);
    if (!ok) {
      throw Object.assign(new Error('Password incorrect.'), { statusCode: 401 });
    }
  } else if (String(confirmDelete || '') !== 'DELETE') {
    throw Object.assign(new Error('Type DELETE to confirm.'), { statusCode: 400 });
  }
  const data = loadUsers();
  delete data.users[userId];
  saveUsers(data);
  const store = loadSessions();
  for (const [sid, s] of Object.entries(store.sessions)) {
    if (s?.userId === userId) delete store.sessions[sid];
  }
  saveSessions(store);
  logSecure('user_deleted', { result: 'ok', userId });
  return true;
}

function exportUserData(userId) {
  const user = getById(userId);
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    discord: user.discord,
    createdAt: user.createdAt,
  };
}

module.exports = {
  COOKIE_USER,
  register,
  verifyLogin,
  upsertFromGoogle,
  createSession,
  getSession,
  destroySession,
  setUserCookie,
  requireUser,
  publicUser,
  getById,
  findByEmail,
  deleteAccount,
  exportUserData,
  ensure,
};
