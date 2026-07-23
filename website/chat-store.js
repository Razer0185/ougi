const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {
  sanitizePlainText,
  isValidDiscordName,
  randomToken,
  timingSafeEqualStr,
  logSecure,
  validatePasswordStrength,
} = require('./security');

const ROOT = path.join(__dirname, '..');
const CHAT_PATH = path.join(ROOT, 'data', 'chats.json');
const SECRET_PATH = path.join(ROOT, 'data', 'chat-admin-secret.txt');
const HASH_PATH = path.join(ROOT, 'data', 'chat-admin-hash.txt');
const BCRYPT_ROUNDS = 12;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function ensure() {
  const dir = path.dirname(CHAT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(CHAT_PATH)) {
    fs.writeFileSync(CHAT_PATH, JSON.stringify({ threads: {} }, null, 2), { mode: 0o600 });
  }
  migrateAdminPassword();
}

function migrateAdminPassword() {
  if (fs.existsSync(HASH_PATH)) return;
  let plain = process.env.OUGI_CHAT_SECRET || '';
  if (!plain && fs.existsSync(SECRET_PATH)) {
    plain = fs.readFileSync(SECRET_PATH, 'utf8').trim();
  }
  if (!plain) plain = crypto.randomBytes(18).toString('base64url');
  const hash = bcrypt.hashSync(plain, BCRYPT_ROUNDS);
  fs.writeFileSync(HASH_PATH, hash, { mode: 0o600 });
  if (fs.existsSync(SECRET_PATH)) {
    try {
      fs.unlinkSync(SECRET_PATH);
    } catch (err) {
      logSecure('secret_unlink_failed', { result: 'fail', error: err.code || 'unlink' });
      fs.writeFileSync(SECRET_PATH, '[MOVED TO chat-admin-hash.txt — set OUGI_CHAT_SECRET env to change]', {
        mode: 0o600,
      });
    }
  }
  const bootstrap = path.join(ROOT, 'data', 'ADMIN_PASSWORD_ONCE.txt');
  if (!process.env.OUGI_CHAT_SECRET) {
    fs.writeFileSync(
      bootstrap,
      [
        'Ougi staff chat — first-run admin password (DELETE THIS FILE AFTER SAVING IT)',
        plain,
        '',
        'Change later via staff inbox password change (requires current password) or OUGI_CHAT_SECRET.',
        '',
      ].join('\n'),
      { mode: 0o600 }
    );
    logSecure('admin_password_bootstrapped', { file: 'data/ADMIN_PASSWORD_ONCE.txt' });
  }
}

function load() {
  ensure();
  try {
    const data = JSON.parse(fs.readFileSync(CHAT_PATH, 'utf8'));
    return pruneExpired(data);
  } catch (err) {
    logSecure('chat_load_failed', { result: 'fail', error: err.code || 'parse_error' });
    return { threads: {} };
  }
}

function pruneExpired(data) {
  const now = Date.now();
  let changed = false;
  for (const [id, t] of Object.entries(data.threads || {})) {
    const stamp = t.updatedAt || t.createdAt || 0;
    if (now - stamp > RETENTION_MS) {
      delete data.threads[id];
      changed = true;
    }
  }
  if (changed) {
    save(data);
    logSecure('chat_retention_prune', { result: 'ok' });
  }
  return data;
}

function save(data) {
  ensure();
  fs.writeFileSync(CHAT_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function verifyAdminPassword(password) {
  ensure();
  const candidate = String(password || '');
  if (candidate.length < 8 || candidate.length > 200) return false;

  if (process.env.OUGI_CHAT_SECRET && !fs.existsSync(HASH_PATH)) {
    migrateAdminPassword();
  }

  if (!fs.existsSync(HASH_PATH)) return false;
  const hash = fs.readFileSync(HASH_PATH, 'utf8').trim();
  try {
    return await bcrypt.compare(candidate, hash);
  } catch (err) {
    logSecure('admin_password_compare_failed', { result: 'fail', error: err.code || 'bcrypt' });
    return false;
  }
}

/** Change admin password after reauthentication. Never truncates passwords. */
async function setAdminPassword({ currentPassword, newPassword }) {
  const ok = await verifyAdminPassword(currentPassword);
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
  const hash = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
  fs.writeFileSync(HASH_PATH, hash, { mode: 0o600 });
  logSecure('admin_password_changed', { result: 'ok' });
  return true;
}

function listThreads() {
  const data = load();
  return Object.values(data.threads)
    .map((t) => ({
      id: t.id,
      buyerName: t.buyerName,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      order: t.order || null,
      preview: sanitizePlainText(t.messages[t.messages.length - 1]?.text || '', 120),
      messageCount: t.messages.length,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function getThread(id) {
  return load().threads[String(id)] || null;
}

function assertBuyerAccess(thread, buyerToken) {
  if (!thread || !buyerToken) return false;
  const hashed = hashToken(buyerToken);
  return timingSafeEqualStr(hashed, thread.buyerTokenHash || '');
}

function createThread({ buyerName, order, userId }) {
  if (!isValidDiscordName(buyerName)) {
    throw Object.assign(new Error('Invalid Discord username.'), { statusCode: 400 });
  }
  const name = sanitizePlainText(buyerName, 64);
  const data = load();
  const buyerToken = randomToken(24);
  const buyerTokenHash = hashToken(buyerToken);
  const uid = userId ? sanitizePlainText(userId, 64) : null;

  let existing = null;
  if (uid) {
    existing = Object.values(data.threads).find((t) => t.userId === uid) || null;
  }
  if (!existing) {
    existing = Object.values(data.threads).find(
      (t) => t.buyerName.toLowerCase() === name.toLowerCase()
    );
  }

  if (existing) {
    existing.buyerTokenHash = buyerTokenHash;
    if (uid) existing.userId = uid;
    existing.buyerName = name;
    if (order && typeof order === 'object') {
      existing.order = {
        orderId: sanitizePlainText(order.orderId, 64) || null,
        planId: sanitizePlainText(order.planId || order.plan, 32) || null,
        planName: sanitizePlainText(order.planName, 64) || null,
        amount: typeof order.amount === 'number' ? order.amount : sanitizePlainText(order.amount, 16),
        method: sanitizePlainText(order.method, 32) || null,
      };
    }
    existing.updatedAt = Date.now();
    save(data);
    return { thread: existing, buyerToken };
  }

  const id = crypto.randomBytes(8).toString('hex');
  const thread = {
    id,
    buyerName: name,
    buyerTokenHash,
    userId: uid,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    order: order && typeof order === 'object'
      ? {
          orderId: sanitizePlainText(order.orderId, 64) || null,
          planId: sanitizePlainText(order.planId || order.plan, 32) || null,
          planName: sanitizePlainText(order.planName, 64) || null,
          amount: typeof order.amount === 'number' ? order.amount : sanitizePlainText(order.amount, 16),
          method: sanitizePlainText(order.method, 32) || null,
        }
      : null,
    messages: [
      {
        id: crypto.randomBytes(4).toString('hex'),
        from: 'staff',
        name: 'Ougi Support',
        text:
          'Hey! Thanks for your order. Share your server name/ID if you have not already. A staff member will join, you give them Administrator, and they will add Ougi for you.',
        at: Date.now(),
      },
    ],
  };
  data.threads[id] = thread;
  save(data);
  return { thread, buyerToken };
}

function getThreadByUserId(userId) {
  if (!userId) return null;
  const uid = String(userId);
  return Object.values(load().threads).find((t) => t.userId === uid) || null;
}

function assertUserOwnsThread(thread, userId) {
  return !!(thread && userId && thread.userId && thread.userId === String(userId));
}

function addMessage(threadId, { from, name, text }) {
  const data = load();
  const thread = data.threads[String(threadId)];
  if (!thread) throw Object.assign(new Error('Chat not found.'), { statusCode: 404 });
  const clean = sanitizePlainText(text, 1000);
  if (!clean) throw Object.assign(new Error('Message is empty.'), { statusCode: 400 });

  const role = from === 'staff' ? 'staff' : 'buyer';
  const display = sanitizePlainText(
    name || (role === 'staff' ? 'Staff' : thread.buyerName),
    64
  );
  if (!display) throw Object.assign(new Error('Invalid name.'), { statusCode: 400 });

  const msg = {
    id: crypto.randomBytes(4).toString('hex'),
    from: role,
    name: display,
    text: clean,
    at: Date.now(),
  };
  thread.messages.push(msg);
  if (thread.messages.length > 300) thread.messages = thread.messages.slice(-300);
  thread.updatedAt = Date.now();
  save(data);
  return { thread, message: msg };
}

module.exports = {
  listThreads,
  getThread,
  getThreadByUserId,
  createThread,
  addMessage,
  assertBuyerAccess,
  assertUserOwnsThread,
  verifyAdminPassword,
  setAdminPassword,
  HASH_PATH,
  SECRET_PATH,
  RETENTION_MS,
  ensure,
};
