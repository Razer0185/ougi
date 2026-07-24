'use strict';

const { EmbedBuilder } = require('discord.js');
const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');
const { getTheme } = require('../utils/theme');

function ensureCc(cfg) {
  if (!cfg.customCommands || typeof cfg.customCommands !== 'object') {
    cfg.customCommands = {};
  }
  return cfg;
}

function addCustomCommand(guildId, name, response) {
  const key = String(name).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!key) throw new Error('Invalid command name.');
  const cfg = ensureCc(loadGuild(guildId));
  cfg.customCommands[key] = String(response).slice(0, 4000);
  saveGuild(guildId, cfg);
  return key;
}

function removeCustomCommand(guildId, name) {
  const key = String(name).toLowerCase();
  const cfg = ensureCc(loadGuild(guildId));
  const had = !!cfg.customCommands[key];
  delete cfg.customCommands[key];
  saveGuild(guildId, cfg);
  return had;
}

function listCustomCommands(guildId) {
  return Object.keys(ensureCc(loadGuild(guildId)).customCommands);
}

function applyVars(template, message) {
  const member = message.member;
  return String(template)
    .replaceAll('{user}', `${message.author}`)
    .replaceAll('{user.name}', message.author.username)
    .replaceAll('{user.tag}', message.author.tag || message.author.username)
    .replaceAll('{user.id}', message.author.id)
    .replaceAll('{server}', message.guild.name)
    .replaceAll('{server.id}', message.guild.id)
    .replaceAll('{channel}', `${message.channel}`)
    .replaceAll('{channel.id}', message.channel.id)
    .replaceAll('{membercount}', String(message.guild.memberCount))
    .replaceAll('{prefix}', require('../utils/store').getGuildPrefix(message.guild.id))
    .replaceAll('{avatar}', message.author.displayAvatarURL({ size: 256 }))
    .replaceAll('{nickname}', member?.displayName || message.author.username);
}

async function tryCustomCommand(message, commandName) {
  if (!message.guild) return false;
  const cfg = ensureCc(loadGuild(message.guild.id));
  const response = cfg.customCommands[commandName];
  if (!response) return false;

  const text = applyVars(response, message);

  // embed: Title | Description | [image url]
  if (text.toLowerCase().startsWith('embed:')) {
    const raw = text.slice(6).trim();
    const [title, description, image] = raw.split('|').map((s) => (s || '').trim());
    const theme = getTheme(cfg.theme);
    const embed = new EmbedBuilder()
      .setColor(theme.color)
      .setTitle((title || 'Info').slice(0, 256))
      .setTimestamp();
    if (description) embed.setDescription(description.slice(0, 4000));
    if (image && /^https?:\/\//i.test(image)) embed.setImage(image);
    await message.channel.send({ embeds: [embed] });
    return true;
  }

  await message.channel.send({ content: text.slice(0, 2000) });
  return true;
}

function buildEmbedFromParts(guildId, { title, description, image }) {
  return baseEmbed(guildId, {
    title: title || 'Embed',
    description: description || undefined,
    image: image || undefined,
    footer: 'Embed',
  });
}

module.exports = {
  addCustomCommand,
  removeCustomCommand,
  listCustomCommands,
  tryCustomCommand,
  applyVars,
  buildEmbedFromParts,
  successEmbed,
  errorEmbed,
  baseEmbed,
};
