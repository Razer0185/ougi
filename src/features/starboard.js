const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed } = require('../utils/embeds');

function ensureStarboard(cfg) {
  if (!cfg.starboard || typeof cfg.starboard !== 'object') {
    cfg.starboard = { enabled: false, channelId: null, emoji: '⭐', threshold: 3, posted: {} };
  }
  if (!cfg.starboard.posted) cfg.starboard.posted = {};
  return cfg;
}

function configureStarboard(guildId, { channelId, threshold, emoji, enabled }) {
  const cfg = ensureStarboard(loadGuild(guildId));
  if (channelId != null) cfg.starboard.channelId = channelId;
  if (threshold != null) cfg.starboard.threshold = Math.max(1, Number(threshold) || 3);
  if (emoji) cfg.starboard.emoji = emoji;
  if (enabled != null) cfg.starboard.enabled = !!enabled;
  saveGuild(guildId, cfg);
  return cfg.starboard;
}

async function handleStarReaction(reaction, user, client) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  if (reaction.message.partial) await reaction.message.fetch().catch(() => null);
  const message = reaction.message;
  if (!message.guild) return;

  const cfg = ensureStarboard(loadGuild(message.guild.id));
  if (!cfg.starboard.enabled || !cfg.starboard.channelId) return;

  const emoji = reaction.emoji.id || reaction.emoji.name;
  const want = cfg.starboard.emoji;
  const match =
    emoji === want ||
    reaction.emoji.name === want ||
    (want.length === 1 && reaction.emoji.name === want);
  if (!match) return;

  const count = reaction.count || 0;
  if (count < cfg.starboard.threshold) return;
  if (cfg.starboard.posted[message.id]) return;

  const board = message.guild.channels.cache.get(cfg.starboard.channelId);
  if (!board?.isTextBased?.()) return;

  const embed = baseEmbed(message.guild.id, {
    title: `${cfg.starboard.emoji} Starboard`,
    description: message.content?.slice(0, 1500) || '_attachment / embed_',
    footer: `${count} ${cfg.starboard.emoji} · #${message.channel.name}`,
  });
  if (message.attachments.first()) {
    embed.setImage(message.attachments.first().url);
  }
  const posted = await board.send({
    content: `[Jump](${message.url})`,
    embeds: [embed],
  });
  cfg.starboard.posted[message.id] = posted.id;
  saveGuild(message.guild.id, cfg);
}

module.exports = { ensureStarboard, configureStarboard, handleStarReaction };
