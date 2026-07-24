'use strict';

/**
 * Hosted subscriptions — buyers never get source; we whitelist their guild until expiry.
 * Shared by the Discord bot and the website (same data/subscriptions.json).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { PROJECT_ROOT, dataFile } = require('./data-paths');
const ROOT = PROJECT_ROOT;
const SUBS_PATH = dataFile('subscriptions.json');
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function ensure() {
  const dir = path.dirname(SUBS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(SUBS_PATH)) {
    fs.writeFileSync(SUBS_PATH, JSON.stringify({ byUser: {}, byGuild: {} }, null, 2), {
      mode: 0o600,
    });
  }
}

function load() {
  ensure();
  try {
    const raw = JSON.parse(fs.readFileSync(SUBS_PATH, 'utf8'));
    return {
      byUser: raw.byUser && typeof raw.byUser === 'object' ? raw.byUser : {},
      byGuild: raw.byGuild && typeof raw.byGuild === 'object' ? raw.byGuild : {},
    };
  } catch {
    return { byUser: {}, byGuild: {} };
  }
}

function save(data) {
  ensure();
  fs.writeFileSync(SUBS_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function isLifetimePlan(planId) {
  const id = String(planId || '').toLowerCase();
  return id === 'lifetime' || id === 'pc-lifetime';
}

function hostModeOf(planId) {
  const id = String(planId || '').toLowerCase();
  if (id.startsWith('pc') || id === 'selfhost' || id === 'bot') return 'pc';
  return 'cloud';
}

function publicSub(sub) {
  if (!sub) return null;
  const now = Date.now();
  const expired = sub.expiresAt != null && now > sub.expiresAt;
  const status = expired ? 'expired' : sub.status || 'active';
  const hostMode = sub.hostMode || hostModeOf(sub.planId);
  return {
    userId: sub.userId,
    planId: sub.planId,
    planName: sub.planName || sub.planId,
    hostMode,
    guildId: sub.guildId || null,
    status,
    expiresAt: sub.expiresAt,
    activatedAt: sub.activatedAt || null,
    orderId: sub.orderId || null,
    active: status === 'active' && (hostMode === 'pc' || Boolean(sub.guildId)),
    paid: status === 'active' || status === 'pending_activate',
    canCloudHost: hostMode === 'cloud' && (status === 'active' || status === 'pending_activate'),
    canPcHost: hostMode === 'pc' && (status === 'active' || status === 'pending_activate') && !expired,
  };
}

function getByUser(userId) {
  const data = load();
  return data.byUser[String(userId)] || null;
}

function getByGuild(guildId) {
  const data = load();
  const uid = data.byGuild[String(guildId)];
  if (!uid) return null;
  return data.byUser[uid] || null;
}

/** True if this guild currently has an active (non-expired) hosted seat. */
function isGuildSubscriptionActive(guildId) {
  const sub = getByGuild(guildId);
  if (!sub) return false;
  if (sub.status === 'revoked' || sub.status === 'deactivated') return false;
  if (sub.expiresAt != null && Date.now() > sub.expiresAt) return false;
  return sub.status === 'active' && Boolean(sub.guildId);
}

/**
 * After payment: grant or extend subscription for this account.
 * Does not bind a guild until they Activate on the dashboard.
 */
function grantFromPayment({ userId, planId, planName, orderId, email }) {
  const id = String(userId);
  const data = load();
  const existing = data.byUser[id] || null;
  const lifetime = isLifetimePlan(planId);
  const now = Date.now();

  let expiresAt = null;
  if (!lifetime) {
    const base =
      existing && existing.expiresAt && existing.expiresAt > now ? existing.expiresAt : now;
    expiresAt = base + MONTH_MS;
  }

  let guildId = existing?.guildId || null;
  if (guildId && data.byGuild[guildId] && data.byGuild[guildId] !== id) {
    guildId = null;
  }

  const sub = {
    userId: id,
    email: email || existing?.email || null,
    planId: String(planId || 'starter'),
    planName: planName || (lifetime ? 'Hosted Lifetime' : 'Hosted Monthly'),
    hostMode: hostModeOf(planId),
    guildId,
    status: guildId ? 'active' : 'pending_activate',
    expiresAt,
    orderId: orderId || existing?.orderId || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    activatedAt: existing?.activatedAt || null,
  };

  // PC plans don't need a cloud guild to be "ready"
  if (sub.hostMode === 'pc') {
    sub.status = 'active';
  }

  if (guildId) {
    data.byGuild[guildId] = id;
  }
  data.byUser[id] = sub;
  save(data);

  try {
    const access = require('./access');
    if (guildId) access.allowGuild(guildId, `sub:${id}`);
  } catch {
    /* ignore */
  }

  return publicSub(sub);
}

function activateForUser(userId, guildIdRaw) {
  const guildId = String(guildIdRaw || '').trim();
  if (!/^\d{17,20}$/.test(guildId)) {
    throw Object.assign(new Error('Invalid Discord server ID (use Developer Mode → Copy Server ID).'), {
      statusCode: 400,
    });
  }

  const data = load();
  const id = String(userId);
  const sub = data.byUser[id];
  if (!sub) {
    throw Object.assign(new Error('No paid plan on this account. Checkout first.'), {
      statusCode: 402,
    });
  }
  const mode = sub.hostMode || hostModeOf(sub.planId);
  if (mode !== 'cloud') {
    throw Object.assign(
      new Error('This is a PC Host plan. Use the Ougi Host app → Start bot on this PC.'),
      { statusCode: 400 }
    );
  }
  if (sub.expiresAt != null && Date.now() > sub.expiresAt) {
    throw Object.assign(new Error('Subscription expired. Renew on the checkout page.'), {
      statusCode: 402,
    });
  }

  const other = data.byGuild[guildId];
  if (other && other !== id) {
    throw Object.assign(new Error('That server is already linked to another Ougi account.'), {
      statusCode: 409,
    });
  }

  // Unbind previous guild for this user
  if (sub.guildId && sub.guildId !== guildId) {
    delete data.byGuild[sub.guildId];
    try {
      require('./access').revokeGuild(sub.guildId);
    } catch {
      /* ignore */
    }
  }

  sub.guildId = guildId;
  sub.status = 'active';
  sub.activatedAt = Date.now();
  sub.updatedAt = Date.now();
  data.byUser[id] = sub;
  data.byGuild[guildId] = id;
  save(data);

  try {
    require('./access').allowGuild(guildId, `activate:${id}`);
  } catch {
    /* ignore */
  }

  return publicSub(sub);
}

function deactivateForUser(userId) {
  const data = load();
  const id = String(userId);
  const sub = data.byUser[id];
  if (!sub) {
    throw Object.assign(new Error('No subscription found.'), { statusCode: 404 });
  }
  const guildId = sub.guildId;
  if (guildId) {
    delete data.byGuild[guildId];
    try {
      require('./access').revokeGuild(guildId);
    } catch {
      /* ignore */
    }
  }
  sub.guildId = null;
  sub.status = 'pending_activate';
  sub.updatedAt = Date.now();
  data.byUser[id] = sub;
  save(data);
  return publicSub(sub);
}

/**
 * Sweep expired seats; revoke whitelist. Returns list of revoked guild ids.
 */
function revokeExpired() {
  const data = load();
  const now = Date.now();
  const revoked = [];
  for (const [uid, sub] of Object.entries(data.byUser)) {
    if (!sub || sub.expiresAt == null) continue;
    if (now <= sub.expiresAt) continue;
    if (sub.status === 'expired') continue;
    const gid = sub.guildId;
    sub.status = 'expired';
    sub.updatedAt = now;
    if (gid) {
      delete data.byGuild[gid];
      sub.guildId = null;
      revoked.push(gid);
      try {
        require('./access').revokeGuild(gid);
      } catch {
        /* ignore */
      }
    }
    data.byUser[uid] = sub;
  }
  if (revoked.length) save(data);
  else save(data);
  return revoked;
}

/** Staff / gift-crypto: grant by email if account exists, else store pending by email key. */
function grantFromStaff({ email, userId, planId, planName, orderId }) {
  if (userId) {
    return grantFromPayment({ userId, planId, planName, orderId, email });
  }
  // Find user by email via users module when available
  try {
    const users = require('../../website/users');
    const u = users.findByEmail?.(email);
    if (u) {
      return grantFromPayment({
        userId: u.id,
        planId,
        planName,
        orderId,
        email: u.email,
      });
    }
  } catch {
    /* website users may not load from bot process */
  }
  throw Object.assign(new Error('User account not found for that email. They must register first.'), {
    statusCode: 404,
  });
}

function inviteClientId() {
  const env = (
    process.env.DISCORD_CLIENT_ID ||
    process.env.OUGI_CLIENT_ID ||
    process.env.CLIENT_ID ||
    ''
  ).trim();
  if (env) return env;
  try {
    const file = path.join(ROOT, 'data', 'bot-client-id.txt');
    if (fs.existsSync(file)) {
      const id = fs.readFileSync(file, 'utf8').trim();
      if (/^\d{17,20}$/.test(id)) return id;
    }
  } catch {
    /* ignore */
  }
  try {
    const file = path.join(ROOT, 'invite-url.txt');
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8');
      const m = text.match(/client_id=(\d+)/);
      if (m) return m[1];
    }
  } catch {
    /* ignore */
  }
  return '';
}

function buildSubscriberInviteUrl() {
  const { buildBotInviteUrl } = require('./invite');
  const id = inviteClientId();
  if (!id) {
    // Try invite-url.txt
    try {
      const file = path.join(ROOT, 'invite-url.txt');
      if (fs.existsSync(file)) {
        const text = fs.readFileSync(file, 'utf8');
        const m = text.match(/client_id=(\d+)/);
        if (m) return buildBotInviteUrl(m[1]);
        const url = text.split(/\r?\n/).find((l) => l.includes('discord.com/oauth2'));
        if (url) return url.trim();
      }
    } catch {
      /* ignore */
    }
    return null;
  }
  return buildBotInviteUrl(id);
}

module.exports = {
  SUBS_PATH,
  MONTH_MS,
  load,
  getByUser,
  getByGuild,
  publicSub,
  isGuildSubscriptionActive,
  grantFromPayment,
  grantFromStaff,
  activateForUser,
  deactivateForUser,
  revokeExpired,
  buildSubscriberInviteUrl,
  inviteClientId,
  isLifetimePlan,
  hostModeOf,
};
