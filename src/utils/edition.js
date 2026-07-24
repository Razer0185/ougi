'use strict';

/**
 * Free / promo edition of Ougi (TikTok trial bot).
 * Set OUGI_EDITION=free and put the free bot token in token-free.txt
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'data', 'free-edition.json');
const GUILDS_PATH = path.join(ROOT, 'data', 'free-guilds.json');
const CONTROL_PATH = path.join(ROOT, 'data', 'free-bot-control.json');

/** Your main / HQ server — free bot never leaves this. */
const DEFAULT_MAIN_GUILD_ID = '1521568250473873438';

const DEFAULT_CONFIG = {
  mainGuildId: DEFAULT_MAIN_GUILD_ID,
  trialDays: 3,
  /** Quiet daily reminder (no @everyone — Discord spam risk). */
  dailyPromo: true,
  promo: {
    eventName: 'Upgrade to Ougi Pro',
    eventDescription:
      'You are on Ougi Free (trial).\n\nJoin our Discord and buy Pro for the full bot — extra templates, role packs, honeypot, PC Host, AI builder, and more.',
    discordInvite: 'https://discord.gg/abzXEcPcWy',
    botInvite:
      'https://discord.com/oauth2/authorize?client_id=1530010597943415004&permissions=8&integration_type=0&scope=bot',
    productUrl:
      'https://discord.com/oauth2/authorize?client_id=1530010597943415004&permissions=8&integration_type=0&scope=bot',
  },
};

function isFreeEdition() {
  return String(process.env.OUGI_EDITION || '').toLowerCase() === 'free';
}

function ensureDataDir() {
  const dir = path.join(ROOT, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadConfig() {
  ensureDataDir();
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), { mode: 0o600 });
    return { ...DEFAULT_CONFIG, promo: { ...DEFAULT_CONFIG.promo } };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      promo: { ...DEFAULT_CONFIG.promo, ...(raw.promo || {}) },
      mainGuildId: String(raw.mainGuildId || DEFAULT_MAIN_GUILD_ID),
      trialDays: Math.max(1, Math.min(30, Number(raw.trialDays) || 3)),
      dailyPromo: raw.dailyPromo !== false,
    };
  } catch {
    return { ...DEFAULT_CONFIG, promo: { ...DEFAULT_CONFIG.promo } };
  }
}

function saveConfig(cfg) {
  ensureDataDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

function loadGuilds() {
  ensureDataDir();
  if (!fs.existsSync(GUILDS_PATH)) {
    fs.writeFileSync(GUILDS_PATH, JSON.stringify({ byGuild: {} }, null, 2), { mode: 0o600 });
    return { byGuild: {} };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(GUILDS_PATH, 'utf8'));
    if (!raw.byGuild || typeof raw.byGuild !== 'object') return { byGuild: {} };
    return raw;
  } catch {
    return { byGuild: {} };
  }
}

function saveGuilds(data) {
  ensureDataDir();
  fs.writeFileSync(GUILDS_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function loadControl() {
  ensureDataDir();
  if (!fs.existsSync(CONTROL_PATH)) {
    return { leaveAllRequestedAt: null, leaveAllDoneAt: null, requestedBy: null };
  }
  try {
    return JSON.parse(fs.readFileSync(CONTROL_PATH, 'utf8'));
  } catch {
    return { leaveAllRequestedAt: null, leaveAllDoneAt: null, requestedBy: null };
  }
}

function saveControl(data) {
  ensureDataDir();
  fs.writeFileSync(CONTROL_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function requestLeaveAll(requestedBy) {
  const c = loadControl();
  c.leaveAllRequestedAt = Date.now();
  c.leaveAllDoneAt = null;
  c.requestedBy = requestedBy || 'staff';
  saveControl(c);
  return c;
}

function mainGuildId() {
  return String(loadConfig().mainGuildId || DEFAULT_MAIN_GUILD_ID);
}

function isProtectedGuild(guildId) {
  return String(guildId) === mainGuildId();
}

/** Panel button ids allowed on Free. */
const FREE_PANEL_BUTTONS = new Set([
  'ban',
  'kick',
  'mute',
  'warn',
  'purge',
  'slowmode',
  'unmute',
  'nick',
  'modlog',
  'settings',
  'automod',
  'help',
  'lock',
  'unlock',
  'templates',
  'tickets',
]);

/** Only this server layout on Free (no role templates). */
const FREE_SERVER_TEMPLATE_ID = 'community';

/** Display name / nickname locked on Free. */
const FREE_DISPLAY_NAME = 'Ougi Free';

/**
 * Free uses an allowlist (not a blocklist) so aliases like ask/gstart/color can't bypass Pro gates.
 * Anything not listed is treated as Pro-only.
 */
const FREE_ALLOWED_COMMANDS = new Set([
  // core
  'ping',
  'help',
  'setup',
  'panel',
  'prefix',
  'serverinfo',
  'userinfo',
  // moderation
  'ban',
  'kick',
  'mute',
  'unmute',
  'warn',
  'warnings',
  'cases',
  'purge',
  'slowmode',
  'lock',
  'unlock',
  'nick',
  'softban',
  'tempban',
  'modlog',
  'automod',
  // templates (community only — enforced elsewhere)
  'template',
  'templates',
  // tickets
  'ticket',
  'tickets',
  'ticketpanel',
  'ticketbuyer',
  'ticketclose',
  // free admin (HQ only)
  'free',
  // invite link helper
  'invite',
]);

/** @deprecated kept for exports / older callers — Free gating uses FREE_ALLOWED_COMMANDS */
const FREE_BLOCKED_COMMANDS = new Set([
  'ai',
  'ask',
  'askbuild',
  'aibuild',
  'buildchannels',
  'giveaway',
  'gstart',
  'gend',
  'greroll',
  'levels',
  'leveling',
  'rank',
  'leaderboard',
  'jtc',
  'verify',
  'reactrole',
  'reactionrole',
  'rr',
  'selfrole',
  'autorole',
  'temprole',
  'temproles',
  'schedule',
  'sticky',
  'starboard',
  'autorespond',
  'autoresponder',
  'ar',
  'customcmd',
  'cc',
  'nuke',
  'honeypot',
  'antiraid',
  'suggest',
  'suggestion',
  'suggestions',
  'event',
  'welcome',
  'goodbye',
  'interfaces',
  'theme',
  'color',
  'colors',
  'colours',
  'botname',
  'avatar',
  'banner',
  'access',
]);

function isFreePanelActionAllowed(action) {
  if (!isFreeEdition()) return true;
  return FREE_PANEL_BUTTONS.has(String(action || '').toLowerCase());
}

function isFreeCommandAllowed(name) {
  if (!isFreeEdition()) return true;
  const n = String(name || '')
    .toLowerCase()
    .split(/\s+/)[0];
  if (!n) return true;
  return FREE_ALLOWED_COMMANDS.has(n);
}

function isFreeServerTemplateAllowed(id) {
  if (!isFreeEdition()) return true;
  return String(id) === FREE_SERVER_TEMPLATE_ID;
}

function freeServerTemplates(all) {
  if (!isFreeEdition()) return all;
  return (all || []).filter((t) => t.id === FREE_SERVER_TEMPLATE_ID);
}

function freePanelPages(pages) {
  if (!isFreeEdition()) return pages;
  const allowed = FREE_PANEL_BUTTONS;
  return pages
    .map((p) => ({
      ...p,
      buttons: (p.buttons || [])
        .filter((b) => allowed.has(b.id))
        .map((b) =>
          b.id === 'templates'
            ? { ...b, hint: 'Community layout only' }
            : b.id === 'tickets'
              ? { ...b, hint: 'support + buyer priority' }
              : b
        ),
      blurb:
        p.id === 'settings' || p.id === 'moderation'
          ? `${p.blurb} · Free trial — upgrade for full Ougi.`
          : p.blurb,
    }))
    .filter((p) => (p.buttons || []).length > 0);
}

/** Trim help so Free doesn't advertise Pro-only tooling as available. */
function freeHelpPages(pages) {
  if (!isFreeEdition()) return pages;
  const keep = new Set(['Moderation', 'Server Tools', 'Settings & Panel']);
  return (pages || [])
    .filter((p) => keep.has(p.title))
    .map((p) => {
      if (p.title === 'Server Tools') {
        return {
          ...p,
          body:
            '→ __**setup**__ / __**panel**__ — Free control panel\n' +
            '→ __**template**__ — Community layout only\n' +
            '→ __**ticketpanel**__ · __**ticketbuyer**__ · __**ticketclose**__\n' +
            '→ Upgrade for verify, JTC, welcome, AI, role packs, extra templates',
        };
      }
      if (p.title === 'Settings & Panel') {
        return {
          ...p,
          body:
            '→ __**prefix**__ · __**help**__ · __**ping**__ · __**serverinfo**__ · __**userinfo**__\n' +
            '→ __**setup**__ / __**panel**__ · __**automod**__ · __**modlog**__\n' +
            '→ Panel buttons: moderation, templates (Community), tickets\n' +
            '→ Pro unlocks AI, levels, giveaways, honeypot, theme, and more',
        };
      }
      return {
        ...p,
        body:
          `${p.body}\n\n` +
          '_Free trial — nuke / some listed tools need Ougi Pro._',
      };
    });
}

module.exports = {
  DEFAULT_MAIN_GUILD_ID,
  DEFAULT_CONFIG,
  CONFIG_PATH,
  isFreeEdition,
  loadConfig,
  saveConfig,
  loadGuilds,
  saveGuilds,
  loadControl,
  saveControl,
  requestLeaveAll,
  mainGuildId,
  isProtectedGuild,
  FREE_PANEL_BUTTONS,
  FREE_ALLOWED_COMMANDS,
  FREE_BLOCKED_COMMANDS,
  FREE_SERVER_TEMPLATE_ID,
  FREE_DISPLAY_NAME,
  isFreePanelActionAllowed,
  isFreeCommandAllowed,
  isFreeServerTemplateAllowed,
  freeServerTemplates,
  freePanelPages,
  freeHelpPages,
};
