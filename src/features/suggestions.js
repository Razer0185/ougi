'use strict';

/**
 * Suggestion board — post ideas, react, staff approve/deny.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');

function ensureSuggestions(cfg) {
  if (!cfg.suggestions || typeof cfg.suggestions !== 'object') {
    cfg.suggestions = {
      enabled: false,
      channelId: null,
      counter: 0,
      open: {},
    };
  }
  if (!cfg.suggestions.open) cfg.suggestions.open = {};
  return cfg.suggestions;
}

function suggestionComponents(id) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`suggest:up:${id}`)
        .setLabel('Upvote')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`suggest:down:${id}`)
        .setLabel('Downvote')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`suggest:approve:${id}`)
        .setLabel('Approve')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`suggest:deny:${id}`)
        .setLabel('Deny')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function postSuggestion(guild, author, text) {
  const cfg = loadGuild(guild.id);
  const s = ensureSuggestions(cfg);
  if (!s.enabled || !s.channelId) throw new Error('Suggestions are not set up. Use `suggest setup #channel`.');
  const channel = guild.channels.cache.get(s.channelId);
  if (!channel) throw new Error('Suggestions channel missing.');

  s.counter = (s.counter || 0) + 1;
  const id = String(s.counter);
  const embed = baseEmbed(guild.id, {
    title: `Suggestion #${id}`,
    description: text.slice(0, 2000),
    footer: `From ${author.tag}`,
    thumbnail: author.displayAvatarURL({ size: 128 }),
  });
  embed.addFields(
    { name: 'Status', value: 'Open', inline: true },
    { name: 'Votes', value: '👍 0 · 👎 0', inline: true }
  );

  const msg = await channel.send({ embeds: [embed], components: suggestionComponents(id) });
  s.open[id] = {
    messageId: msg.id,
    channelId: channel.id,
    authorId: author.id,
    up: [],
    down: [],
    status: 'open',
    text: text.slice(0, 2000),
  };
  saveGuild(guild.id, cfg);
  return { id, msg };
}

async function handleSuggestButton(interaction) {
  const parts = interaction.customId.split(':');
  // suggest:up:id | suggest:down:id | suggest:approve:id | suggest:deny:id
  if (parts[0] !== 'suggest') return false;
  const action = parts[1];
  const id = parts[2];
  const cfg = loadGuild(interaction.guild.id);
  const s = ensureSuggestions(cfg);
  const row = s.open[id];
  if (!row) {
    await interaction.reply({ embeds: [errorEmbed(interaction.guild.id, 'Suggest', 'Unknown suggestion.')], ephemeral: true });
    return true;
  }

  const uid = interaction.user.id;

  if (action === 'up' || action === 'down') {
    row.up = (row.up || []).filter((x) => x !== uid);
    row.down = (row.down || []).filter((x) => x !== uid);
    if (action === 'up') row.up.push(uid);
    else row.down.push(uid);
    saveGuild(interaction.guild.id, cfg);
    await refreshSuggestionMessage(interaction.guild, id, row);
    await interaction.deferUpdate().catch(() => {});
    return true;
  }

  const { memberHasMod } = require('../utils/helpers');
  if (!memberHasMod(interaction.member)) {
    await interaction.reply({
      embeds: [errorEmbed(interaction.guild.id, 'Denied', 'Mods only for approve/deny.')],
      ephemeral: true,
    });
    return true;
  }

  row.status = action === 'approve' ? 'approved' : 'denied';
  saveGuild(interaction.guild.id, cfg);
  await refreshSuggestionMessage(interaction.guild, id, row, true);
  await interaction.reply({
    embeds: [
      successEmbed(
        interaction.guild.id,
        'Suggestion',
        `#${id} marked **${row.status}**.`
      ),
    ],
    ephemeral: true,
  });
  return true;
}

async function refreshSuggestionMessage(guild, id, row, clearButtons = false) {
  const ch = guild.channels.cache.get(row.channelId);
  if (!ch) return;
  const msg = await ch.messages.fetch(row.messageId).catch(() => null);
  if (!msg) return;
  const statusLabel =
    row.status === 'approved' ? 'Approved' : row.status === 'denied' ? 'Denied' : 'Open';
  const embed = baseEmbed(guild.id, {
    title: `Suggestion #${id}`,
    description: row.text,
    footer: statusLabel,
  });
  embed.addFields(
    { name: 'Status', value: statusLabel, inline: true },
    {
      name: 'Votes',
      value: `👍 ${row.up?.length || 0} · 👎 ${row.down?.length || 0}`,
      inline: true,
    }
  );
  await msg
    .edit({
      embeds: [embed],
      components: clearButtons || row.status !== 'open' ? [] : suggestionComponents(id),
    })
    .catch(() => {});
}

module.exports = {
  ensureSuggestions,
  postSuggestion,
  handleSuggestButton,
  successEmbed,
  errorEmbed,
  baseEmbed,
};
