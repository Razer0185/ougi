const {
  PermissionFlagsBits,
  ChannelType,
  OverwriteType,
} = require('discord.js');

function memberHasMod(member) {
  if (!member) return false;
  return (
    member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
    member.permissions.has(PermissionFlagsBits.KickMembers) ||
    member.permissions.has(PermissionFlagsBits.BanMembers) ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

function memberHasAdmin(member) {
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

async function resolveMember(guild, query) {
  if (!query) return null;
  const cleaned = query.replace(/[<@!>]/g, '').trim();
  if (/^\d{16,20}$/.test(cleaned)) {
    try {
      return await guild.members.fetch(cleaned);
    } catch {
      return null;
    }
  }
  const lower = cleaned.toLowerCase();
  const cached = guild.members.cache.find(
    (m) =>
      m.user.username.toLowerCase() === lower ||
      m.displayName.toLowerCase() === lower ||
      m.user.tag?.toLowerCase() === lower
  );
  if (cached) return cached;
  try {
    const fetched = await guild.members.fetch({ query: cleaned, limit: 1 });
    return fetched.first() || null;
  } catch {
    return null;
  }
}

/**
 * Resolve a channel from mention (#general), ID, or name.
 * Examples: #rules, <#id>, rules, 123456789012345678
 */
async function resolveChannel(guild, query, options = {}) {
  if (!guild || !query) return null;
  const raw = String(query).trim();
  if (!raw) return null;

  const mention = raw.match(/^<#(\d+)>$/);
  const id = mention?.[1] || (/^\d{16,20}$/.test(raw) ? raw : null);
  if (id) {
    const byId =
      guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
    if (byId && channelTypeAllowed(byId, options.types)) return byId;
    return null;
  }

  const name = raw.replace(/^#/, '').toLowerCase();
  const list = [...guild.channels.cache.values()].filter((c) =>
    channelTypeAllowed(c, options.types)
  );

  const exact = list.find((c) => c.name.toLowerCase() === name);
  if (exact) return exact;

  const starts = list.find((c) => c.name.toLowerCase().startsWith(name));
  if (starts) return starts;

  const includes = list.find((c) => c.name.toLowerCase().includes(name));
  return includes || null;
}

function channelTypeAllowed(channel, types) {
  if (!types || !types.length) return true;
  return types.includes(channel.type);
}

async function ensureMutedRole(guild, store) {
  const { loadGuild, saveGuild } = store;
  const cfg = loadGuild(guild.id);
  if (cfg.mutedRoleId) {
    const existing = guild.roles.cache.get(cfg.mutedRoleId);
    if (existing) return existing;
  }
  const role = await guild.roles.create({
    name: 'Muted',
    color: 0x555555,
    reason: 'Ougi mute role',
    permissions: [],
  });
  for (const channel of guild.channels.cache.values()) {
    try {
      if (
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildVoice ||
        channel.type === ChannelType.GuildForum ||
        channel.type === ChannelType.GuildAnnouncement
      ) {
        await channel.permissionOverwrites.edit(role, {
          SendMessages: false,
          AddReactions: false,
          Speak: false,
          SendMessagesInThreads: false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false,
        });
      }
    } catch {
      /* ignore channels we can't edit */
    }
  }
  cfg.mutedRoleId = role.id;
  saveGuild(guild.id, cfg);
  return role;
}

async function lockChannel(channel) {
  const everyone = channel.guild.roles.everyone;
  await channel.permissionOverwrites.edit(everyone, {
    SendMessages: false,
    AddReactions: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    SendMessagesInThreads: false,
    Connect: false,
    Speak: false,
  });
}

async function unlockChannel(channel) {
  const everyone = channel.guild.roles.everyone;
  await channel.permissionOverwrites.edit(everyone, {
    SendMessages: null,
    AddReactions: null,
    CreatePublicThreads: null,
    CreatePrivateThreads: null,
    SendMessagesInThreads: null,
    Connect: null,
    Speak: null,
  });
}

async function setInvitesDisabled(guild, disabled) {
  const everyone = guild.roles.everyone;
  await everyone.setPermissions(
    disabled
      ? everyone.permissions.remove(PermissionFlagsBits.CreateInstantInvite)
      : everyone.permissions.add(PermissionFlagsBits.CreateInstantInvite)
  );
}

function parseDuration(input) {
  if (!input) return 60 * 60 * 1000;
  const match = String(input).match(/^(\d+)(s|m|h|d)?$/i);
  if (!match) return 60 * 60 * 1000;
  const n = Number(match[1]);
  const unit = (match[2] || 'm').toLowerCase();
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
  return Math.min(n * mult, 28 * 86400000);
}

function formatList(lines) {
  return lines.map((l) => `→ ${l}`).join('\n');
}

/**
 * Nuke a text channel: clone it (keeps name/perms/position), delete the original.
 * Clears every message including ones older than 14 days.
 */
async function nukeChannel(channel, reason = 'Channel nuked') {
  if (!channel || !channel.isTextBased?.() || channel.isDMBased?.()) {
    throw new Error('Nuke only works in a server text channel.');
  }
  if (channel.isThread?.()) {
    throw new Error('Cannot nuke a thread. Run this in the parent channel.');
  }

  const position = channel.position;
  const cloned = await channel.clone({
    reason,
    name: channel.name,
  });
  await cloned.setPosition(position).catch(() => {});
  await channel.delete(reason);

  return cloned;
}

/** After a nuke, retarget panel / welcome / invite-log if they pointed at the old channel. */
function retargetAfterNuke(guildId, oldChannelId, newChannelId) {
  const { loadGuild, saveGuild } = require('./store');
  const cfg = loadGuild(guildId);
  let changed = false;
  if (cfg.panelChannelId === oldChannelId) {
    cfg.panelChannelId = newChannelId;
    cfg.panelMessageId = null;
    changed = true;
  }
  if (cfg.welcome?.channelId === oldChannelId) {
    cfg.welcome.channelId = newChannelId;
    changed = true;
  }
  if (cfg.invites?.logChannelId === oldChannelId) {
    cfg.invites.logChannelId = newChannelId;
    changed = true;
  }
  if (changed) saveGuild(guildId, cfg);
}

module.exports = {
  memberHasMod,
  memberHasAdmin,
  resolveMember,
  resolveChannel,
  ensureMutedRole,
  lockChannel,
  unlockChannel,
  nukeChannel,
  retargetAfterNuke,
  setInvitesDisabled,
  parseDuration,
  formatList,
  PermissionFlagsBits,
  ChannelType,
  OverwriteType,
};
