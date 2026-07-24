'use strict';

/**
 * Web dashboard ↔ guild JSON config.
 * Only the subscriber who activated a guild may read/write that guild.
 */

const { loadGuild, saveGuild } = require('../src/utils/store');
const subs = require('../src/utils/subscriptions');

const SNOWFLAKE = /^\d{17,20}$/;

function assertGuildAccess(userId) {
  const sub = subs.getByUser(userId);
  const pub = subs.publicSub(sub);
  if (!pub || !pub.guildId) {
    const err = new Error('Activate a Discord server on Host first.');
    err.statusCode = 403;
    throw err;
  }
  if (pub.status === 'expired' || pub.status === 'revoked' || pub.status === 'deactivated') {
    const err = new Error('Subscription inactive. Renew to edit settings.');
    err.statusCode = 403;
    throw err;
  }
  if (!(pub.status === 'active' || pub.status === 'pending_activate')) {
    const err = new Error('Subscription inactive.');
    err.statusCode = 403;
    throw err;
  }
  // Owner check: byGuild must point back to this user
  const owner = subs.getByGuild(pub.guildId);
  if (!owner || String(owner.userId) !== String(userId)) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }
  return { guildId: String(pub.guildId), subscription: pub };
}

function publicDashboardConfig(cfg) {
  return {
    prefix: cfg.prefix || '.',
    theme: cfg.theme || 'blue',
    automod: {
      enabled: !!cfg.automod?.enabled,
      antiSpam: cfg.automod?.antiSpam !== false,
      antiInvite: cfg.automod?.antiInvite !== false,
      antiLinks: !!cfg.automod?.antiLinks,
      maxMentions: Math.min(50, Math.max(1, Number(cfg.automod?.maxMentions) || 5)),
    },
    antiraid: {
      enabled: cfg.antiraid?.enabled !== false,
      joinsPerMinute: Math.min(50, Math.max(2, Number(cfg.antiraid?.joinsPerMinute) || 8)),
      action: ['lock', 'kick', 'none'].includes(cfg.antiraid?.action)
        ? cfg.antiraid.action
        : 'lock',
      lockdown: !!cfg.antiraid?.lockdown,
      exemptRoleIds: Array.isArray(cfg.antiraid?.exemptRoleIds)
        ? cfg.antiraid.exemptRoleIds.filter((id) => SNOWFLAKE.test(String(id))).slice(0, 10)
        : [],
    },
    welcome: {
      enabled: !!cfg.welcome?.enabled,
      channelId: cfg.welcome?.channelId || null,
      message: String(cfg.welcome?.message || '').slice(0, 500),
      card: cfg.welcome?.card !== false,
    },
    goodbye: {
      enabled: !!cfg.goodbye?.enabled,
      channelId: cfg.goodbye?.channelId || null,
      message: String(cfg.goodbye?.message || '').slice(0, 500),
    },
    levels: {
      enabled: cfg.levels?.enabled !== false,
      voiceXpEnabled: cfg.levels?.voiceXpEnabled !== false,
      voiceXpPerMinute: Math.min(100, Math.max(1, Number(cfg.levels?.voiceXpPerMinute) || 10)),
      announceChannelId: cfg.levels?.announceChannelId || null,
    },
    suggestions: {
      enabled: !!cfg.suggestions?.enabled,
      channelId: cfg.suggestions?.channelId || null,
    },
    logging: {
      enabled: cfg.logging?.enabled !== false,
      channelId: cfg.logging?.channelId || null,
    },
    starboard: {
      enabled: !!cfg.starboard?.enabled,
      channelId: cfg.starboard?.channelId || null,
      threshold: Math.min(20, Math.max(1, Number(cfg.starboard?.threshold) || 3)),
    },
  };
}

function bool(v, fallback) {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1 || v === '1') return true;
  if (v === 'false' || v === 0 || v === '0') return false;
  return fallback;
}

function snowflakeOrNull(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!SNOWFLAKE.test(s)) {
    const err = new Error('Invalid channel or role ID');
    err.statusCode = 400;
    throw err;
  }
  return s;
}

function applyPatch(guildId, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    const err = new Error('Invalid body');
    err.statusCode = 400;
    throw err;
  }
  const cfg = loadGuild(guildId);

  if (patch.prefix != null) {
    const p = String(patch.prefix).trim().slice(0, 5);
    if (!p) {
      const err = new Error('Prefix cannot be empty');
      err.statusCode = 400;
      throw err;
    }
    cfg.prefix = p;
  }

  if (patch.theme != null) {
    const themes = [
      'red',
      'black',
      'white',
      'pink',
      'blue',
      'purple',
      'green',
      'orange',
      'cyan',
      'gold',
    ];
    const t = String(patch.theme).toLowerCase();
    if (!themes.includes(t)) {
      const err = new Error('Invalid theme');
      err.statusCode = 400;
      throw err;
    }
    cfg.theme = t;
  }

  if (patch.automod && typeof patch.automod === 'object') {
    if (!cfg.automod) cfg.automod = {};
    const a = patch.automod;
    if (a.enabled != null) cfg.automod.enabled = bool(a.enabled, cfg.automod.enabled);
    if (a.antiSpam != null) cfg.automod.antiSpam = bool(a.antiSpam, cfg.automod.antiSpam);
    if (a.antiInvite != null) cfg.automod.antiInvite = bool(a.antiInvite, cfg.automod.antiInvite);
    if (a.antiLinks != null) cfg.automod.antiLinks = bool(a.antiLinks, cfg.automod.antiLinks);
    if (a.maxMentions != null) {
      const n = parseInt(a.maxMentions, 10);
      if (!n || n < 1 || n > 50) {
        const err = new Error('maxMentions must be 1–50');
        err.statusCode = 400;
        throw err;
      }
      cfg.automod.maxMentions = n;
    }
  }

  if (patch.antiraid && typeof patch.antiraid === 'object') {
    if (!cfg.antiraid) cfg.antiraid = {};
    const r = patch.antiraid;
    if (r.enabled != null) cfg.antiraid.enabled = bool(r.enabled, cfg.antiraid.enabled);
    if (r.joinsPerMinute != null) {
      const n = parseInt(r.joinsPerMinute, 10);
      if (!n || n < 2 || n > 50) {
        const err = new Error('joinsPerMinute must be 2–50');
        err.statusCode = 400;
        throw err;
      }
      cfg.antiraid.joinsPerMinute = n;
    }
    if (r.action != null) {
      const action = String(r.action).toLowerCase();
      if (!['lock', 'kick', 'none'].includes(action)) {
        const err = new Error('action must be lock, kick, or none');
        err.statusCode = 400;
        throw err;
      }
      cfg.antiraid.action = action;
    }
    if (r.exemptRoleIds != null) {
      const raw = Array.isArray(r.exemptRoleIds)
        ? r.exemptRoleIds
        : String(r.exemptRoleIds)
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean);
      cfg.antiraid.exemptRoleIds = raw
        .map((id) => String(id))
        .filter((id) => SNOWFLAKE.test(id))
        .slice(0, 10);
    }
  }

  if (patch.welcome && typeof patch.welcome === 'object') {
    if (!cfg.welcome) cfg.welcome = {};
    const w = patch.welcome;
    if (w.enabled != null) cfg.welcome.enabled = bool(w.enabled, cfg.welcome.enabled);
    if (w.card != null) cfg.welcome.card = bool(w.card, cfg.welcome.card);
    if (w.channelId !== undefined) cfg.welcome.channelId = snowflakeOrNull(w.channelId);
    if (w.message != null) cfg.welcome.message = String(w.message).slice(0, 500);
  }

  if (patch.goodbye && typeof patch.goodbye === 'object') {
    if (!cfg.goodbye) cfg.goodbye = {};
    const g = patch.goodbye;
    if (g.enabled != null) cfg.goodbye.enabled = bool(g.enabled, cfg.goodbye.enabled);
    if (g.channelId !== undefined) cfg.goodbye.channelId = snowflakeOrNull(g.channelId);
    if (g.message != null) cfg.goodbye.message = String(g.message).slice(0, 500);
  }

  if (patch.levels && typeof patch.levels === 'object') {
    if (!cfg.levels) cfg.levels = {};
    const l = patch.levels;
    if (l.enabled != null) cfg.levels.enabled = bool(l.enabled, cfg.levels.enabled);
    if (l.voiceXpEnabled != null) {
      cfg.levels.voiceXpEnabled = bool(l.voiceXpEnabled, cfg.levels.voiceXpEnabled);
    }
    if (l.voiceXpPerMinute != null) {
      const n = parseInt(l.voiceXpPerMinute, 10);
      if (!n || n < 1 || n > 100) {
        const err = new Error('voiceXpPerMinute must be 1–100');
        err.statusCode = 400;
        throw err;
      }
      cfg.levels.voiceXpPerMinute = n;
    }
    if (l.announceChannelId !== undefined) {
      cfg.levels.announceChannelId = snowflakeOrNull(l.announceChannelId);
    }
  }

  if (patch.suggestions && typeof patch.suggestions === 'object') {
    if (!cfg.suggestions) cfg.suggestions = {};
    const s = patch.suggestions;
    if (s.enabled != null) cfg.suggestions.enabled = bool(s.enabled, cfg.suggestions.enabled);
    if (s.channelId !== undefined) cfg.suggestions.channelId = snowflakeOrNull(s.channelId);
  }

  if (patch.logging && typeof patch.logging === 'object') {
    if (!cfg.logging) cfg.logging = {};
    const l = patch.logging;
    if (l.enabled != null) cfg.logging.enabled = bool(l.enabled, cfg.logging.enabled);
    if (l.channelId !== undefined) cfg.logging.channelId = snowflakeOrNull(l.channelId);
  }

  if (patch.starboard && typeof patch.starboard === 'object') {
    if (!cfg.starboard) cfg.starboard = {};
    const s = patch.starboard;
    if (s.enabled != null) cfg.starboard.enabled = bool(s.enabled, cfg.starboard.enabled);
    if (s.channelId !== undefined) cfg.starboard.channelId = snowflakeOrNull(s.channelId);
    if (s.threshold != null) {
      const n = parseInt(s.threshold, 10);
      if (!n || n < 1 || n > 20) {
        const err = new Error('threshold must be 1–20');
        err.statusCode = 400;
        throw err;
      }
      cfg.starboard.threshold = n;
    }
  }

  saveGuild(guildId, cfg);
  return publicDashboardConfig(cfg);
}

function getConfigForUser(userId) {
  const { guildId, subscription } = assertGuildAccess(userId);
  const cfg = loadGuild(guildId);
  return {
    guildId,
    subscription,
    config: publicDashboardConfig(cfg),
  };
}

function saveConfigForUser(userId, patch) {
  const { guildId, subscription } = assertGuildAccess(userId);
  const config = applyPatch(guildId, patch);
  return { guildId, subscription, config };
}

module.exports = {
  assertGuildAccess,
  getConfigForUser,
  saveConfigForUser,
  publicDashboardConfig,
};
