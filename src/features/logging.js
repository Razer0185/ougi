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
    };
  }
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
  setLogChannel,
};
