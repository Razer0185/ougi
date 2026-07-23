/**
 * Panel action handlers for expanded Dyno/MEE6/Carl features.
 */
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');
const { loadGuild, saveGuild } = require('../utils/store');
const { channelPick, nukeChannelPick, userPickRow } = require('../ui/components');
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
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Purge',
          description: 'In chat: `purge 50` or `purge #channel 50 [@user]`',
        }),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'slowmode') {
    if (!(await requireMod(interaction))) return true;
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Slowmode',
          description: 'In chat: `slowmode 5` or `slowmode #general 10`',
        }),
      ],
      ephemeral: true,
    });
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
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Giveaway',
          description:
            'Start with:\n`giveaway prize | 1h | winners | max|unlimited | server`\n\nExample: `giveaway nitro | 1h | 1`',
        }),
      ],
      ephemeral: true,
    });
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
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Autoresponder',
          description:
            '→ `autorespond add hi | hello there`\n' +
            '→ `autorespond list`\n' +
            '→ `autorespond remove hi`',
        }),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'sticky') {
    if (!(await requireMod(interaction))) return true;
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Sticky',
          description: '→ `sticky Your message here`\n→ `sticky clear`',
        }),
      ],
      ephemeral: true,
    });
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
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Poll',
          description: '`poll Question | Option A | Option B`',
        }),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'remind') {
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Remind',
          description: '`remind 1h do the thing`',
        }),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'embed') {
    if (!(await requireMod(interaction))) return true;
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Embed Builder',
          description: '`embed Title | Description | [imageURL]`\nOr `embed #channel Title | Desc`',
        }),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'afk') {
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'AFK',
          description: '`afk be right back` · `afk clear`',
        }),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'customcmd') {
    if (!(await requireAdmin(interaction))) return true;
    const list = listCustomCommands(interaction.guild.id);
    const prefix = require('../utils/store').getGuildPrefix(interaction.guild.id);
    const listText = list.length
      ? list.map((c) => `• \`${prefix}${c}\``).join('\n')
      : 'You have none yet.';
    await interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Custom Commands',
          description:
            `**Your commands**\n${listText}\n\n` +
            `**How to use**\n` +
            `• Add: \`${prefix}cc add hello Hi everyone!\`\n` +
            `• Remove: \`${prefix}cc remove hello\`\n` +
            `• List: \`${prefix}cc list\`\n\n` +
            `After you add one, type \`${prefix}hello\` in chat and the bot replies.`,
        }),
      ],
      ephemeral: true,
    });
    return true;
  }

  return false;
}

module.exports = { handleExpandedPanel };
