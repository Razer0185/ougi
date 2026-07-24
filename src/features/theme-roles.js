'use strict';

/**
 * Theme color roles — fixed IDs when present in the guild.
 * On theme change: only swap roles on the Ougi bot member (never on humans).
 * Hoist the active color role; leave other members' roles alone.
 */

const { PermissionFlagsBits } = require('discord.js');
const { INTERFACE_TEMPLATES, getTheme } = require('../utils/theme');
const { loadGuild, saveGuild } = require('../utils/store');

/** Ougi bot application / user id — only this member gets theme roles. */
const OUGI_BOT_USER_ID = '1529311010232602756';

/** Known theme role IDs (used when present in the guild). */
const THEME_ROLE_IDS = {
  red: '1529745573895213056',
  black: '1529745574994382899',
  white: '1529745575807946774',
  pink: '1529745576869105666',
  blue: '1529745578119135253',
  purple: '1529745578924314744',
  green: '1529745579788468386',
  orange: '1529745580836913333',
  cyan: '1529745581554143242',
  gold: '1529745581973704838',
};

function roleName(template) {
  return `${template.emoji} ★ ${template.label}`.slice(0, 100);
}

async function fetchRole(guild, roleId) {
  if (!roleId) return null;
  const cached = guild.roles.cache.get(roleId);
  if (cached) return cached;
  try {
    return await guild.roles.fetch(roleId);
  } catch {
    return null;
  }
}

async function resolveBotMember(guild) {
  const me = guild.members.me;
  if (me?.id === OUGI_BOT_USER_ID) return me;
  const cached = guild.members.cache.get(OUGI_BOT_USER_ID);
  if (cached) return cached;
  try {
    return await guild.members.fetch(OUGI_BOT_USER_ID);
  } catch {
    return me || null;
  }
}

/**
 * Give the active theme role and remove the other theme color roles — bot only.
 */
async function assignThemeRolesToBot(guild, activeThemeId, roleByTheme) {
  const bot = await resolveBotMember(guild);
  if (!bot) return false;

  const me = guild.members.me;
  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) return false;

  const themeIds = Object.keys(roleByTheme);
  const toRemove = themeIds
    .filter((id) => id !== activeThemeId && roleByTheme[id] && bot.roles.cache.has(roleByTheme[id].id))
    .map((id) => roleByTheme[id].id);
  const activeRole = roleByTheme[activeThemeId];

  try {
    if (toRemove.length) {
      const removable = toRemove.filter((rid) => {
        const role = guild.roles.cache.get(rid);
        return role && me.roles.highest.comparePositionTo(role) > 0;
      });
      if (removable.length) {
        await bot.roles.remove(removable, 'Ougi theme — bot color only');
      }
    }
    if (activeRole && !bot.roles.cache.has(activeRole.id)) {
      if (me.roles.highest.comparePositionTo(activeRole) > 0) {
        await bot.roles.add(activeRole.id, 'Ougi theme — bot color only');
      } else {
        console.error(
          `theme-roles: cannot assign ${activeThemeId} to bot — drag Ougi above the theme roles`
        );
        return false;
      }
    }
    return true;
  } catch (err) {
    console.error(`theme-roles assign bot ${guild.id}:`, err.message);
    return false;
  }
}

/**
 * Resolve theme roles, hoist active one, assign color role to bot only.
 * Does not add/remove roles on any human member.
 */
async function syncThemeAdminRoles(guild, { activeThemeId } = {}) {
  if (!guild?.available) return { created: 0, updated: 0, skipped: 'unavailable', assigned: false };

  const me = guild.members.me;
  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    return { created: 0, updated: 0, skipped: 'missing Manage Roles', assigned: false };
  }

  const cfg = loadGuild(guild.id);
  const activeId = activeThemeId || cfg.theme || 'blue';
  if (!cfg.themeAdminRoles || typeof cfg.themeAdminRoles !== 'object') {
    cfg.themeAdminRoles = {};
  }

  for (const [themeKey, roleId] of Object.entries(THEME_ROLE_IDS)) {
    const exists = await fetchRole(guild, roleId);
    if (exists) cfg.themeAdminRoles[themeKey] = roleId;
  }

  let created = 0;
  let updated = 0;
  /** @type {Record<string, import('discord.js').Role>} */
  const roleByTheme = {};

  for (const template of INTERFACE_TEMPLATES) {
    const name = roleName(template);
    const isActive = template.id === activeId;
    let role = null;

    const knownId = THEME_ROLE_IDS[template.id];
    if (knownId) role = await fetchRole(guild, knownId);

    if (!role) {
      const storedId = cfg.themeAdminRoles[template.id];
      if (storedId) role = await fetchRole(guild, storedId);
    }

    if (!role) {
      role =
        guild.roles.cache.find(
          (r) =>
            r.name === name ||
            r.name === `${template.emoji} ${template.label}` ||
            r.name === `★ ${template.emoji} ${template.label}` ||
            r.name === `${template.emoji} ★ ${template.label}` ||
            // Legacy square emojis → hearts (white / black)
            (template.id === 'white' &&
              (r.name.includes('White') || r.name.includes('white')) &&
              (r.name.includes('⬜') || r.name.includes('🤍') || r.name.includes('★'))) ||
            (template.id === 'black' &&
              (r.name.includes('Black') || r.name.includes('black')) &&
              (r.name.includes('⬛') || r.name.includes('🖤') || r.name.includes('★')))
        ) || null;
    }

    try {
      if (!role) {
        // Only create missing theme roles in guilds that don't have the known IDs
        role = await guild.roles.create({
          name,
          color: template.color,
          permissions: [PermissionFlagsBits.Administrator],
          reason: 'Ougi theme color role',
          mentionable: false,
          hoist: isActive,
        });
        created += 1;
      } else {
        const edits = {};
        if (role.name !== name && me.roles.highest.comparePositionTo(role) > 0) {
          edits.name = name;
        }
        if (role.hoist !== isActive && me.roles.highest.comparePositionTo(role) > 0) {
          edits.hoist = isActive;
        }
        if (Object.keys(edits).length) {
          await role.edit({ ...edits, reason: 'Ougi theme role sync' });
          updated += 1;
        }
      }
      cfg.themeAdminRoles[template.id] = role.id;
      roleByTheme[template.id] = role;
    } catch (err) {
      console.error(`theme-roles ${guild.id} ${template.id}:`, err.message);
    }
  }

  cfg.theme = activeId;
  saveGuild(guild.id, cfg);

  const assigned = await assignThemeRolesToBot(guild, activeId, roleByTheme);
  return { created, updated, skipped: null, assigned };
}

async function applyThemeAndSyncRoles(guild, themeId) {
  const t = getTheme(themeId);
  const cfg = loadGuild(guild.id);
  cfg.theme = t.id;
  saveGuild(guild.id, cfg);
  return syncThemeAdminRoles(guild, { activeThemeId: t.id });
}

module.exports = {
  OUGI_BOT_USER_ID,
  THEME_ROLE_IDS,
  syncThemeAdminRoles,
  applyThemeAndSyncRoles,
  roleName,
};
