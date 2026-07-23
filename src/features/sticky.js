const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed } = require('../utils/embeds');

function ensureSticky(cfg) {
  if (!cfg.sticky || typeof cfg.sticky !== 'object') cfg.sticky = {};
  return cfg;
}

async function setSticky(channel, content) {
  const cfg = ensureSticky(loadGuild(channel.guild.id));
  if (cfg.sticky[channel.id]?.messageId) {
    const old = await channel.messages.fetch(cfg.sticky[channel.id].messageId).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }
  const msg = await channel.send({
    embeds: [
      baseEmbed(channel.guild.id, {
        title: '📌 Sticky',
        description: content,
        footer: 'Sticky',
      }),
    ],
  });
  cfg.sticky[channel.id] = { content, messageId: msg.id };
  saveGuild(channel.guild.id, cfg);
  return msg;
}

async function clearSticky(channel) {
  const cfg = ensureSticky(loadGuild(channel.guild.id));
  const entry = cfg.sticky[channel.id];
  if (entry?.messageId) {
    const old = await channel.messages.fetch(entry.messageId).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }
  delete cfg.sticky[channel.id];
  saveGuild(channel.guild.id, cfg);
}

async function refreshSticky(message) {
  if (!message.guild || message.author?.bot) return;
  const cfg = ensureSticky(loadGuild(message.guild.id));
  const entry = cfg.sticky[message.channel.id];
  if (!entry?.content) return;
  if (message.id === entry.messageId) return;

  if (entry.messageId) {
    const old = await message.channel.messages.fetch(entry.messageId).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }
  const msg = await message.channel
    .send({
      embeds: [
        baseEmbed(message.guild.id, {
          title: '📌 Sticky',
          description: entry.content,
          footer: 'Sticky',
        }),
      ],
    })
    .catch(() => null);
  if (msg) {
    entry.messageId = msg.id;
    cfg.sticky[message.channel.id] = entry;
    saveGuild(message.guild.id, cfg);
  }
}

module.exports = { ensureSticky, setSticky, clearSticky, refreshSticky };
