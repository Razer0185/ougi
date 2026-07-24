const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { dataFile } = require('./data-paths');
const ACCESS_PATH = dataFile('access.json');

function defaultAccess() {
  return {
    privateMode: process.env.OUGI_PC_AGENT === '1' ? false : true,
    allowedGuildIds: [],
    ownerDiscordIds: [],
    requests: [],
    licenses: {},
  };
}

function ensureAccessFile() {
  const dir = path.dirname(ACCESS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(ACCESS_PATH)) {
    fs.writeFileSync(ACCESS_PATH, JSON.stringify(defaultAccess(), null, 2));
  }
}

function loadAccess() {
  ensureAccessFile();
  try {
    return { ...defaultAccess(), ...JSON.parse(fs.readFileSync(ACCESS_PATH, 'utf8')) };
  } catch {
    return defaultAccess();
  }
}

function saveAccess(data) {
  ensureAccessFile();
  fs.writeFileSync(ACCESS_PATH, JSON.stringify(data, null, 2));
}

function isPrivateMode() {
  return !!loadAccess().privateMode;
}

function isGuildAllowed(guildId) {
  const cfg = loadAccess();
  if (!cfg.privateMode) return true;
  const id = String(guildId);

  // Paid hosted seat (dashboard activate)
  try {
    const { getByGuild } = require('./subscriptions');
    const sub = getByGuild(id);
    if (sub) {
      if (sub.status === 'revoked' || sub.status === 'expired') return false;
      if (sub.expiresAt != null && Date.now() > sub.expiresAt) return false;
      if (sub.status === 'active' && sub.guildId === id) return true;
    }
  } catch {
    /* ignore */
  }

  return cfg.allowedGuildIds.map(String).includes(id);
}

function allowGuild(guildId, note = '') {
  const cfg = loadAccess();
  const id = String(guildId);
  if (!cfg.allowedGuildIds.includes(id)) cfg.allowedGuildIds.push(id);
  cfg.licenses = cfg.licenses || {};
  saveAccess(cfg);
  return cfg;
}

function revokeGuild(guildId) {
  const cfg = loadAccess();
  cfg.allowedGuildIds = cfg.allowedGuildIds.filter((id) => id !== String(guildId));
  saveAccess(cfg);
  return cfg;
}

/** First boot: whitelist every server the bot is already in so you don't get kicked out. */
function seedAllowedGuilds(guildIds) {
  const cfg = loadAccess();
  let changed = false;
  if (!cfg.allowedGuildIds.length && guildIds.length) {
    cfg.allowedGuildIds = guildIds.map(String);
    changed = true;
  }
  for (const id of guildIds.map(String)) {
    if (!cfg.allowedGuildIds.includes(id)) {
      // don't auto-add new ones here — only seed when empty
    }
  }
  if (changed) saveAccess(cfg);
  return cfg;
}

function addAccessRequest(payload) {
  const cfg = loadAccess();
  const request = {
    id: crypto.randomBytes(6).toString('hex'),
    discord: String(payload.discord || '').slice(0, 64),
    server: String(payload.server || '').slice(0, 100),
    email: String(payload.email || '').slice(0, 120),
    note: String(payload.note || '').slice(0, 500),
    at: Date.now(),
    status: 'pending',
  };
  if (!request.discord && !request.email) {
    throw new Error('Discord username or email is required.');
  }
  cfg.requests.unshift(request);
  cfg.requests = cfg.requests.slice(0, 200);
  saveAccess(cfg);
  return request;
}

function setRequestStatus(id, status, guildId) {
  const cfg = loadAccess();
  const req = cfg.requests.find((r) => r.id === id);
  if (!req) throw new Error('Request not found.');
  req.status = status;
  if (status === 'approved' && guildId) allowGuild(guildId);
  saveAccess(cfg);
  return req;
}

function createLicense(note = '') {
  const cfg = loadAccess();
  const key = `OUGI-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto
    .randomBytes(4)
    .toString('hex')
    .toUpperCase()}`;
  cfg.licenses[key] = {
    note: String(note).slice(0, 120),
    createdAt: Date.now(),
    usedAt: null,
    guildId: null,
  };
  saveAccess(cfg);
  return { key, ...cfg.licenses[key] };
}

function redeemLicense(key, guildId) {
  const cfg = loadAccess();
  const lic = cfg.licenses[String(key || '').trim()];
  if (!lic) throw new Error('Invalid license key.');
  if (lic.guildId && lic.guildId !== String(guildId)) {
    throw new Error('This license is already tied to another server.');
  }
  lic.guildId = String(guildId);
  lic.usedAt = Date.now();
  if (!cfg.allowedGuildIds.includes(String(guildId))) {
    cfg.allowedGuildIds.push(String(guildId));
  }
  saveAccess(cfg);
  return lic;
}

function setPrivateMode(enabled) {
  const cfg = loadAccess();
  cfg.privateMode = !!enabled;
  saveAccess(cfg);
  return cfg;
}

module.exports = {
  ACCESS_PATH,
  loadAccess,
  saveAccess,
  isPrivateMode,
  isGuildAllowed,
  allowGuild,
  revokeGuild,
  seedAllowedGuilds,
  addAccessRequest,
  setRequestStatus,
  createLicense,
  redeemLicense,
  setPrivateMode,
};
