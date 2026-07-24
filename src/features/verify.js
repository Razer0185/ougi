'use strict';

/**
 * Simple verification gate: unverified role + button to get member role.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');
const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');
const { accentStyle } = require('../ui/components');

function ensureVerify(cfg) {
  if (!cfg.verify || typeof cfg.verify !== 'object') {
    cfg.verify = {
      enabled: false,
      channelId: null,
      messageId: null,
      roleId: null,
      unverifiedRoleId: null,
    };
  }
  return cfg;
}

async function ensureVerifyRoles(guild) {
  const cfg = ensureVerify(loadGuild(guild.id));
  let memberRole = cfg.verify.roleId && guild.roles.cache.get(cfg.verify.roleId);
  let unverified = cfg.verify.unverifiedRoleId && guild.roles.cache.get(cfg.verify.unverifiedRoleId);

  if (!memberRole) {
    memberRole = await guild.roles.create({
      name: '✅ ★ Verified',
      reason: 'Ougi verification',
      mentionable: false,
    });
    cfg.verify.roleId = memberRole.id;
  }
  if (!unverified) {
    unverified = await guild.roles.create({
      name: '👤 ★ Unverified',
      color: 0x95a5a6,
      reason: 'Ougi verification',
      mentionable: false,
      permissions: [],
    });
    cfg.verify.unverifiedRoleId = unverified.id;
  }
  saveGuild(guild.id, cfg);
  return { memberRole, unverified, cfg };
}

async function setupVerify(guild, channel) {
  const me = guild.members.me;
  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('Need Manage Roles');
  }
  const { memberRole, unverified, cfg } = await ensureVerifyRoles(guild);
  cfg.verify.enabled = true;
  cfg.verify.channelId = channel.id;

  // Soft-lock: deny Send for @everyone in verify channel except button use (View + Read)
  await channel.permissionOverwrites
    .edit(guild.roles.everyone, {
      ViewChannel: true,
      SendMessages: false,
      AddReactions: false,
    })
    .catch(() => {});

  const embed = baseEmbed(guild.id, {
    title: 'Verification',
    description:
      `Welcome to **${guild.name}**!\n\n` +
      `Click **Verify** below to unlock the server.\n` +
      `You'll receive the ${memberRole} role.`,
    footer: 'Ougi Verify',
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify:button')
      .setLabel('Verify')
      .setStyle(ButtonStyle.Success)
  );

  let msg = null;
  if (cfg.verify.messageId) {
    msg = await channel.messages.fetch(cfg.verify.messageId).catch(() => null);
  }
  if (msg) {
    await msg.edit({ embeds: [embed], components: [row] });
  } else {
    msg = await channel.send({ embeds: [embed], components: [row] });
  }
  cfg.verify.messageId = msg.id;
  saveGuild(guild.id, cfg);
  return { cfg, memberRole, unverified };
}

async function onMemberJoinVerify(member) {
  const cfg = ensureVerify(loadGuild(member.guild.id));
  if (!cfg.verify.enabled || !cfg.verify.unverifiedRoleId) return;
  const role = member.guild.roles.cache.get(cfg.verify.unverifiedRoleId);
  if (!role) return;
  await member.roles.add(role, 'Ougi verify gate').catch(() => {});
}

async function handleVerifyButton(interaction) {
  const cfg = ensureVerify(loadGuild(interaction.guild.id));
  if (!cfg.verify.enabled || !cfg.verify.roleId) {
    return interaction.reply({
      embeds: [errorEmbed(interaction.guild.id, 'Verify', 'Verification is not set up.')],
      ephemeral: true,
    });
  }
  const memberRole = interaction.guild.roles.cache.get(cfg.verify.roleId);
  const unverified = cfg.verify.unverifiedRoleId
    ? interaction.guild.roles.cache.get(cfg.verify.unverifiedRoleId)
    : null;
  if (!memberRole) {
    return interaction.reply({
      embeds: [errorEmbed(interaction.guild.id, 'Verify', 'Verified role missing. Run verify setup again.')],
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });
  if (unverified && interaction.member.roles.cache.has(unverified.id)) {
    await interaction.member.roles.remove(unverified, 'Verified').catch(() => {});
  }
  if (!interaction.member.roles.cache.has(memberRole.id)) {
    await interaction.member.roles.add(memberRole, 'Verified').catch((err) => {
      throw err;
    });
  }
  return interaction.editReply({
    embeds: [successEmbed(interaction.guild.id, 'Verified', `You're in — ${memberRole} granted.`)],
  });
}

module.exports = {
  ensureVerify,
  setupVerify,
  onMemberJoinVerify,
  handleVerifyButton,
};
