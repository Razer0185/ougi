const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
} = require('discord.js');
const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');

function ensureRoles(cfg) {
  if (!cfg.roles || typeof cfg.roles !== 'object') {
    cfg.roles = { autoroleIds: [], reactionRoles: {}, selfRoles: [] };
  }
  if (!Array.isArray(cfg.roles.autoroleIds)) cfg.roles.autoroleIds = [];
  if (!cfg.roles.reactionRoles || typeof cfg.roles.reactionRoles !== 'object') {
    cfg.roles.reactionRoles = {};
  }
  if (!Array.isArray(cfg.roles.selfRoles)) cfg.roles.selfRoles = [];
  return cfg;
}

async function applyAutoroles(member) {
  const cfg = ensureRoles(loadGuild(member.guild.id));
  for (const roleId of cfg.roles.autoroleIds) {
    const role = member.guild.roles.cache.get(roleId);
    if (role) await member.roles.add(role).catch(() => {});
  }
}

function setAutoroles(guildId, roleIds) {
  const cfg = ensureRoles(loadGuild(guildId));
  cfg.roles.autoroleIds = [...new Set(roleIds)].slice(0, 10);
  saveGuild(guildId, cfg);
  return cfg.roles.autoroleIds;
}

async function addRoleToMember(member, role) {
  await member.roles.add(role);
}

async function removeRoleFromMember(member, role) {
  await member.roles.remove(role);
}

/** Store reaction role: messageId -> { emoji: roleId } */
function saveReactionRoleMap(guildId, messageId, channelId, map) {
  const cfg = ensureRoles(loadGuild(guildId));
  cfg.roles.reactionRoles[messageId] = { channelId, map };
  saveGuild(guildId, cfg);
}

function getReactionRole(guildId, messageId, emojiKey) {
  const cfg = ensureRoles(loadGuild(guildId));
  const entry = cfg.roles.reactionRoles[messageId];
  if (!entry) return null;
  return entry.map[emojiKey] || null;
}

function emojiKey(emoji) {
  if (emoji.id) return emoji.id;
  return emoji.name;
}

async function handleRoleReactionAdd(reaction, user, client) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  if (reaction.message.partial) await reaction.message.fetch().catch(() => null);
  const msg = reaction.message;
  if (!msg.guild) return;
  const roleId = getReactionRole(msg.guild.id, msg.id, emojiKey(reaction.emoji));
  if (!roleId) return;
  const member = await msg.guild.members.fetch(user.id).catch(() => null);
  const role = msg.guild.roles.cache.get(roleId);
  if (member && role) await member.roles.add(role).catch(() => {});
}

async function handleRoleReactionRemove(reaction, user) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  if (reaction.message.partial) await reaction.message.fetch().catch(() => null);
  const msg = reaction.message;
  if (!msg.guild) return;
  const roleId = getReactionRole(msg.guild.id, msg.id, emojiKey(reaction.emoji));
  if (!roleId) return;
  const member = await msg.guild.members.fetch(user.id).catch(() => null);
  const role = msg.guild.roles.cache.get(roleId);
  if (member && role) await member.roles.remove(role).catch(() => {});
}

async function postReactionRolePanel(channel, guildId, title, pairs) {
  // pairs: [{ emoji, roleId }]
  const lines = pairs.map((p) => `${p.emoji} → <@&${p.roleId}>`);
  const embed = baseEmbed(guildId, {
    title: title || 'Reaction Roles',
    description: `React to get a role:\n\n${lines.join('\n')}`,
    footer: 'Roles',
  });
  const msg = await channel.send({ embeds: [embed] });
  const map = {};
  for (const p of pairs) {
    await msg.react(p.emoji).catch(() => {});
    const key = p.emoji.includes(':') ? p.emoji.match(/:(\d+)>/)?.[1] || p.emoji : p.emoji;
    map[key] = p.roleId;
  }
  saveReactionRoleMap(guildId, msg.id, channel.id, map);
  return msg;
}

function setSelfRoles(guildId, roleIds) {
  const cfg = ensureRoles(loadGuild(guildId));
  cfg.roles.selfRoles = [...new Set(roleIds)].slice(0, 25);
  saveGuild(guildId, cfg);
  return cfg.roles.selfRoles;
}

async function postSelfRolePanel(channel, guildId) {
  const cfg = ensureRoles(loadGuild(guildId));
  const roles = cfg.roles.selfRoles
    .map((id) => channel.guild.roles.cache.get(id))
    .filter(Boolean)
    .slice(0, 25);
  if (!roles.length) {
    throw new Error('No self-roles configured. Use `selfrole add @Role` first.');
  }
  const embed = baseEmbed(guildId, {
    title: 'Self Roles',
    description: 'Pick roles from the menu below. Select again to toggle off.',
    footer: 'Roles',
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId('selfrole:toggle')
    .setPlaceholder('Choose a role')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      roles.map((r) => ({
        label: r.name.slice(0, 100),
        value: r.id,
        description: `Toggle ${r.name}`.slice(0, 100),
      }))
    );
  const row = new ActionRowBuilder().addComponents(menu);
  return channel.send({ embeds: [embed], components: [row] });
}

async function handleSelfRoleSelect(interaction) {
  const roleId = interaction.values[0];
  const role = interaction.guild.roles.cache.get(roleId);
  if (!role) {
    return interaction.reply({
      embeds: [errorEmbed(interaction.guild.id, 'Role', 'Role not found.')],
      ephemeral: true,
    });
  }
  const member = interaction.member;
  if (member.roles.cache.has(roleId)) {
    await member.roles.remove(role);
    return interaction.reply({
      embeds: [successEmbed(interaction.guild.id, 'Self Role', `Removed ${role}.`)],
      ephemeral: true,
    });
  }
  await member.roles.add(role);
  return interaction.reply({
    embeds: [successEmbed(interaction.guild.id, 'Self Role', `Added ${role}.`)],
    ephemeral: true,
  });
}

function autorolePickRow() {
  return new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('roles:autorole')
      .setPlaceholder('Select autorole(s)')
      .setMinValues(0)
      .setMaxValues(5)
  );
}

module.exports = {
  ensureRoles,
  applyAutoroles,
  setAutoroles,
  addRoleToMember,
  removeRoleFromMember,
  postReactionRolePanel,
  handleRoleReactionAdd,
  handleRoleReactionRemove,
  setSelfRoles,
  postSelfRolePanel,
  handleSelfRoleSelect,
  autorolePickRow,
  saveReactionRoleMap,
  baseEmbed,
  successEmbed,
  errorEmbed,
};
