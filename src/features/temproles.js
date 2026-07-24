'use strict';

/**
 * Temporary roles — auto-remove after duration.
 */

const { loadGuild, saveGuild } = require('../utils/store');
const { parseDuration } = require('../utils/helpers');
const { successEmbed, errorEmbed, baseEmbed } = require('../utils/embeds');

const timers = new Map();

function ensureTemp(cfg) {
  if (!cfg.tempRoles || typeof cfg.tempRoles !== 'object') {
    cfg.tempRoles = {};
  }
  return cfg.tempRoles;
}

function key(guildId, userId, roleId) {
  return `${guildId}:${userId}:${roleId}`;
}

async function grantTempRole(guild, member, role, durationMs, reason = 'Ougi temp role') {
  const cfg = loadGuild(guild.id);
  const store = ensureTemp(cfg);
  const k = key(guild.id, member.id, role.id);
  const endsAt = Date.now() + durationMs;

  await member.roles.add(role, reason);
  store[k] = {
    guildId: guild.id,
    userId: member.id,
    roleId: role.id,
    endsAt,
  };
  saveGuild(guild.id, cfg);
  armTimer(guild.client, store[k]);
  return store[k];
}

function armTimer(client, entry) {
  const k = key(entry.guildId, entry.userId, entry.roleId);
  if (timers.has(k)) {
    clearTimeout(timers.get(k));
    timers.delete(k);
  }
  const delay = Math.max(1000, entry.endsAt - Date.now());
  const t = setTimeout(() => {
    timers.delete(k);
    expireTempRole(client, entry).catch((err) => console.error('Temp role expire:', err.message));
  }, delay);
  if (typeof t.unref === 'function') t.unref();
  timers.set(k, t);
}

async function expireTempRole(client, entry) {
  const guild = await client.guilds.fetch(entry.guildId).catch(() => null);
  if (!guild) return;
  const member = await guild.members.fetch(entry.userId).catch(() => null);
  if (member) {
    await member.roles.remove(entry.roleId, 'Ougi temp role expired').catch(() => {});
  }
  const cfg = loadGuild(entry.guildId);
  const store = ensureTemp(cfg);
  delete store[key(entry.guildId, entry.userId, entry.roleId)];
  saveGuild(entry.guildId, cfg);
}

async function resumeTempRoles(client) {
  for (const [guildId] of client.guilds.cache) {
    const store = ensureTemp(loadGuild(guildId));
    for (const entry of Object.values(store)) {
      if (entry.endsAt <= Date.now()) {
        await expireTempRole(client, entry);
      } else {
        armTimer(client, entry);
      }
    }
  }
}

module.exports = {
  grantTempRole,
  resumeTempRoles,
  parseDuration,
  successEmbed,
  errorEmbed,
  baseEmbed,
};
