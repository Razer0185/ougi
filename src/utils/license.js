'use strict';

/**
 * Short-lived PC-host license tickets.
 * The desktop app / agent must heartbeat; expired or unpaid seats cannot run.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getByUser, publicSub, isLifetimePlan } = require('./subscriptions');

const { dataFile } = require('./data-paths');
const TICKETS_PATH = dataFile('license-tickets.json');
const TICKET_TTL_MS = 20 * 60 * 1000; // 20 minutes — agent must renew

function licenseSecret() {
  const s = process.env.OUGI_LICENSE_SECRET || process.env.OUGI_CHAT_SECRET || '';
  if (s && s.length >= 16) return s;
  // Stable local fallback (not for public production — set OUGI_LICENSE_SECRET)
  return 'ougi-local-license-dev-only-change-me';
}

function ensure() {
  const dir = path.dirname(TICKETS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(TICKETS_PATH)) {
    fs.writeFileSync(TICKETS_PATH, JSON.stringify({ tickets: {} }, null, 2), { mode: 0o600 });
  }
}

function load() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(TICKETS_PATH, 'utf8'));
  } catch {
    return { tickets: {} };
  }
}

function save(data) {
  ensure();
  fs.writeFileSync(TICKETS_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function hostModeOf(planId) {
  const id = String(planId || '').toLowerCase();
  if (id.startsWith('pc') || id === 'selfhost' || id === 'bot') return 'pc';
  return 'cloud';
}

function assertPcEntitlement(userId) {
  const sub = getByUser(userId);
  if (!sub) {
    throw Object.assign(new Error('No plan on this account. Buy PC Host first.'), { statusCode: 402 });
  }
  const mode = sub.hostMode || hostModeOf(sub.planId);
  if (mode !== 'pc') {
    throw Object.assign(
      new Error('This account is Cloud Hosting only. Buy the PC Host plan to run Ougi on your PC.'),
      { statusCode: 402 }
    );
  }
  if (sub.expiresAt != null && Date.now() > sub.expiresAt) {
    throw Object.assign(new Error('PC license expired. Renew to keep hosting on your PC.'), {
      statusCode: 402,
    });
  }
  if (sub.status === 'expired' || sub.status === 'revoked') {
    throw Object.assign(new Error('PC license is not active.'), { statusCode: 402 });
  }
  return sub;
}

function signTicket(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', licenseSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyTicketString(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expect = crypto.createHmac('sha256', licenseSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Issue a PC run ticket for the logged-in user. */
function issuePcTicket(userId, { machineId } = {}) {
  const sub = assertPcEntitlement(userId);
  const now = Date.now();
  const payload = {
    v: 1,
    typ: 'pc',
    uid: String(userId),
    plan: sub.planId,
    mid: String(machineId || '').slice(0, 64) || null,
    iat: now,
    exp: Math.min(now + TICKET_TTL_MS, sub.expiresAt || now + TICKET_TTL_MS),
  };
  if (isLifetimePlan(sub.planId) || sub.expiresAt == null) {
    payload.exp = now + TICKET_TTL_MS;
  }
  const token = signTicket(payload);
  const store = load();
  store.tickets[token.slice(-24)] = {
    userId: payload.uid,
    exp: payload.exp,
    machineId: payload.mid,
    at: now,
  };
  // prune
  for (const [k, v] of Object.entries(store.tickets)) {
    if (!v || v.exp < now) delete store.tickets[k];
  }
  save(store);
  return {
    token,
    expiresAt: payload.exp,
    subscriptionExpiresAt: sub.expiresAt,
    planId: sub.planId,
    planName: sub.planName,
    hostMode: 'pc',
  };
}

function heartbeatPcTicket(token) {
  const payload = verifyTicketString(token);
  if (!payload || payload.typ !== 'pc') {
    throw Object.assign(new Error('Invalid or expired license ticket.'), { statusCode: 401 });
  }
  // Re-check subscription still valid
  const sub = assertPcEntitlement(payload.uid);
  const renewed = issuePcTicket(payload.uid, { machineId: payload.mid });
  return { ok: true, ...renewed, subscription: publicSub(sub) };
}

function verifyPcTicketOrThrow(token) {
  const payload = verifyTicketString(token);
  if (!payload || payload.typ !== 'pc') {
    throw Object.assign(new Error('Invalid or expired license ticket.'), { statusCode: 401 });
  }
  assertPcEntitlement(payload.uid);
  return payload;
}

module.exports = {
  hostModeOf,
  assertPcEntitlement,
  issuePcTicket,
  heartbeatPcTicket,
  verifyPcTicketOrThrow,
  verifyTicketString,
  TICKET_TTL_MS,
};
