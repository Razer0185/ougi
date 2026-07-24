'use strict';

const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed } = require('../utils/embeds');

function ensureLogging(cfg) {
  if (!cfg.logging || typeof cfg.logging !== 'object') {
    cfg.logging = {
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
    };
  }
  if (cfg.logging.nickname == null) cfg.logging.nickname = true;
  if (cfg.logging.channels == null) cfg.logging.channels = true;
  return cfg;
}

async function sendLog(guild, title, description) {
  const cfg = ensureLogging(loadGuild(guild.id));
  if (!cfg.logging.enabled || !cfg.logging.channelId) return;
  const ch = guild.channels.cache.get(cfg.logging.channelId);
  if (!ch?.isTextBased?.()) return;
  await ch
    .send({
      embeds: [baseEmbed(guild.id, { title, description, footer: 'Server Log' })],
    })
    .catch(() => {});
}

async function logMessageDelete(message) {
  if (!message.guild || message.author?.bot) return;
  const cfg = ensureLogging(loadGuild(message.guild.id));
  if (!cfg.logging.messageDelete) return;
  const content = message.content?.slice(0, 1000) || '_embed/attachment/empty_';
  await sendLog(
    message.guild,
    'Message Deleted',
    `→ __**Author:**__ ${message.author} (\`${message.author?.id}\`)\n` +
      `→ __**Channel:**__ ${message.channel}\n` +
      `→ __**Content:**__ ${content}`
  );
}

async function logMessageUpdate(oldMessage, newMessage) {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;
  const cfg = ensureLogging(loadGuild(newMessage.guild.id));
  if (!cfg.logging.messageEdit) return;
  await sendLog(
    newMessage.guild,
    'Message Edited',
    `→ __**Author:**__ ${newMessage.author}\n` +
      `→ __**Channel:**__ ${newMessage.channel}\n` +
      `→ __**Before:**__ ${(oldMessage.content || '').slice(0, 500) || '_empty_'}\n` +
      `→ __**After:**__ ${(newMessage.content || '').slice(0, 500) || '_empty_'}`
  );
}

async function logMemberJoinDetail(member) {
  const cfg = ensureLogging(loadGuild(member.guild.id));
  if (!cfg.logging.memberJoin) return;
  await sendLog(
    member.guild,
    'Member Joined',
    `→ __**User:**__ ${member.user.tag} (\`${member.id}\`)\n` +
      `→ __**Account:**__ <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`
  );
}

async function logMemberLeaveDetail(member) {
  const cfg = ensureLogging(loadGuild(member.guild.id));
  if (!cfg.logging.memberLeave) return;
  await sendLog(
    member.guild,
    'Member Left',
    `→ __**User:**__ ${member.user?.tag || member.id} (\`${member.id}\`)`
  );
}

async function logGuildBanAdd(ban) {
  const cfg = ensureLogging(loadGuild(ban.guild.id));
  if (!cfg.logging.bans) return;
  await sendLog(
    ban.guild,
    'Member Banned',
    `→ __**User:**__ ${ban.user.tag} (\`${ban.user.id}\`)\n` +
      `→ __**Reason:**__ ${ban.reason || '_none_'}`
  );
}

async function logGuildBanRemove(ban) {
  const cfg = ensureLogging(loadGuild(ban.guild.id));
  if (!cfg.logging.bans) return;
  await sendLog(
    ban.guild,
    'Member Unbanned',
    `→ __**User:**__ ${ban.user.tag} (\`${ban.user.id}\`)`
  );
}

async function logGuildMemberUpdate(oldMember, newMember) {
  const cfg = ensureLogging(loadGuild(newMember.guild.id));

  if (cfg.logging.nickname) {
    const oldNick = oldMember.nickname || oldMember.user?.username;
    const newNick = newMember.nickname || newMember.user?.username;
    if (oldMember.nickname !== newMember.nickname) {
      await sendLog(
        newMember.guild,
        'Nickname Changed',
        `→ __**Member:**__ ${newMember.user.tag} (\`${newMember.id}\`)\n` +
          `→ __**Before:**__ ${oldNick || '_none_'}\n` +
          `→ __**After:**__ ${newNick || '_none_'}`
      );
    }
  }

  if (!cfg.logging.roleChanges) return;
  const oldIds = new Set(oldMember.roles.cache.keys());
  const newIds = new Set(newMember.roles.cache.keys());
  const added = [...newIds].filter((id) => !oldIds.has(id) && id !== newMember.guild.id);
  const removed = [...oldIds].filter((id) => !newIds.has(id) && id !== newMember.guild.id);
  if (!added.length && !removed.length) return;
  const fmt = (ids) =>
    ids.map((id) => newMember.guild.roles.cache.get(id)?.toString() || id).join(', ') || '_none_';
  await sendLog(
    newMember.guild,
    'Roles Updated',
    `→ __**Member:**__ ${newMember.user.tag}\n` +
      `→ __**Added:**__ ${fmt(added)}\n` +
      `→ __**Removed:**__ ${fmt(removed)}`
  );
}

async function logChannelCreate(channel) {
  if (!channel.guild) return;
  const cfg = ensureLogging(loadGuild(channel.guild.id));
  if (!cfg.logging.channels) return;
  await sendLog(
    channel.guild,
    'Channel Created',
    `→ __**Name:**__ ${channel}\n→ __**Type:**__ ${channel.type}\n→ __**ID:**__ \`${channel.id}\``
  );
}

async function logChannelDelete(channel) {
  if (!channel.guild) return;
  const cfg = ensureLogging(loadGuild(channel.guild.id));
  if (!cfg.logging.channels) return;
  await sendLog(
    channel.guild,
    'Channel Deleted',
    `→ __**Name:**__ #${channel.name || 'unknown'}\n→ __**ID:**__ \`${channel.id}\``
  );
}

async function logChannelUpdate(oldChannel, newChannel) {
  if (!newChannel.guild) return;
  const cfg = ensureLogging(loadGuild(newChannel.guild.id));
  if (!cfg.logging.channels) return;
  if (oldChannel.name === newChannel.name && oldChannel.topic === newChannel.topic) return;
  await sendLog(
    newChannel.guild,
    'Channel Updated',
    `→ __**Channel:**__ ${newChannel}\n` +
      (oldChannel.name !== newChannel.name
        ? `→ __**Name:**__ ${oldChannel.name} → ${newChannel.name}\n`
        : '') +
      (oldChannel.topic !== newChannel.topic
        ? `→ __**Topic changed**__\n`
        : '')
  );
}

async function logVoiceState(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;
  const cfg = ensureLogging(loadGuild(guild.id));
  if (!cfg.logging.voice) return;
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  if (!oldState.channelId && newState.channelId) {
    await sendLog(
      guild,
      'Voice Join',
      `→ __**User:**__ ${member}\n→ __**Channel:**__ <#${newState.channelId}>`
    );
  } else if (oldState.channelId && !newState.channelId) {
    await sendLog(
      guild,
      'Voice Leave',
      `→ __**User:**__ ${member}\n→ __**Channel:**__ <#${oldState.channelId}>`
    );
  } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    await sendLog(
      guild,
      'Voice Move',
      `→ __**User:**__ ${member}\n` +
        `→ __**From:**__ <#${oldState.channelId}>\n` +
        `→ __**To:**__ <#${newState.channelId}>`
    );
  }
}

function setLogChannel(guildId, channelId) {
  const cfg = ensureLogging(loadGuild(guildId));
  cfg.logging.channelId = channelId;
  cfg.logging.enabled = true;
  saveGuild(guildId, cfg);
}

module.exports = {
  ensureLogging,
  sendLog,
  logMessageDelete,
  logMessageUpdate,
  logMemberJoinDetail,
  logMemberLeaveDetail,
  logGuildBanAdd,
  logGuildBanRemove,
  logGuildMemberUpdate,
  logVoiceState,
  logChannelCreate,
  logChannelDelete,
  logChannelUpdate,
  setLogChannel,
};
