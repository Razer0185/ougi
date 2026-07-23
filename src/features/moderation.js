const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');
const { resolveChannel } = require('../utils/helpers');

function ensureMod(cfg) {
  if (!cfg.moderation || typeof cfg.moderation !== 'object') {
    cfg.moderation = { caseCounter: 0, cases: [], modLogChannelId: null };
  }
  if (!Array.isArray(cfg.moderation.cases)) cfg.moderation.cases = [];
  if (cfg.moderation.caseCounter == null) cfg.moderation.caseCounter = 0;
  if (cfg.modLogChannelId && !cfg.moderation.modLogChannelId) {
    cfg.moderation.modLogChannelId = cfg.modLogChannelId;
  }
  return cfg;
}

function nextCaseId(guildId) {
  const cfg = ensureMod(loadGuild(guildId));
  cfg.moderation.caseCounter += 1;
  saveGuild(guildId, cfg);
  return cfg.moderation.caseCounter;
}

function addCase(guildId, entry) {
  const cfg = ensureMod(loadGuild(guildId));
  const id = ++cfg.moderation.caseCounter;
  const row = {
    id,
    type: entry.type,
    userId: entry.userId,
    modId: entry.modId,
    reason: entry.reason || 'No reason provided',
    at: Date.now(),
  };
  cfg.moderation.cases.push(row);
  if (cfg.moderation.cases.length > 500) {
    cfg.moderation.cases = cfg.moderation.cases.slice(-500);
  }
  saveGuild(guildId, cfg);
  return row;
}

function getCasesForUser(guildId, userId) {
  const cfg = ensureMod(loadGuild(guildId));
  return cfg.moderation.cases.filter((c) => c.userId === userId);
}

function clearWarns(guildId, userId) {
  const cfg = ensureMod(loadGuild(guildId));
  const before = cfg.moderation.cases.length;
  cfg.moderation.cases = cfg.moderation.cases.filter(
    (c) => !(c.userId === userId && c.type === 'warn')
  );
  saveGuild(guildId, cfg);
  return before - cfg.moderation.cases.length;
}

async function sendModLog(guild, payload) {
  const cfg = ensureMod(loadGuild(guild.id));
  const channelId = cfg.moderation.modLogChannelId || cfg.logChannelId;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased?.()) return;

  const embed = baseEmbed(guild.id, {
    title: `Mod Log · ${payload.action}`,
    description: [
      `→ __**User:**__ ${payload.userTag || `<@${payload.userId}>`} (\`${payload.userId}\`)`,
      `→ __**Moderator:**__ <@${payload.modId}>`,
      payload.caseId != null ? `→ __**Case:**__ #${payload.caseId}` : null,
      `→ __**Reason:**__ ${payload.reason || 'No reason provided'}`,
      payload.extra ? `→ __**Extra:**__ ${payload.extra}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    footer: 'Moderation',
  });
  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function warnMember(guild, { target, moderator, reason }) {
  const row = addCase(guild.id, {
    type: 'warn',
    userId: target.id,
    modId: moderator.id,
    reason,
  });
  await target
    .send({
      embeds: [
        errorEmbed(
          guild.id,
          'Warning',
          `You were warned in **${guild.name}**.\nReason: ${reason}\nCase #${row.id}`
        ),
      ],
    })
    .catch(() => {});
  await sendModLog(guild, {
    action: 'Warn',
    userId: target.id,
    userTag: target.user?.tag || target.tag,
    modId: moderator.id,
    reason,
    caseId: row.id,
  });
  return row;
}

async function softbanMember(guild, { target, moderator, reason, days = 1 }) {
  const userId = target.id || target.user?.id;
  const tag = target.user?.tag || target.tag || String(userId);
  await guild.members.ban(userId, {
    deleteMessageSeconds: Math.min(Math.max(Number(days) || 1, 0), 7) * 86400,
    reason: `Softban by ${moderator.tag}: ${reason}`,
  });
  await guild.members.unban(userId, `Softban complete`).catch(() => {});
  const row = addCase(guild.id, {
    type: 'softban',
    userId,
    modId: moderator.id,
    reason,
  });
  await sendModLog(guild, {
    action: 'Softban',
    userId,
    userTag: tag,
    modId: moderator.id,
    reason,
    caseId: row.id,
    extra: `Deleted up to ${days}d of messages`,
  });
  return row;
}

async function purgeMessages(channel, { amount = 10, userId = null }) {
  const limit = Math.min(Math.max(Number(amount) || 10, 1), 100);
  const fetched = await channel.messages.fetch({ limit: 100 });
  let list = [...fetched.values()].filter((m) => Date.now() - m.createdTimestamp < 14 * 86400000);
  if (userId) list = list.filter((m) => m.author.id === userId);
  list = list.slice(0, limit);
  if (!list.length) return 0;
  const deleted = await channel.bulkDelete(list, true).catch(() => null);
  return deleted?.size || list.length;
}

async function setSlowmode(channel, seconds) {
  const s = Math.min(Math.max(Number(seconds) || 0, 0), 21600);
  await channel.setRateLimitPerUser(s);
  return s;
}

async function setModLogChannel(guildId, channelId) {
  const cfg = ensureMod(loadGuild(guildId));
  cfg.moderation.modLogChannelId = channelId;
  cfg.logChannelId = channelId;
  saveGuild(guildId, cfg);
}

module.exports = {
  ensureMod,
  addCase,
  getCasesForUser,
  clearWarns,
  sendModLog,
  warnMember,
  softbanMember,
  purgeMessages,
  setSlowmode,
  setModLogChannel,
  nextCaseId,
  resolveChannel,
  successEmbed,
  errorEmbed,
  baseEmbed,
};
