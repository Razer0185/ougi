'use strict';

/**
 * Anti-raid: lock down the server when too many members join too fast.
 */

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { loadGuild, saveGuild } = require('../utils/store');
const { successEmbed, errorEmbed, baseEmbed } = require('../utils/embeds');

const joinBuckets = new Map(); // guildId -> timestamps[]

function ensureRaid(cfg) {
  if (!cfg.antiraid || typeof cfg.antiraid !== 'object') {
    cfg.antiraid = {
      enabled: true,
      joinsPerMinute: 8,
      action: 'lock', // lock | kick | none
      lockdown: false,
      lockedAt: null,
      exemptRoleIds: [],
    };
  }
  if (!Array.isArray(cfg.antiraid.exemptRoleIds)) cfg.antiraid.exemptRoleIds = [];
  return cfg.antiraid;
}

function recordJoin(guildId) {
  const now = Date.now();
  const arr = (joinBuckets.get(guildId) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  joinBuckets.set(guildId, arr);
  return arr.length;
}

async function handleRaidJoin(member) {
  const cfg = loadGuild(member.guild.id);
  const raid = ensureRaid(cfg);
  if (!raid.enabled) return null;

  // Staff / exempt roles do not count toward flood and are never kicked
  if (raid.exemptRoleIds?.length && member.roles?.cache) {
    for (const id of raid.exemptRoleIds) {
      if (member.roles.cache.has(id)) return null;
    }
  }

  const count = recordJoin(member.guild.id);
  if (count < (raid.joinsPerMinute || 8)) return null;

  if (raid.action === 'kick') {
    await member.kick('Ougi anti-raid: join flood').catch(() => {});
    return { triggered: true, action: 'kick', count };
  }

  if (raid.action === 'lock' && !raid.lockdown) {
    raid.lockdown = true;
    raid.lockedAt = Date.now();
    saveGuild(member.guild.id, cfg);
    await applyLockdown(member.guild, true);
    const logId = cfg.moderation?.modLogChannelId || cfg.logging?.channelId;
    const logCh = logId && member.guild.channels.cache.get(logId);
    if (logCh) {
      await logCh
        .send({
          embeds: [
            errorEmbed(
              member.guild.id,
              'Anti-Raid Triggered',
              `**${count}** joins in 60s. Server lockdown **ON**.\nNew members: verify/pending.\nDisable: \`antiraid unlock\``
            ),
          ],
        })
        .catch(() => {});
    }
    return { triggered: true, action: 'lock', count };
  }

  return { triggered: raid.lockdown, action: 'already', count };
}

async function applyLockdown(guild, on) {
  const everyone = guild.roles.everyone;
  // Restrict @everyone from sending in text channels (best-effort)
  for (const ch of guild.channels.cache.values()) {
    if (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement) continue;
    if (!ch.manageable) continue;
    try {
      if (on) {
        await ch.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason: 'Ougi anti-raid lockdown' });
      } else {
        await ch.permissionOverwrites.edit(everyone, { SendMessages: null }, { reason: 'Ougi anti-raid unlock' });
      }
    } catch {
      /* ignore per-channel */
    }
  }
}

async function setRaidEnabled(guildId, enabled) {
  const cfg = loadGuild(guildId);
  const raid = ensureRaid(cfg);
  raid.enabled = !!enabled;
  saveGuild(guildId, cfg);
  return raid;
}

async function unlockRaid(guild) {
  const cfg = loadGuild(guild.id);
  const raid = ensureRaid(cfg);
  raid.lockdown = false;
  raid.lockedAt = null;
  saveGuild(guild.id, cfg);
  await applyLockdown(guild, false);
  return raid;
}

module.exports = {
  ensureRaid,
  handleRaidJoin,
  setRaidEnabled,
  unlockRaid,
  applyLockdown,
  successEmbed,
  errorEmbed,
  baseEmbed,
};
