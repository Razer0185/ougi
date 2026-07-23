const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');

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
  cfg.customCommands[key] = String(response).slice(0, 2000);
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

async function tryCustomCommand(message, commandName, prefix) {
  if (!message.guild) return false;
  const cfg = ensureCc(loadGuild(message.guild.id));
  const response = cfg.customCommands[commandName];
  if (!response) return false;
  const text = response
    .replaceAll('{user}', `${message.author}`)
    .replaceAll('{server}', message.guild.name)
    .replaceAll('{channel}', `${message.channel}`);
  await message.channel.send(text);
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
  buildEmbedFromParts,
  successEmbed,
  errorEmbed,
  baseEmbed,
};
