'use strict';

const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');
const { resolveChannel, parseDuration, ensureMutedRole } = require('../utils/helpers');

function ensureMod(cfg) {
  if (!cfg.moderation || typeof cfg.moderation !== 'object') {
    cfg.moderation = {
      caseCounter: 0,
      cases: [],
      modLogChannelId: null,
      warnLadder: {
        enabled: true,
        muteAt: 3,
        kickAt: 5,
        banAt: 0,
        muteDuration: '1h',
      },
    };
  }
  if (!Array.isArray(cfg.moderation.cases)) cfg.moderation.cases = [];
  if (cfg.moderation.caseCounter == null) cfg.moderation.caseCounter = 0;
  if (cfg.modLogChannelId && !cfg.moderation.modLogChannelId) {
    cfg.moderation.modLogChannelId = cfg.modLogChannelId;
  }
  if (!cfg.moderation.warnLadder || typeof cfg.moderation.warnLadder !== 'object') {
    cfg.moderation.warnLadder = {
      enabled: true,
      muteAt: 3,
      kickAt: 5,
      banAt: 0,
      muteDuration: '1h',
    };
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
    note: entry.note || null,
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

function getCase(guildId, caseId) {
  const cfg = ensureMod(loadGuild(guildId));
  return cfg.moderation.cases.find((c) => c.id === Number(caseId)) || null;
}

function countWarns(guildId, userId) {
  return getCasesForUser(guildId, userId).filter((c) => c.type === 'warn').length;
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

function updateCase(guildId, caseId, patch) {
  const cfg = ensureMod(loadGuild(guildId));
  const row = cfg.moderation.cases.find((c) => c.id === Number(caseId));
  if (!row) return null;
  if (patch.reason != null) row.reason = String(patch.reason).slice(0, 500);
  if (patch.note != null) row.note = String(patch.note).slice(0, 500);
  saveGuild(guildId, cfg);
  return row;
}

function deleteCase(guildId, caseId) {
  const cfg = ensureMod(loadGuild(guildId));
  const before = cfg.moderation.cases.length;
  cfg.moderation.cases = cfg.moderation.cases.filter((c) => c.id !== Number(caseId));
  saveGuild(guildId, cfg);
  return before !== cfg.moderation.cases.length;
}

function ensureTempBans(cfg) {
  ensureMod(cfg);
  if (!Array.isArray(cfg.moderation.tempBans)) cfg.moderation.tempBans = [];
  return cfg.moderation.tempBans;
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

async function muteMember(guild, { target, moderator, reason, durationMs, store }) {
  const duration = durationMs || 60 * 60 * 1000;
  try {
    await target.timeout(duration, `${moderator.tag || moderator.username}: ${reason}`);
  } catch {
    if (store) {
      const role = await ensureMutedRole(guild, store);
      await target.roles.add(role, reason);
    } else {
      throw new Error('Could not timeout member (missing permissions).');
    }
  }
  const row = addCase(guild.id, {
    type: 'mute',
    userId: target.id,
    modId: moderator.id,
    reason,
  });
  await sendModLog(guild, {
    action: 'Mute',
    userId: target.id,
    userTag: target.user?.tag || target.tag,
    modId: moderator.id,
    reason,
    caseId: row.id,
    extra: `Duration ~${Math.round(duration / 60000)}m`,
  });
  return row;
}

async function unmuteMember(guild, { target, moderator, reason }) {
  await target.timeout(null).catch(() => {});
  const cfg = loadGuild(guild.id);
  if (cfg.mutedRoleId && target.roles.cache.has(cfg.mutedRoleId)) {
    await target.roles.remove(cfg.mutedRoleId).catch(() => {});
  }
  const row = addCase(guild.id, {
    type: 'unmute',
    userId: target.id,
    modId: moderator.id,
    reason: reason || 'Unmuted',
  });
  await sendModLog(guild, {
    action: 'Unmute',
    userId: target.id,
    userTag: target.user?.tag || target.tag,
    modId: moderator.id,
    reason: reason || 'Unmuted',
    caseId: row.id,
  });
  return row;
}

async function applyWarnLadder(guild, target, moderator) {
  const cfg = ensureMod(loadGuild(guild.id));
  const ladder = cfg.moderation.warnLadder;
  if (!ladder?.enabled) return null;

  const warns = countWarns(guild.id, target.id);
  const store = require('../utils/store');

  if (ladder.banAt > 0 && warns >= ladder.banAt) {
    await target.ban({ reason: `Warn ladder: ${warns} warnings` }).catch(() => null);
    const row = addCase(guild.id, {
      type: 'ban',
      userId: target.id,
      modId: moderator.id,
      reason: `Auto-ban: reached ${warns} warnings`,
    });
    await sendModLog(guild, {
      action: 'Auto-Ban (warn ladder)',
      userId: target.id,
      userTag: target.user?.tag,
      modId: moderator.id,
      reason: `${warns} warnings`,
      caseId: row.id,
    });
    return { action: 'ban', warns, row };
  }

  if (ladder.kickAt > 0 && warns >= ladder.kickAt) {
    await target.kick(`Warn ladder: ${warns} warnings`).catch(() => null);
    const row = addCase(guild.id, {
      type: 'kick',
      userId: target.id,
      modId: moderator.id,
      reason: `Auto-kick: reached ${warns} warnings`,
    });
    await sendModLog(guild, {
      action: 'Auto-Kick (warn ladder)',
      userId: target.id,
      userTag: target.user?.tag,
      modId: moderator.id,
      reason: `${warns} warnings`,
      caseId: row.id,
    });
    return { action: 'kick', warns, row };
  }

  if (ladder.muteAt > 0 && warns >= ladder.muteAt && warns % ladder.muteAt === 0) {
    const ms = parseDuration(ladder.muteDuration || '1h');
    const row = await muteMember(guild, {
      target,
      moderator,
      reason: `Auto-mute: reached ${warns} warnings`,
      durationMs: ms,
      store,
    });
    return { action: 'mute', warns, row };
  }

  return { action: null, warns };
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

  const ladder = await applyWarnLadder(guild, target, moderator).catch(() => null);
  return { ...row, ladder };
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

async function banMember(guild, { target, moderator, reason, deleteDays = 0, dm = true }) {
  const userId = target.id || target.user?.id;
  const tag = target.user?.tag || target.tag || String(userId);
  const days = Math.min(Math.max(Number(deleteDays) || 0, 0), 7);
  if (dm && target.send) {
    await target
      .send({
        embeds: [
          errorEmbed(
            guild.id,
            'Banned',
            `You were banned from **${guild.name}**.\nReason: ${reason}`
          ),
        ],
      })
      .catch(() => {});
  }
  await guild.members.ban(userId, {
    deleteMessageSeconds: days * 86400,
    reason: `${moderator.tag || moderator.username}: ${reason}`,
  });
  const row = addCase(guild.id, {
    type: 'ban',
    userId,
    modId: moderator.id,
    reason,
  });
  await sendModLog(guild, {
    action: 'Ban',
    userId,
    userTag: tag,
    modId: moderator.id,
    reason,
    caseId: row.id,
    extra: days ? `Deleted up to ${days}d of messages` : null,
  });
  return row;
}

async function tempbanMember(guild, { target, moderator, reason, durationMs, deleteDays = 0 }) {
  const userId = target.id || target.user?.id;
  const tag = target.user?.tag || target.tag || String(userId);
  const ms = Math.max(Number(durationMs) || 0, 60_000);
  const unbanAt = Date.now() + ms;
  const row = await banMember(guild, {
    target,
    moderator,
    reason: `Tempban (${Math.round(ms / 3600000)}h): ${reason}`,
    deleteDays,
    dm: true,
  });
  // Also update case type in array after banMember
  const cfgFix = ensureMod(loadGuild(guild.id));
  const found = cfgFix.moderation.cases.find((c) => c.id === row.id);
  if (found) {
    found.type = 'tempban';
    found.reason = `Tempban until <t:${Math.floor(unbanAt / 1000)}:f>: ${reason}`;
    saveGuild(guild.id, cfgFix);
  }
  const cfg = ensureMod(loadGuild(guild.id));
  ensureTempBans(cfg);
  cfg.moderation.tempBans = cfg.moderation.tempBans.filter((t) => t.userId !== userId);
  cfg.moderation.tempBans.push({
    userId,
    unbanAt,
    reason,
    modId: moderator.id,
    caseId: row.id,
    tag,
  });
  saveGuild(guild.id, cfg);
  await sendModLog(guild, {
    action: 'Tempban scheduled',
    userId,
    userTag: tag,
    modId: moderator.id,
    reason,
    caseId: row.id,
    extra: `Unban <t:${Math.floor(unbanAt / 1000)}:R>`,
  });
  return { ...row, type: 'tempban', unbanAt, tag };
}

async function processExpiredTempBans(client) {
  for (const guild of client.guilds.cache.values()) {
    const cfg = ensureMod(loadGuild(guild.id));
    const list = ensureTempBans(cfg);
    if (!list.length) continue;
    const due = list.filter((t) => t.unbanAt <= Date.now());
    if (!due.length) continue;
    const remaining = [];
    for (const t of list) {
      if (t.unbanAt > Date.now()) {
        remaining.push(t);
        continue;
      }
      await guild.members.unban(t.userId, `Tempban expired`).catch(() => {});
      const row = addCase(guild.id, {
        type: 'unban',
        userId: t.userId,
        modId: t.modId || client.user.id,
        reason: `Tempban expired (${t.reason || 'no reason'})`,
      });
      await sendModLog(guild, {
        action: 'Tempban Expired',
        userId: t.userId,
        userTag: t.tag,
        modId: t.modId || client.user.id,
        reason: t.reason || 'Tempban ended',
        caseId: row.id,
      });
    }
    cfg.moderation.tempBans = remaining;
    saveGuild(guild.id, cfg);
  }
}

function resumeTempBans(client) {
  const tick = () => processExpiredTempBans(client).catch(() => {});
  tick();
  setInterval(tick, 30_000);
}

async function purgeMessages(channel, { amount = 10, userId = null, filter = null, contains = null }) {
  const limit = Math.min(Math.max(Number(amount) || 10, 1), 100);
  const fetched = await channel.messages.fetch({ limit: 100 });
  let list = [...fetched.values()].filter((m) => Date.now() - m.createdTimestamp < 14 * 86400000);
  if (userId) list = list.filter((m) => m.author.id === userId);
  const f = String(filter || '').toLowerCase();
  if (f === 'bots') list = list.filter((m) => m.author.bot);
  else if (f === 'humans') list = list.filter((m) => !m.author.bot);
  else if (f === 'embeds') list = list.filter((m) => (m.embeds?.length || 0) > 0);
  else if (f === 'links') list = list.filter((m) => /https?:\/\/|discord\.gg\//i.test(m.content || ''));
  else if (f === 'attachments' || f === 'files') {
    list = list.filter((m) => (m.attachments?.size || 0) > 0);
  }
  if (contains) {
    const needle = String(contains).toLowerCase();
    list = list.filter((m) => (m.content || '').toLowerCase().includes(needle));
  }
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

function setWarnLadder(guildId, patch) {
  const cfg = ensureMod(loadGuild(guildId));
  Object.assign(cfg.moderation.warnLadder, patch);
  saveGuild(guildId, cfg);
  return cfg.moderation.warnLadder;
}

module.exports = {
  ensureMod,
  addCase,
  getCase,
  getCasesForUser,
  countWarns,
  clearWarns,
  updateCase,
  deleteCase,
  sendModLog,
  warnMember,
  muteMember,
  unmuteMember,
  applyWarnLadder,
  softbanMember,
  banMember,
  tempbanMember,
  resumeTempBans,
  processExpiredTempBans,
  purgeMessages,
  setSlowmode,
  setModLogChannel,
  setWarnLadder,
  nextCaseId,
  resolveChannel,
  successEmbed,
  errorEmbed,
  baseEmbed,
};
