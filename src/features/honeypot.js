'use strict';

/**
 * Honeypot / decoy channel — public channel with a clear warning.
 * Compromised accounts that spam promotions here get kick / softban / ban / mute.
 */

const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');
const { banMember, softbanMember, muteMember, addCase, sendModLog } = require('./moderation');
const { memberHasAdmin } = require('../utils/helpers');

const DEFAULT_NAME = 'do-not-type';
const ACTIONS = ['kick', 'softban', 'ban', 'mute'];

function ensureHoneypot(cfg) {
  if (!cfg.honeypot || typeof cfg.honeypot !== 'object') {
    cfg.honeypot = {
      enabled: false,
      channelId: null,
      action: 'kick',
      warningMessageId: null,
      caught: 0,
      lastCaughtId: null,
      lastCaughtTag: null,
      lastCaughtAt: null,
    };
  }
  const h = cfg.honeypot;
  if (typeof h.enabled !== 'boolean') h.enabled = false;
  if (!ACTIONS.includes(h.action)) h.action = 'kick';
  if (typeof h.caught !== 'number' || h.caught < 0) h.caught = 0;
  if (!Array.isArray(h.exemptRoleIds)) h.exemptRoleIds = [];
  return h;
}

function isStaffSafe(member) {
  if (!member) return false;
  if (memberHasAdmin(member)) return true;
  if (member.permissions?.has(PermissionFlagsBits.ManageMessages)) return true;
  if (member.permissions?.has(PermissionFlagsBits.KickMembers)) return true;
  if (member.permissions?.has(PermissionFlagsBits.BanMembers)) return true;
  if (member.permissions?.has(PermissionFlagsBits.ModerateMembers)) return true;
  return false;
}

function isExempt(member, honeypot) {
  if (!member || isStaffSafe(member)) return true;
  const ids = honeypot.exemptRoleIds || [];
  if (ids.length && member.roles?.cache?.some((r) => ids.includes(r.id))) return true;
  return false;
}

function warningEmbed(guildId, action) {
  const actionLabel =
    action === 'ban'
      ? 'permanently banned'
      : action === 'softban'
        ? 'removed (softban)'
        : action === 'mute'
          ? 'muted'
          : 'kicked';
  return baseEmbed(guildId, {
    title: '⚠ Do not type here',
    description:
      'This channel is a **security honeypot**.\n\n' +
      '→ Legitimate members: **do not post** anything here.\n' +
      '→ Compromised / spam accounts that type here are **' +
      actionLabel +
      '** automatically.\n\n' +
      '_If you can read this, you are safe — just leave the channel._',
  });
}

async function postWarning(channel, guildId, action) {
  const msg = await channel.send({ embeds: [warningEmbed(guildId, action)] });
  await msg.pin().catch(() => {});
  return msg;
}

async function createHoneypotChannel(guild, options = {}) {
  const cfg = loadGuild(guild.id);
  const h = ensureHoneypot(cfg);
  const name = String(options.name || DEFAULT_NAME)
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .slice(0, 90) || DEFAULT_NAME;

  if (h.channelId) {
    const existing = guild.channels.cache.get(h.channelId);
    if (existing) {
      h.enabled = true;
      saveGuild(guild.id, cfg);
      return { channel: existing, created: false, cfg };
    }
  }

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    topic: 'SECURITY HONEYPOT — do not type here. Spammers are removed automatically.',
    reason: 'Ougi honeypot channel',
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.SendMessages,
        ],
      },
    ],
  });

  const warn = await postWarning(channel, guild.id, h.action);
  h.channelId = channel.id;
  h.warningMessageId = warn.id;
  h.enabled = true;
  saveGuild(guild.id, cfg);
  return { channel, created: true, cfg };
}

async function kickMember(guild, { target, moderator, reason }) {
  const userId = target.id || target.user?.id;
  const tag = target.user?.tag || target.tag || String(userId);
  if (target.kick) {
    await target.kick(`${moderator.tag || moderator.username}: ${reason}`);
  } else {
    const m = await guild.members.fetch(userId);
    await m.kick(`${moderator.tag || moderator.username}: ${reason}`);
  }
  const row = addCase(guild.id, {
    type: 'kick',
    userId,
    modId: moderator.id,
    reason,
  });
  await sendModLog(guild, {
    action: 'Kick',
    userId,
    userTag: tag,
    modId: moderator.id,
    reason,
    caseId: row.id,
    extra: 'Honeypot',
  });
  return row;
}

/**
 * @returns {Promise<null|{ caught: true, action: string, tag: string }>}
 */
async function handleHoneypotMessage(message, client) {
  if (!message.guild || message.author.bot) return null;
  const cfg = loadGuild(message.guild.id);
  const h = ensureHoneypot(cfg);
  if (!h.enabled || !h.channelId) return null;
  if (message.channel.id !== h.channelId) return null;
  if (isExempt(message.member, h)) return null;

  // Ignore the pinned warning if somehow re-sent by a human editing — only user posts
  await message.delete().catch(() => {});

  const reason = 'Honeypot channel — unauthorized message';
  const moderator = client.user;
  const tag = message.author.tag;
  const action = h.action || 'kick';

  try {
    if (action === 'ban') {
      await banMember(message.guild, {
        target: message.member || message.author,
        moderator,
        reason,
        deleteDays: 1,
        dm: false,
      });
    } else if (action === 'softban') {
      await softbanMember(message.guild, {
        target: message.member || message.author,
        moderator,
        reason,
        days: 1,
      });
    } else if (action === 'mute') {
      if (message.member) {
        const store = require('../utils/store');
        await muteMember(message.guild, {
          target: message.member,
          moderator,
          reason,
          durationMs: 24 * 60 * 60 * 1000,
          store,
        });
      }
    } else {
      if (message.member) {
        await kickMember(message.guild, {
          target: message.member,
          moderator,
          reason,
        });
      }
    }
  } catch (err) {
    console.error('honeypot punish:', err.message);
    return { caught: false, error: err.message };
  }

  h.caught = (h.caught || 0) + 1;
  h.lastCaughtId = message.author.id;
  h.lastCaughtTag = tag;
  h.lastCaughtAt = Date.now();
  saveGuild(message.guild.id, cfg);

  return { caught: true, action, tag, count: h.caught };
}

function statusEmbed(guildId, cfg) {
  const h = ensureHoneypot(cfg);
  const ch = h.channelId ? `<#${h.channelId}>` : '_not created_';
  const last = h.lastCaughtTag
    ? `${h.lastCaughtTag} · <t:${Math.floor((h.lastCaughtAt || 0) / 1000)}:R>`
    : 'none yet';
  return baseEmbed(guildId, {
    title: 'Honeypot',
    description:
      'A public decoy channel with a warning. Spammers / hacked accounts that type there are removed.\n\n' +
      `→ __**Status**__ — ${h.enabled ? '**ON**' : '**OFF**'}\n` +
      `→ __**Channel**__ — ${ch}\n` +
      `→ __**Action**__ — **${h.action}**\n` +
      `→ __**Caught**__ — **${h.caught || 0}**\n` +
      `→ __**Last**__ — ${last}`,
  });
}

function panelComponents(cfg) {
  const h = ensureHoneypot(cfg);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('honeypot:create')
        .setLabel(h.channelId ? 'Recreate / Repair' : 'Create Channel')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('honeypot:toggle')
        .setLabel(h.enabled ? 'Disable' : 'Enable')
        .setStyle(h.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('honeypot:stats')
        .setLabel(`Stats (${h.caught || 0})`)
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('honeypot:action:kick')
        .setLabel('Kick')
        .setStyle(h.action === 'kick' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('honeypot:action:softban')
        .setLabel('Softban')
        .setStyle(h.action === 'softban' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('honeypot:action:ban')
        .setLabel('Ban')
        .setStyle(h.action === 'ban' ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('honeypot:action:mute')
        .setLabel('Mute')
        .setStyle(h.action === 'mute' ? ButtonStyle.Primary : ButtonStyle.Secondary)
    ),
  ];
}

function statsDismissComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('honeypot:dismiss')
        .setLabel('Dismiss')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function statsEmbed(guildId, cfg) {
  const h = ensureHoneypot(cfg);
  return baseEmbed(guildId, {
    title: 'Honeypot catches',
    description:
      `**${h.caught || 0}** people removed for typing in the honeypot.\n\n` +
      (h.lastCaughtTag
        ? `Last: **${h.lastCaughtTag}** (<@${h.lastCaughtId}>)\nWhen: <t:${Math.floor((h.lastCaughtAt || 0) / 1000)}:F>`
        : '_No catches yet._') +
      `\n\nAction: **${h.action}** · Channel: ${h.channelId ? `<#${h.channelId}>` : '—'}`,
  });
}

/**
 * After a template creates a honeypot-marked channel, wire config + warning.
 */
async function bindTemplateChannel(guild, channel, action = 'kick') {
  const cfg = loadGuild(guild.id);
  const h = ensureHoneypot(cfg);
  h.channelId = channel.id;
  h.enabled = true;
  if (ACTIONS.includes(action)) h.action = action;
  const warn = await postWarning(channel, guild.id, h.action);
  h.warningMessageId = warn.id;
  saveGuild(guild.id, cfg);
  return h;
}

module.exports = {
  DEFAULT_NAME,
  ACTIONS,
  ensureHoneypot,
  createHoneypotChannel,
  handleHoneypotMessage,
  statusEmbed,
  panelComponents,
  statsEmbed,
  statsDismissComponents,
  warningEmbed,
  postWarning,
  bindTemplateChannel,
};
