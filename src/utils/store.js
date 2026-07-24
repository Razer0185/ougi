const fs = require('fs');
const path = require('path');

const { PROJECT_ROOT, dataDir } = require('./data-paths');
const ROOT = PROJECT_ROOT;
const DATA_DIR = dataDir();
const GUILDS_DIR = path.join(DATA_DIR, 'guilds');

function ensureDirs() {
  dataDir();
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
    card: true,
  },
  goodbye: {
    enabled: false,
    channelId: null,
    message: '**{user}** left **{server}**. We now have {count} members.',
  },
  verify: {
    enabled: false,
    channelId: null,
    messageId: null,
    roleId: null,
    unverifiedRoleId: null,
  },
  automod: {
    enabled: false,
    antiSpam: true,
    antiInvite: true,
    antiLinks: false,
    antiCaps: false,
    antiEmoji: false,
    badWords: [],
    maxMentions: 5,
    capsPercent: 70,
    maxEmoji: 10,
    punish: 'none',
    punishDuration: '10m',
    exemptChannelIds: [],
    exemptRoleIds: [],
  },
  antiraid: {
    enabled: true,
    joinsPerMinute: 8,
    action: 'lock',
    lockdown: false,
    lockedAt: null,
    exemptRoleIds: [],
  },
  honeypot: {
    enabled: false,
    channelId: null,
    action: 'kick',
    warningMessageId: null,
    caught: 0,
    lastCaughtId: null,
    lastCaughtTag: null,
    lastCaughtAt: null,
    exemptRoleIds: [],
  },
  suggestions: {
    enabled: false,
    channelId: null,
    counter: 0,
    open: {},
  },
  schedules: {},
  tempRoles: {},
  tickets: {
    counter: 0,
    categoryId: null,
    supportRoleId: null,
    /** Role that opens priority-ticket-N channels (buyers). */
    buyerRoleId: null,
    logChannelId: null,
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
    warnLadder: {
      enabled: true,
      muteAt: 3,
      kickAt: 5,
      banAt: 0,
      muteDuration: '1h',
    },
  },
  reports: {
    enabled: true,
    channelId: null,
    cooldownMs: 60000,
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
    voiceXpEnabled: true,
    voiceXpPerMinute: 10,
  },
  logging: {
    enabled: true,
    channelId: null,
    messageDelete: true,
    messageEdit: true,
    memberJoin: true,
    memberLeave: true,
    roleChanges: true,
    nickname: true,
    channels: true,
    bans: true,
    voice: true,
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
  activeTemplate: {
    id: null,
    name: null,
    style: null,
    kind: null,
    at: null,
  },
  /** Last AI channel build — used for undo (channel/category IDs). */
  lastAiBuild: null,
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
  // Allow wrapping in quotes when setting: prefix "'"
  if (
    (p.startsWith('"') && p.endsWith('"') && p.length >= 2) ||
    (p.startsWith("'") && p.endsWith("'") && p.length >= 2) ||
    (p.startsWith('`') && p.endsWith('`') && p.length >= 2)
  ) {
    p = p.slice(1, -1);
  }
  if (!p || p.length > 5) return null;
  // Reject whitespace-only / empty after unwrap
  if (!p.trim()) return null;
  return p;
}

function getGuildPrefix(guildId) {
  const cfg = loadGuild(guildId);
  return normalizePrefix(cfg.prefix) || '.';
}

/**
 * Punctuation prefixes always accepted (in addition to the guild's set prefix).
 * Discord only has a few button colors; prefixes can be almost any symbol.
 */
const BUILTIN_PREFIXES = [
  '.',
  ',',
  '!',
  '?',
  ';',
  ':',
  '-',
  '=',
  '+',
  '_',
  '/',
  '\\',
  '`',
  "'",
  '"',
  '[',
  ']',
  '{',
  '}',
  '(',
  ')',
  '<',
  '>',
  '|',
  '~',
  '^',
  '*',
  '&',
  '%',
  '$',
  '#',
  '@',
  '·',
  '•',
  '★',
  '☆',
];

function getCommandPrefixes(guildId) {
  const primary = getGuildPrefix(guildId);
  const list = [primary, ...BUILTIN_PREFIXES].filter(Boolean);
  // Longest first so multi-char guild prefixes beat single chars
  return [...new Set(list)].sort((a, b) => b.length - a.length);
}

/** True if this looks like a leading punctuation prefix (not a word). */
function isPunctuationPrefix(p) {
  if (!p || p.length > 5) return false;
  // Must not start with a letter/digit (those aren't "symbol" prefixes)
  return /^[^\p{L}\p{N}\s]/u.test(p);
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
  getCommandPrefixes,
  isPunctuationPrefix,
  setGuildPrefix,
  BUILTIN_PREFIXES,
  deepMerge,
};
