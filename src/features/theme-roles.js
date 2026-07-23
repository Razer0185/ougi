'use strict';

/**
 * Theme admin roles — one Administrator role per interface color.
 * Created when the bot joins / runs setup; names + colors refresh when theme changes.
 */

const { PermissionFlagsBits } = require('discord.js');
const { INTERFACE_TEMPLATES, getTheme } = require('../utils/theme');
const { loadGuild, saveGuild } = require('../utils/store');

function roleName(template, activeId) {
  const star = template.id === activeId ? '★ ' : '';
  return `${star}${template.emoji} ${template.label}`.slice(0, 100);
}

/**
 * Ensure every theme color has an Administrator role; update names/colors.
 * @returns {{ created: number, updated: number, skipped: string|null }}
 */
async function syncThemeAdminRoles(guild, { activeThemeId } = {}) {
  if (!guild?.available) return { created: 0, updated: 0, skipped: 'unavailable' };

  const me = guild.members.me;
  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    return { created: 0, updated: 0, skipped: 'missing Manage Roles' };
  }

  const cfg = loadGuild(guild.id);
  const activeId = activeThemeId || cfg.theme || 'blue';
  if (!cfg.themeAdminRoles || typeof cfg.themeAdminRoles !== 'object') {
    cfg.themeAdminRoles = {};
  }

  let created = 0;
  let updated = 0;

  for (const template of INTERFACE_TEMPLATES) {
    const name = roleName(template, activeId);
    let role = null;
    const storedId = cfg.themeAdminRoles[template.id];
    if (storedId) {
      role = guild.roles.cache.get(storedId) || null;
      if (!role) {
        try {
          role = await guild.roles.fetch(storedId);
        } catch {
          role = null;
        }
      }
    }

    // Recover by name if ID was lost
    if (!role) {
      role =
        guild.roles.cache.find(
          (r) =>
            r.name === name ||
            r.name === `${template.emoji} ${template.label}` ||
            r.name === `★ ${template.emoji} ${template.label}`
        ) || null;
    }

    try {
      if (!role) {
        role = await guild.roles.create({
          name,
          color: template.color,
          permissions: [PermissionFlagsBits.Administrator],
          reason: 'Ougi theme admin roles',
          mentionable: false,
          hoist: false,
        });
        created += 1;
      } else {
        const patch = {};
        if (role.name !== name) patch.name = name;
        if (role.hexColor?.toLowerCase() !== `#${template.color.toString(16).padStart(6, '0')}`) {
          patch.color = template.color;
        }
        // Keep Administrator if someone stripped it
        if (!role.permissions.has(PermissionFlagsBits.Administrator)) {
          patch.permissions = role.permissions.add(PermissionFlagsBits.Administrator);
        }
        if (Object.keys(patch).length) {
          // Only edit roles below the bot
          if (me.roles.highest.comparePositionTo(role) > 0) {
            await role.edit({ ...patch, reason: 'Ougi theme sync' });
            updated += 1;
          }
        }
      }
      cfg.themeAdminRoles[template.id] = role.id;
    } catch (err) {
      console.error(`theme-roles ${guild.id} ${template.id}:`, err.message);
    }
  }

  cfg.theme = activeId;
  saveGuild(guild.id, cfg);
  return { created, updated, skipped: null };
}

async function applyThemeAndSyncRoles(guild, themeId) {
  const t = getTheme(themeId);
  const cfg = loadGuild(guild.id);
  cfg.theme = t.id;
  saveGuild(guild.id, cfg);
  return syncThemeAdminRoles(guild, { activeThemeId: t.id });
}

module.exports = {
  syncThemeAdminRoles,
  applyThemeAndSyncRoles,
  roleName,
};
