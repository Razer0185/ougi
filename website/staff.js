'use strict';

/**
 * Staff / admin accounts (separate from buyer users).
 * data/staff.json — email + bcrypt password per person.
 * First account: log in once with email + the legacy shared admin password.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {
  sanitizePlainText,
  isValidEmail,
  validatePasswordStrength,
  logSecure,
} = require('./security');
const chat = require('./chat-store');

const { dataFile } = require('../src/utils/data-paths');
const STAFF_PATH = dataFile('staff.json');
const BCRYPT_ROUNDS = 12;

function ensure() {
  const dir = path.dirname(STAFF_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STAFF_PATH)) {
    fs.writeFileSync(STAFF_PATH, JSON.stringify({ staff: {} }, null, 2), { mode: 0o600 });
  }
}

function load() {
  ensure();
  try {
    const raw = JSON.parse(fs.readFileSync(STAFF_PATH, 'utf8'));
    return { staff: raw.staff && typeof raw.staff === 'object' ? raw.staff : {} };
  } catch (err) {
    logSecure('staff_load_failed', { result: 'fail', error: err.code || 'parse' });
    return { staff: {} };
  }
}

function save(data) {
  ensure();
  fs.writeFileSync(STAFF_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function publicStaff(s) {
  if (!s) return null;
  return {
    id: s.id,
    email: s.email,
    name: s.name,
    role: s.role === 'admin' ? 'admin' : 'staff',
    createdAt: s.createdAt,
    disabled: Boolean(s.disabled),
  };
}

function findByEmail(email) {
  const key = String(email || '')
    .trim()
    .toLowerCase();
  if (!isValidEmail(key)) return null;
  return Object.values(load().staff).find((s) => s.email === key) || null;
}

function getById(id) {
  return load().staff[String(id)] || null;
}

function countActive() {
  return Object.values(load().staff).filter((s) => !s.disabled).length;
}

function needsBootstrap() {
  return countActive() === 0;
}

function createStaffRecord({ email, password, name, role, passwordHash, skipStrength }) {
  if (!isValidEmail(email)) {
    throw Object.assign(new Error('Enter a valid email.'), { statusCode: 400 });
  }
  let hash = passwordHash;
  if (!hash) {
    if (!skipStrength) {
      const strength = validatePasswordStrength(password);
      if (!strength.ok) {
        throw Object.assign(new Error(strength.message), { statusCode: 400 });
      }
    } else if (!password || String(password).length < 8) {
      throw Object.assign(new Error('Password too short.'), { statusCode: 400 });
    }
    hash = bcrypt.hashSync(String(password), BCRYPT_ROUNDS);
  }
  const cleanEmail = sanitizePlainText(email, 120).toLowerCase();
  if (findByEmail(cleanEmail)) {
    throw Object.assign(new Error('An admin with that email already exists.'), { statusCode: 409 });
  }
  const data = load();
  const id = 'STF' + crypto.randomBytes(8).toString('hex');
  const staff = {
    id,
    email: cleanEmail,
    passwordHash: hash,
    name: sanitizePlainText(name || cleanEmail.split('@')[0], 32) || 'Staff',
    role: role === 'admin' ? 'admin' : 'staff',
    createdAt: Date.now(),
    disabled: false,
  };
  data.staff[id] = staff;
  save(data);
  logSecure('staff_created', { result: 'ok', staffId: id, role: staff.role });
  return publicStaff(staff);
}

/**
 * Login: email + password.
 * If no staff accounts exist yet, email + legacy shared password creates the first admin.
 */
async function login({ email, password }) {
  const cleanEmail = sanitizePlainText(email || '', 120).toLowerCase();
  const candidate = String(password || '');
  if (!isValidEmail(cleanEmail)) {
    throw Object.assign(new Error('Enter your admin email.'), { statusCode: 400 });
  }
  if (candidate.length < 8 || candidate.length > 200) {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  }

  let account = findByEmail(cleanEmail);

  if (!account && needsBootstrap()) {
    const legacyOk = await chat.verifyAdminPassword(candidate);
    if (!legacyOk) {
      throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    }
    // Prefer reusing the existing bcrypt hash so a short legacy secret still works once.
    let legacyHash = null;
    try {
      if (fs.existsSync(chat.HASH_PATH)) {
        legacyHash = fs.readFileSync(chat.HASH_PATH, 'utf8').trim();
      }
    } catch {
      legacyHash = null;
    }
    createStaffRecord({
      email: cleanEmail,
      password: candidate,
      passwordHash: legacyHash || undefined,
      skipStrength: true,
      name: cleanEmail.split('@')[0],
      role: 'admin',
    });
    account = findByEmail(cleanEmail);
    logSecure('staff_bootstrap_admin', { result: 'ok', staffId: account.id });
  }

  if (!account || account.disabled) {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  }

  let ok = false;
  try {
    ok = await bcrypt.compare(candidate, account.passwordHash);
  } catch (err) {
    logSecure('staff_password_compare_failed', { result: 'fail', error: err.code || 'bcrypt' });
    ok = false;
  }
  if (!ok) {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  }

  return publicStaff(account);
}

async function changePassword({ staffId, currentPassword, newPassword }) {
  const data = load();
  const account = data.staff[String(staffId)];
  if (!account || account.disabled) {
    throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  }
  const ok = await bcrypt.compare(String(currentPassword || ''), account.passwordHash);
  if (!ok) {
    throw Object.assign(new Error('Current password incorrect.'), { statusCode: 401 });
  }
  const strength = validatePasswordStrength(newPassword);
  if (!strength.ok) {
    throw Object.assign(new Error(strength.message), { statusCode: 400 });
  }
  if (String(currentPassword) === String(newPassword)) {
    throw Object.assign(new Error('New password must differ from current.'), { statusCode: 400 });
  }
  account.passwordHash = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
  save(data);
  logSecure('staff_password_changed', { result: 'ok', staffId: String(staffId) });
  return true;
}

function listStaff() {
  return Object.values(load().staff)
    .map(publicStaff)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/** Only role=admin can create other staff. */
function addStaffByAdmin({ actorRole, email, password, name, role }) {
  if (actorRole !== 'admin') {
    throw Object.assign(new Error('Only admins can add staff accounts.'), { statusCode: 403 });
  }
  return createStaffRecord({
    email,
    password,
    name,
    role: role === 'admin' ? 'admin' : 'staff',
  });
}

function setDisabled({ actorId, actorRole, targetId, disabled }) {
  if (actorRole !== 'admin') {
    throw Object.assign(new Error('Only admins can disable staff.'), { statusCode: 403 });
  }
  if (String(actorId) === String(targetId)) {
    throw Object.assign(new Error('You cannot disable your own account.'), { statusCode: 400 });
  }
  const data = load();
  const target = data.staff[String(targetId)];
  if (!target) {
    throw Object.assign(new Error('Staff not found.'), { statusCode: 404 });
  }
  if (target.role === 'admin' && disabled) {
    const admins = Object.values(data.staff).filter((s) => s.role === 'admin' && !s.disabled);
    if (admins.length <= 1) {
      throw Object.assign(new Error('Cannot disable the last admin.'), { statusCode: 400 });
    }
  }
  target.disabled = Boolean(disabled);
  save(data);
  logSecure('staff_disabled_set', {
    result: 'ok',
    targetId: String(targetId),
    disabled: target.disabled,
  });
  return publicStaff(target);
}

module.exports = {
  login,
  changePassword,
  listStaff,
  addStaffByAdmin,
  setDisabled,
  getById,
  publicStaff,
  needsBootstrap,
  STAFF_PATH,
};
