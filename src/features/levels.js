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
    };
  }
  if (!cfg.levels.users) cfg.levels.users = {};
  if (!cfg.levels.rewards) cfg.levels.rewards = {};
  if (!Array.isArray(cfg.levels.blacklistChannels)) cfg.levels.blacklistChannels = [];
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

async function handleMessageXp(message) {
  if (!message.guild || message.author.bot || !message.content) return null;
  const cfg = ensureLevels(loadGuild(message.guild.id));
  if (!cfg.levels.enabled) return null;
  if (cfg.levels.blacklistChannels.includes(message.channel.id)) return null;
  const { getGuildPrefix } = require('../utils/store');
  const prefix = getGuildPrefix(message.guild.id);
  if (message.content.startsWith(prefix)) return null;

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

module.exports = {
  ensureLevels,
  getUserLevel,
  handleMessageXp,
  leaderboard,
  rankEmbed,
  xpForLevel,
  levelFromTotalXp,
  successEmbed,
  errorEmbed,
  baseEmbed,
};
