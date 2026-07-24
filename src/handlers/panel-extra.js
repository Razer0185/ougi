/**
 * Panel action handlers for expanded Dyno/MEE6/Carl features.
 */
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');
const { loadGuild, saveGuild } = require('../utils/store');
const { channelPick, nukeChannelPick, userPickRow, modal } = require('../ui/components');
const { ChannelType } = require('discord.js');
const { ensureLevels, getUserLevel, leaderboard, rankEmbed } = require('../features/levels');
const { autorolePickRow, postSelfRolePanel } = require('../features/roles');
const { listCustomCommands } = require('../features/customcommands');

async function handleExpandedPanel(interaction, action, requireMod, requireAdmin) {
  if (['warn', 'softban', 'addrole', 'removerole'].includes(action)) {
    if (!(await requireMod(interaction))) return true;
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: action.toUpperCase(),
          description: `Select the member for **${action}**.`,
        }),
      ],
      components: [userPickRow(action)],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'purge') {
    if (!(await requireMod(interaction))) return true;
    await interaction.showModal(
      modal('panel:purge', 'Purge Messages', [
        { id: 'amount', label: 'How many? (1-100)', placeholder: '25', value: '25', max: 3 },
      ])
    );
    return true;
  }

  if (action === 'slowmode') {
    if (!(await requireMod(interaction))) return true;
    await interaction.showModal(
      modal('panel:slowmode', 'Channel Slowmode', [
        { id: 'seconds', label: 'Seconds (0 = off, max 21600)', placeholder: '5', value: '5', max: 5 },
      ])
    );
    return true;
  }

  if (action === 'modlog' || action === 'serverlog') {
    if (!(await requireAdmin(interaction))) return true;
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: action === 'modlog' ? 'Mod Log Channel' : 'Server Log Channel',
          description: 'Select the channel for logs.',
        }),
      ],
      components: [
        channelPick(
          action === 'modlog' ? 'modlog:channel' : 'serverlog:channel',
          'Select log channel',
          [ChannelType.GuildText, ChannelType.GuildAnnouncement]
        ),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'nuke') {
    if (!(await requireMod(interaction))) return true;
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Nuke Channel',
          description: 'Select a channel to wipe, or run `nuke` in that channel.',
        }),
      ],
      components: [nukeChannelPick()],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'giveaway') {
    if (!(await requireMod(interaction))) return true;
    await interaction.showModal(
      modal('panel:giveaway', 'Start Giveaway', [
        { id: 'prize', label: 'Prize', placeholder: 'Nitro', max: 100 },
        { id: 'duration', label: 'Duration (e.g. 1h, 30m, 1d)', placeholder: '1h', max: 10 },
        { id: 'winners', label: 'Winners', placeholder: '1', value: '1', max: 2 },
      ])
    );
    return true;
  }

  if (action === 'autorole') {
    if (!(await requireAdmin(interaction))) return true;
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Autorole',
          description: 'Select role(s) given when members join.',
        }),
      ],
      components: [autorolePickRow()],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'reactrole') {
    if (!(await requireAdmin(interaction))) return true;
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Reaction Roles',
          description: 'In chat: `reactionrole 👍 @Role | 🔥 @Other`',
        }),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'selfrole') {
    if (!(await requireAdmin(interaction))) return true;
    try {
      await postSelfRolePanel(interaction.channel, interaction.guild.id);
      await interaction.reply({
        embeds: [successEmbed(interaction.guild.id, 'Self Roles', 'Panel posted in this channel.')],
        ephemeral: true,
      });
    } catch (err) {
      await interaction.reply({
        embeds: [errorEmbed(interaction.guild.id, 'Self Roles', String(err.message || err))],
        ephemeral: true,
      });
    }
    return true;
  }

  if (action === 'leveltoggle') {
    if (!(await requireAdmin(interaction))) return true;
    const cfg = ensureLevels(loadGuild(interaction.guild.id));
    cfg.levels.enabled = !cfg.levels.enabled;
    saveGuild(interaction.guild.id, cfg);
    await interaction.reply({
      embeds: [
        successEmbed(
          interaction.guild.id,
          'Leveling',
          `XP is now **${cfg.levels.enabled ? 'ON' : 'OFF'}**.`
        ),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'rank') {
    const stats = getUserLevel(interaction.guild.id, interaction.user.id);
    const board = leaderboard(interaction.guild.id, 100);
    const pos = board.findIndex((r) => r.id === interaction.user.id) + 1 || null;
    await interaction.reply({
      embeds: [rankEmbed(interaction.guild.id, interaction.user, stats, pos || null)],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'leaderboard') {
    const top = leaderboard(interaction.guild.id, 10);
    const body =
      top.length === 0
        ? '_No XP yet._'
        : top
            .map((r, i) => `→ **#${i + 1}** <@${r.id}> — lvl **${r.level}** (${r.xp} xp)`)
            .join('\n');
    await interaction.reply({
      embeds: [baseEmbed(interaction.guild.id, { title: 'XP Leaderboard', description: body })],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'levelannounce') {
    if (!(await requireAdmin(interaction))) return true;
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Level-Up Channel',
          description: 'Select where level-up messages post.',
        }),
      ],
      components: [
        channelPick('levels:announce', 'Select announce channel', [
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
        ]),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'levelreward') {
    if (!(await requireAdmin(interaction))) return true;
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Level Rewards',
          description: 'In chat: `levels reward 10 @Role`',
        }),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'autoresponder') {
    if (!(await requireAdmin(interaction))) return true;
    await interaction.showModal(
      modal('panel:autorespond', 'Add Autoresponder', [
        { id: 'trigger', label: 'Trigger word/phrase', placeholder: 'hi', max: 64 },
        { id: 'response', label: 'Bot reply', style: 'long', placeholder: 'hello there!', max: 500 },
      ])
    );
    return true;
  }

  if (action === 'sticky') {
    if (!(await requireMod(interaction))) return true;
    await interaction.showModal(
      modal('panel:sticky', 'Sticky Message', [
        {
          id: 'text',
          label: 'Message (or type clear)',
          style: 'long',
          placeholder: 'Rules reminder…',
          max: 1000,
        },
      ])
    );
    return true;
  }

  if (action === 'starboard') {
    if (!(await requireAdmin(interaction))) return true;
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Starboard',
          description: 'Select the starboard channel (default: 3 stars).',
        }),
      ],
      components: [
        channelPick('starboard:channel', 'Select starboard channel', [
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
        ]),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'poll') {
    if (!(await requireMod(interaction))) return true;
    await interaction.showModal(
      modal('panel:poll', 'Create Poll', [
        { id: 'question', label: 'Question', placeholder: 'Favorite color?', max: 200 },
        { id: 'options', label: 'Options (split with |)', placeholder: 'Red | Blue | Green', max: 400 },
      ])
    );
    return true;
  }

  if (action === 'remind') {
    await interaction.showModal(
      modal('panel:remind', 'Set Reminder', [
        { id: 'when', label: 'When (e.g. 1h, 30m, 1d)', placeholder: '1h', max: 10 },
        { id: 'text', label: 'Remind me to…', style: 'long', placeholder: 'do the thing', max: 500 },
      ])
    );
    return true;
  }

  if (action === 'embed') {
    if (!(await requireMod(interaction))) return true;
    await interaction.showModal(
      modal('panel:embed', 'Embed Builder', [
        { id: 'title', label: 'Title', placeholder: 'Announcement', max: 100 },
        { id: 'description', label: 'Description', style: 'long', placeholder: 'Your message…', max: 1500 },
        { id: 'image', label: 'Image URL (optional)', required: false, placeholder: 'https://…', max: 300 },
      ])
    );
    return true;
  }

  if (action === 'afk') {
    await interaction.showModal(
      modal('panel:afk', 'AFK Status', [
        {
          id: 'reason',
          label: 'Reason (or type clear)',
          placeholder: 'be right back',
          max: 200,
        },
      ])
    );
    return true;
  }

  if (action === 'customcmd') {
    if (!(await requireAdmin(interaction))) return true;
    const list = listCustomCommands(interaction.guild.id);
    const prefix = require('../utils/store').getGuildPrefix(interaction.guild.id);
    const body =
      list.length === 0
        ? `_None yet._\nUse \`${prefix}custom add name | response\``
        : list.map((c) => `→ \`${prefix}${c.name}\``).join('\n') +
          `\n\nManage: \`${prefix}custom add name | response\``;
    await interaction.reply({
      embeds: [baseEmbed(interaction.guild.id, { title: 'Custom Commands', description: body })],
      ephemeral: true,
    });
    return true;
  }

  return false;
}

module.exports = { handleExpandedPanel };
