const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');

function ensureAfk(cfg) {
  if (!cfg.afk || typeof cfg.afk !== 'object') cfg.afk = {};
  return cfg;
}

function setAfk(guildId, userId, reason) {
  const cfg = ensureAfk(loadGuild(guildId));
  cfg.afk[userId] = { reason: String(reason || 'AFK').slice(0, 200), since: Date.now() };
  saveGuild(guildId, cfg);
}

function clearAfk(guildId, userId) {
  const cfg = ensureAfk(loadGuild(guildId));
  const had = !!cfg.afk[userId];
  delete cfg.afk[userId];
  saveGuild(guildId, cfg);
  return had;
}

function getAfk(guildId, userId) {
  return ensureAfk(loadGuild(guildId)).afk[userId] || null;
}

async function handleAfkMessage(message) {
  if (!message.guild || message.author.bot) return;

  if (getAfk(message.guild.id, message.author.id)) {
    clearAfk(message.guild.id, message.author.id);
    await message.reply({
      embeds: [successEmbed(message.guild.id, 'Welcome back', 'Your AFK status was cleared.')],
    }).catch(() => {});
  }

  for (const [, user] of message.mentions.users) {
    const afk = getAfk(message.guild.id, user.id);
    if (afk) {
      await message.reply({
        embeds: [
          baseEmbed(message.guild.id, {
            title: 'AFK',
            description: `${user} is AFK: **${afk.reason}**\nSince <t:${Math.floor(afk.since / 1000)}:R>`,
          }),
        ],
      }).catch(() => {});
    }
  }
}

module.exports = { setAfk, clearAfk, getAfk, handleAfkMessage, successEmbed, errorEmbed };
