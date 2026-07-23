const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const GUILDS_DIR = path.join(DATA_DIR, 'guilds');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(GUILDS_DIR)) fs.mkdirSync(GUILDS_DIR, { recursive: true });
}

function guildPath(guildId) {
  return path.join(GUILDS_DIR, `${guildId}.json`);
}

const defaults = () => ({
  prefix: '.',
  theme: 'blue',
  panelChannelId: null,
  panelMessageId: null,
  welcome: {
    enabled: false,
    channelId: null,
    message: 'Welcome {user} to **{server}**! You are member #{count}.',
  },
  automod: {
    enabled: false,
    antiSpam: true,
    antiInvite: true,
    antiLinks: false,
    badWords: [],
    maxMentions: 5,
  },
  tickets: {
    counter: 0,
    categoryId: null,
    supportRoleId: null,
    panels: {},
    open: {},
  },
  jtc: {
    enabled: false,
    hubChannelId: null,
    categoryId: null,
    tempChannels: {},
  },
  invitesDisabled: false,
  locked: false,
  mutedRoleId: null,
  logChannelId: null,
  invites: {
    enabled: true,
    logChannelId: null,
    users: {},
    members: {},
  },
  giveaways: {},
  moderation: {
    caseCounter: 0,
    cases: [],
    modLogChannelId: null,
  },
  roles: {
    autoroleIds: [],
    reactionRoles: {},
    selfRoles: [],
  },
  levels: {
    enabled: true,
    xpMin: 15,
    xpMax: 25,
    cooldownMs: 60000,
    announceChannelId: null,
    users: {},
    rewards: {},
    blacklistChannels: [],
  },
  logging: {
    enabled: true,
    channelId: null,
    messageDelete: true,
    messageEdit: true,
    memberJoin: true,
    memberLeave: true,
  },
  autoresponder: {
    enabled: true,
    rules: [],
  },
  sticky: {},
  starboard: {
    enabled: false,
    channelId: null,
    emoji: '⭐',
    threshold: 3,
    posted: {},
  },
  reminders: {},
  afk: {},
  customCommands: {},
});

function loadGuild(guildId) {
  ensureDirs();
  const file = guildPath(guildId);
  if (!fs.existsSync(file)) {
    const data = defaults();
    saveGuild(guildId, data);
    return data;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return deepMerge(defaults(), parsed);
  } catch {
    return defaults();
  }
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      base[k] &&
      typeof base[k] === 'object' &&
      !Array.isArray(base[k])
    ) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function normalizePrefix(raw) {
  if (raw == null) return '.';
  let p = String(raw).trim();
  if (
    (p.startsWith('"') && p.endsWith('"') && p.length >= 2) ||
    (p.startsWith("'") && p.endsWith("'") && p.length >= 2)
  ) {
    p = p.slice(1, -1);
  }
  if (!p || p.length > 5) return null;
  return p;
}

function getGuildPrefix(guildId) {
  const cfg = loadGuild(guildId);
  return normalizePrefix(cfg.prefix) || '.';
}

function setGuildPrefix(guildId, raw) {
  const next = normalizePrefix(raw);
  if (!next) return null;
  const cfg = loadGuild(guildId);
  cfg.prefix = next;
  saveGuild(guildId, cfg);
  return next;
}

function saveGuild(guildId, data) {
  ensureDirs();
  fs.writeFileSync(guildPath(guildId), JSON.stringify(data, null, 2));
}

function updateGuild(guildId, mutator) {
  const data = loadGuild(guildId);
  const next = mutator(data) || data;
  saveGuild(guildId, next);
  return next;
}

module.exports = {
  loadGuild,
  saveGuild,
  updateGuild,
  defaults,
  ensureDirs,
  normalizePrefix,
  getGuildPrefix,
  setGuildPrefix,
  deepMerge,
};
