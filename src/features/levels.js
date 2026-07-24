const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');

function ensureLevels(cfg) {
  if (!cfg.levels || typeof cfg.levels !== 'object') {
    cfg.levels = {
      enabled: true,
      xpMin: 15,
      xpMax: 25,
      cooldownMs: 60000,
      announceChannelId: null,
      users: {},
      rewards: {},
      blacklistChannels: [],
      voiceXpEnabled: true,
      voiceXpPerMinute: 10,
    };
  }
  if (!cfg.levels.users) cfg.levels.users = {};
  if (!cfg.levels.rewards) cfg.levels.rewards = {};
  if (!Array.isArray(cfg.levels.blacklistChannels)) cfg.levels.blacklistChannels = [];
  if (cfg.levels.voiceXpEnabled == null) cfg.levels.voiceXpEnabled = true;
  if (!cfg.levels.voiceXpPerMinute) cfg.levels.voiceXpPerMinute = 10;
  return cfg;
}

function xpForLevel(level) {
  return 5 * level * level + 50 * level + 100;
}

function levelFromTotalXp(total) {
  let level = 0;
  let remaining = total;
  while (remaining >= xpForLevel(level + 1)) {
    remaining -= xpForLevel(level + 1);
    level += 1;
    if (level > 1000) break;
  }
  return { level, xpIntoLevel: remaining, needed: xpForLevel(level + 1) };
}

function getUserLevel(guildId, userId) {
  const cfg = ensureLevels(loadGuild(guildId));
  const u = cfg.levels.users[userId] || { xp: 0, lastXp: 0 };
  const info = levelFromTotalXp(u.xp || 0);
  return { ...u, ...info, totalXp: u.xp || 0 };
}

function setUserXp(guildId, userId, totalXp) {
  const cfg = ensureLevels(loadGuild(guildId));
  const xp = Math.max(0, Math.floor(Number(totalXp) || 0));
  cfg.levels.users[userId] = {
    ...(cfg.levels.users[userId] || {}),
    xp,
    lastXp: cfg.levels.users[userId]?.lastXp || 0,
  };
  saveGuild(guildId, cfg);
  return getUserLevel(guildId, userId);
}

async function handleMessageXp(message) {
  if (!message.guild || message.author.bot || !message.content) return null;
  const cfg = ensureLevels(loadGuild(message.guild.id));
  if (!cfg.levels.enabled) return null;
  if (cfg.levels.blacklistChannels.includes(message.channel.id)) return null;
  const { getCommandPrefixes } = require('../utils/store');
  const prefixes = getCommandPrefixes(message.guild.id);
  if (prefixes.some((p) => message.content.startsWith(p))) return null;

  const uid = message.author.id;
  const user = cfg.levels.users[uid] || { xp: 0, lastXp: 0 };
  const now = Date.now();
  if (now - (user.lastXp || 0) < (cfg.levels.cooldownMs || 60000)) return null;

  const min = cfg.levels.xpMin || 15;
  const max = cfg.levels.xpMax || 25;
  const gain = min + Math.floor(Math.random() * (max - min + 1));
  const before = levelFromTotalXp(user.xp || 0).level;
  user.xp = (user.xp || 0) + gain;
  user.lastXp = now;
  cfg.levels.users[uid] = user;
  saveGuild(message.guild.id, cfg);

  const after = levelFromTotalXp(user.xp).level;
  if (after > before) {
    await onLevelUp(message, after, cfg);
    return { leveled: true, level: after, gain };
  }
  return { leveled: false, gain };
}

async function onLevelUp(message, level, cfg) {
  const rewardId = cfg.levels.rewards[String(level)];
  if (rewardId) {
    const role = message.guild.roles.cache.get(rewardId);
    if (role) await message.member.roles.add(role).catch(() => {});
  }
  const text = `🎉 ${message.author} reached **level ${level}**!`;
  const chId = cfg.levels.announceChannelId;
  const channel = (chId && message.guild.channels.cache.get(chId)) || message.channel;
  await channel
    .send({
      embeds: [successEmbed(message.guild.id, 'Level Up', text)],
    })
    .catch(() => {});
}

function leaderboard(guildId, limit = 10) {
  const cfg = ensureLevels(loadGuild(guildId));
  return Object.entries(cfg.levels.users)
    .map(([id, u]) => ({ id, xp: u.xp || 0, ...levelFromTotalXp(u.xp || 0) }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limit);
}

function rankEmbed(guildId, user, stats, position) {
  return baseEmbed(guildId, {
    title: `Rank · ${user.username}`,
    thumbnail: user.displayAvatarURL({ size: 256 }),
    description: [
      `→ __**Level:**__ ${stats.level}`,
      `→ __**XP:**__ ${stats.xpIntoLevel} / ${stats.needed}`,
      `→ __**Total XP:**__ ${stats.totalXp}`,
      position != null ? `→ __**Rank:**__ #${position}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    footer: 'Levels',
  });
}

/** Voice presence tracking: guildId:userId -> { joinedAt, channelId } */
const voiceSessions = new Map();

function voiceKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function shouldTrackVoice(state) {
  if (!state.guild || !state.member || state.member.user.bot) return false;
  if (!state.channelId) return false;
  if (state.deaf || state.selfDeaf) return false;
  const others = state.channel?.members?.filter((m) => !m.user.bot && m.id !== state.id);
  if (others && others.size === 0) return false;
  return true;
}

async function flushVoiceXp(guild, userId) {
  const k = voiceKey(guild.id, userId);
  const session = voiceSessions.get(k);
  if (!session) return null;
  voiceSessions.delete(k);

  const cfg = ensureLevels(loadGuild(guild.id));
  if (!cfg.levels.enabled || !cfg.levels.voiceXpEnabled) return null;

  const minutes = Math.floor((Date.now() - session.joinedAt) / 60_000);
  if (minutes < 1) return null;
  const perMin = cfg.levels.voiceXpPerMinute || 10;
  const gain = minutes * perMin;
  const user = cfg.levels.users[userId] || { xp: 0, lastXp: 0 };
  const before = levelFromTotalXp(user.xp || 0).level;
  user.xp = (user.xp || 0) + gain;
  cfg.levels.users[userId] = user;
  saveGuild(guild.id, cfg);
  const after = levelFromTotalXp(user.xp).level;

  if (after > before) {
    const member = await guild.members.fetch(userId).catch(() => null);
    const rewardId = cfg.levels.rewards[String(after)];
    if (rewardId && member) {
      const role = guild.roles.cache.get(rewardId);
      if (role) await member.roles.add(role).catch(() => {});
    }
    const chId = cfg.levels.announceChannelId;
    const channel = chId && guild.channels.cache.get(chId);
    if (channel) {
      await channel
        .send({
          embeds: [
            successEmbed(guild.id, 'Level Up', `🎉 <@${userId}> reached **level ${after}** (voice XP)!`),
          ],
        })
        .catch(() => {});
    }
  }
  return { gain, minutes, level: after };
}

async function handleVoiceXp(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;
  const userId = newState.id || oldState.id;
  const k = voiceKey(guild.id, userId);

  if (voiceSessions.has(k) && !shouldTrackVoice(newState)) {
    await flushVoiceXp(guild, userId);
  }
  if (shouldTrackVoice(newState) && !voiceSessions.has(k)) {
    voiceSessions.set(k, { joinedAt: Date.now(), channelId: newState.channelId });
  } else if (shouldTrackVoice(newState) && voiceSessions.has(k)) {
    voiceSessions.get(k).channelId = newState.channelId;
  }
}

module.exports = {
  ensureLevels,
  getUserLevel,
  setUserXp,
  handleMessageXp,
  handleVoiceXp,
  leaderboard,
  rankEmbed,
  xpForLevel,
  levelFromTotalXp,
  successEmbed,
  errorEmbed,
  baseEmbed,
};
