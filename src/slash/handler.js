const {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
} = require('discord.js');
const store = require('../utils/store');
const { loadGuild, saveGuild } = store;
const { baseEmbed, successEmbed, errorEmbed, rulesStyleList } = require('../utils/embeds');
const {
  memberHasMod,
  memberHasAdmin,
  ensureMutedRole,
  lockChannel,
  unlockChannel,
  parseDuration,
  PermissionFlagsBits,
} = require('../utils/helpers');
const { parseEventStart } = require('../utils/events');
const { THEMES } = require('../utils/theme');
const { helpEmbed, HELP_PAGES, createPanel, runNuke } = require('../commands');
const { helpNav, lockChannelPick, nukeChannelPick } = require('../ui/components');
const {
  ensureInvites,
  getUserStats,
  statsEmbed,
  leaderboard: inviteLeaderboard,
  trackerMenuEmbed,
} = require('../features/invites');
const {
  startGiveaway,
  endGiveaway,
  getGiveaway,
  ensureGiveaways,
} = require('../features/giveaways');
const {
  warnMember,
  softbanMember,
  purgeMessages,
  setSlowmode,
  setModLogChannel,
  getCasesForUser,
  sendModLog,
} = require('../features/moderation');
const {
  getUserLevel,
  leaderboard: xpLeaderboard,
  rankEmbed,
  ensureLevels,
} = require('../features/levels');
const { setLogChannel } = require('../features/logging');
const { createPoll } = require('../features/polls');
const { addReminder } = require('../features/reminders');
const { setAfk, clearAfk } = require('../features/afk');

async function handleSlash(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  const name = interaction.commandName;
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'Use this in a server.', ephemeral: true });
    return true;
  }

  try {
    if (name === 'ping') {
      await interaction.reply({
        embeds: [
          successEmbed(guild.id, 'Pong', `→ __**WS:**__ ${interaction.client.ws.ping}ms`),
        ],
      });
      return true;
    }

    if (name === 'help') {
      await interaction.reply({
        embeds: [helpEmbed(guild.id, 0)],
        components: helpNav(0, HELP_PAGES.length, guild.id),
        ephemeral: true,
      });
      return true;
    }

    if (name === 'invite') {
      const { buildBotInviteUrl } = require('../utils/invite');
      const { isPrivateMode, loadAccess, allowGuild } = require('../utils/access');
      const url = buildBotInviteUrl(interaction.client.user.id);
      if (isPrivateMode()) {
        const application = await interaction.client.application.fetch().catch(() => null);
        const isOwner =
          application?.owner?.id === interaction.user.id ||
          application?.owner?.ownerId === interaction.user.id ||
          loadAccess().ownerDiscordIds.includes(interaction.user.id);
        if (!isOwner && !memberHasAdmin(interaction.member)) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                guild.id,
                'Private Bot',
                'Ougi is invite-only. Request access on the website — no public add link.'
              ),
            ],
            ephemeral: true,
          });
          return true;
        }
      }
      if (guild) allowGuild(guild.id);
      await interaction.reply({
        embeds: [
          baseEmbed(guild.id, {
            title: 'Private Invite',
            description:
              (isPrivateMode() ? '**Private mode is ON.**\n\n' : '') +
              `Invite (do not post publicly):\n${url}\n\n` +
              'Then approve with `access allow <serverId>` or Ougi Host → Access.',
          }),
        ],
        ephemeral: true,
      });
      return true;
    }

    if (name === 'setup') {
      if (!memberHasAdmin(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Administrator required.')],
          ephemeral: true,
        });
        return true;
      }
      const channel = await createPanel(guild, interaction.client);
      await interaction.reply({
        embeds: [successEmbed(guild.id, 'Setup Complete', `Control panel ready in ${channel}`)],
        ephemeral: true,
      });
      return true;
    }

    if (name === 'panel') {
      if (!memberHasAdmin(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Administrator required.')],
          ephemeral: true,
        });
        return true;
      }
      const channel = await createPanel(guild, interaction.client);
      await interaction.reply({
        embeds: [successEmbed(guild.id, 'Control Panel', `Panel ready in ${channel}`)],
        ephemeral: true,
      });
      return true;
    }

    if (name === 'lock' || name === 'unlock') {
      if (!memberHasMod(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Mod permission required.')],
          ephemeral: true,
        });
        return true;
      }
      let channel = interaction.options.getChannel('channel');
      const inPanel = loadGuild(guild.id).panelChannelId === interaction.channelId;
      if (!channel && inPanel) {
        await interaction.reply({
          embeds: [
            baseEmbed(guild.id, {
              title: name === 'lock' ? 'Lock Channel' : 'Unlock Channel',
              description: `Select which channel to **${name}**.`,
            }),
          ],
          components: [lockChannelPick(name)],
          ephemeral: true,
        });
        return true;
      }
      if (!channel) channel = interaction.channel;
      if (name === 'lock') await lockChannel(channel);
      else await unlockChannel(channel);
      await interaction.reply({
        embeds: [
          successEmbed(
            guild.id,
            name === 'lock' ? 'Locked' : 'Unlocked',
            `${channel} is now ${name === 'lock' ? 'locked' : 'unlocked'}.`
          ),
        ],
        ephemeral: true,
      });
      return true;
    }

    if (name === 'nuke') {
      if (
        !memberHasMod(interaction.member) ||
        !interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)
      ) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Manage Channels permission required.')],
          ephemeral: true,
        });
        return true;
      }
      let channel = interaction.options.getChannel('channel');
      const inPanel = loadGuild(guild.id).panelChannelId === interaction.channelId;
      if (!channel && inPanel) {
        await interaction.reply({
          embeds: [
            baseEmbed(guild.id, {
              title: 'Nuke Channel',
              description: 'Select which channel to wipe.',
            }),
          ],
          components: [nukeChannelPick()],
          ephemeral: true,
        });
        return true;
      }
      if (!channel) channel = interaction.channel;
      if (!channel?.isTextBased() || channel.isDMBased() || channel.isThread()) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Nuke', 'Run this in a normal text channel.')],
          ephemeral: true,
        });
        return true;
      }

      await interaction.reply({
        embeds: [successEmbed(guild.id, 'Nuking…', `Clearing ${channel}.`)],
        ephemeral: true,
      });
      await runNuke(guild, channel, interaction.user.tag);
      return true;
    }

    if (name === 'ban' || name === 'kick') {
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, name, 'Member not found.')],
          ephemeral: true,
        });
        return true;
      }
      if (name === 'ban') {
        if (!interaction.member.permissions.has('BanMembers')) {
          await interaction.reply({
            embeds: [errorEmbed(guild.id, 'Denied', 'Ban permission required.')],
            ephemeral: true,
          });
          return true;
        }
        await member.ban({ reason: `${interaction.user.tag}: ${reason}` });
      } else {
        if (!interaction.member.permissions.has('KickMembers')) {
          await interaction.reply({
            embeds: [errorEmbed(guild.id, 'Denied', 'Kick permission required.')],
            ephemeral: true,
          });
          return true;
        }
        await member.kick(`${interaction.user.tag}: ${reason}`);
      }
      await interaction.reply({
        embeds: [
          successEmbed(guild.id, name === 'ban' ? 'Banned' : 'Kicked', `→ **${user.tag}**\n→ ${reason}`),
        ],
        ephemeral: true,
      });
      return true;
    }

    if (name === 'mute' || name === 'unmute') {
      if (!memberHasMod(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Mod permission required.')],
          ephemeral: true,
        });
        return true;
      }
      const user = interaction.options.getUser('user', true);
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, name, 'Member not found.')],
          ephemeral: true,
        });
        return true;
      }
      if (name === 'unmute') {
        await member.timeout(null).catch(() => {});
        const cfg = loadGuild(guild.id);
        if (cfg.mutedRoleId) await member.roles.remove(cfg.mutedRoleId).catch(() => {});
        await interaction.reply({
          embeds: [successEmbed(guild.id, 'Unmuted', `→ **${user.tag}**`)],
          ephemeral: true,
        });
        return true;
      }
      const duration = parseDuration(interaction.options.getString('duration') || '1h');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      try {
        await member.timeout(duration, `${interaction.user.tag}: ${reason}`);
      } catch {
        const role = await ensureMutedRole(guild, store);
        await member.roles.add(role, reason);
      }
      await interaction.reply({
        embeds: [successEmbed(guild.id, 'Muted', `→ **${user.tag}**\n→ ${reason}`)],
        ephemeral: true,
      });
      return true;
    }

    if (name === 'event') {
      if (!memberHasAdmin(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Admin required.')],
          ephemeral: true,
        });
        return true;
      }
      const title = interaction.options.getString('title', true);
      const description = interaction.options.getString('description', true);
      const whenRaw = interaction.options.getString('when') || 'now';
      const location = interaction.options.getString('location') || 'Server Event';
      const { start, label } = parseEventStart(whenRaw);
      const end = new Date(start.getTime() + 2 * 3600 * 1000);
      const event = await guild.scheduledEvents.create({
        name: title.slice(0, 100),
        description: description.slice(0, 1000),
        scheduledStartTime: start,
        scheduledEndTime: end,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
        entityMetadata: { location: location.slice(0, 100) },
      });
      await interaction.reply({
        embeds: [
          successEmbed(
            guild.id,
            'Event Created',
            `→ __**${event.name}**__\n→ Starts <t:${Math.floor(start.getTime() / 1000)}:F> (${label})\n→ ${location}`
          ),
        ],
      });
      return true;
    }

    if (name === 'invites') {
      const cfg = ensureInvites(loadGuild(guild.id));
      const action = interaction.options.getString('action');
      const user = interaction.options.getUser('user');
      if (action === 'top') {
        const top = inviteLeaderboard(guild.id, 15);
        const body =
          top.length === 0
            ? '_No data yet._'
            : top
                .map(
                  (r, i) =>
                    `→ **#${i + 1}** <@${r.id}> — valid **${r.valid}** · joins ${r.joins} · left ${r.left} · fake ${r.fake}`
                )
                .join('\n');
        await interaction.reply({
          embeds: [baseEmbed(guild.id, { title: 'Invite Leaderboard', description: body })],
          ephemeral: true,
        });
        return true;
      }
      if (action === 'on' || action === 'off') {
        if (!memberHasAdmin(interaction.member)) {
          await interaction.reply({
            embeds: [errorEmbed(guild.id, 'Denied', 'Admin required.')],
            ephemeral: true,
          });
          return true;
        }
        cfg.invites.enabled = action === 'on';
        saveGuild(guild.id, cfg);
        await interaction.reply({
          embeds: [
            successEmbed(guild.id, 'Invite Tracker', `Tracker ${cfg.invites.enabled ? 'ON' : 'OFF'}`),
          ],
          ephemeral: true,
        });
        return true;
      }
      if (user) {
        const stats = getUserStats(cfg, user.id);
        saveGuild(guild.id, cfg);
        await interaction.reply({
          embeds: [statsEmbed(guild.id, user, stats)],
          ephemeral: true,
        });
        return true;
      }
      await interaction.reply({
        embeds: [trackerMenuEmbed(guild.id)],
        ephemeral: true,
      });
      return true;
    }

    if (name === 'nick') {
      if (!memberHasMod(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Mod permission required.')],
          ephemeral: true,
        });
        return true;
      }
      const user = interaction.options.getUser('user', true);
      const nickname = interaction.options.getString('nickname', true).slice(0, 32);
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Nick', 'Member not found.')],
          ephemeral: true,
        });
        return true;
      }
      await member.setNickname(nickname);
      await interaction.reply({
        embeds: [
          successEmbed(guild.id, 'Nickname Updated', `→ **${user.tag}** is now **${nickname}**`),
        ],
      });
      return true;
    }

    if (name === 'prefix') {
      if (!memberHasAdmin(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Admin required.')],
          ephemeral: true,
        });
        return true;
      }
      const { setGuildPrefix } = require('../utils/store');
      const next = setGuildPrefix(guild.id, interaction.options.getString('symbol', true));
      if (!next) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Prefix', 'Provide a prefix up to 5 characters.')],
          ephemeral: true,
        });
        return true;
      }
      await interaction.reply({
        embeds: [
          successEmbed(
            guild.id,
            'Prefix Updated',
            `New prefix: \`${next}\`\nTry: \`${next}help\` · \`${next}ping\``
          ),
        ],
      });
      return true;
    }

    if (name === 'theme') {
      if (!memberHasAdmin(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Admin required.')],
          ephemeral: true,
        });
        return true;
      }
      const key = interaction.options.getString('color', true);
      if (!THEMES[key]) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Theme', 'Invalid theme color.')],
          ephemeral: true,
        });
        return true;
      }
      const { applyThemeAndSyncRoles } = require('../features/theme-roles');
      await applyThemeAndSyncRoles(guild, key);
      await createPanel(guild, interaction.client, { skipThemeRoles: true }).catch((err) => {
        console.error('Theme panel refresh failed:', err.message);
      });
      await interaction.reply({
        embeds: [
          successEmbed(
            guild.id,
            'Theme Updated',
            `Accent set to **${THEMES[key].label}**\nControl panel updated. Bot color role applied (your roles are unchanged).\nActive theme role is hoisted.`
          ),
        ],
      });
      return true;
    }

    if (name === 'serverinfo') {
      await interaction.reply({
        embeds: [
          baseEmbed(guild.id, {
            title: guild.name,
            thumbnail: guild.iconURL({ size: 256 }),
            description: rulesStyleList([
              { label: 'Members', text: String(guild.memberCount) },
              { label: 'Channels', text: String(guild.channels.cache.size) },
              { label: 'Roles', text: String(guild.roles.cache.size) },
              { label: 'Owner', text: `<@${guild.ownerId}>` },
              { label: 'Created', text: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>` },
            ]),
          }),
        ],
      });
      return true;
    }

    if (name === 'userinfo') {
      const user = interaction.options.getUser('user') || interaction.user;
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'User Info', 'Member not found.')],
          ephemeral: true,
        });
        return true;
      }
      await interaction.reply({
        embeds: [
          baseEmbed(guild.id, {
            title: member.user.tag,
            thumbnail: member.user.displayAvatarURL({ size: 256 }),
            description: rulesStyleList([
              { label: 'ID', text: member.id },
              { label: 'Nickname', text: member.displayName },
              {
                label: 'Joined',
                text: member.joinedTimestamp
                  ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
                  : 'Unknown',
              },
              { label: 'Roles', text: String(member.roles.cache.size - 1) },
            ]),
          }),
        ],
      });
      return true;
    }

    if (name === 'giveaway') {
      if (!memberHasMod(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Mod permission required.')],
          ephemeral: true,
        });
        return true;
      }
      const prize = interaction.options.getString('prize', true);
      const durationRaw = interaction.options.getString('duration', true);
      const winners = interaction.options.getInteger('winners') || 1;
      const maxEntries = interaction.options.getInteger('max_entries');
      const requireServer = interaction.options.getString('require_server');
      try {
        const { message: gmsg } = await startGiveaway(interaction.client, {
          guild,
          channel: interaction.channel,
          host: interaction.user,
          prize,
          durationMs: parseDuration(durationRaw),
          winners,
          maxEntries,
          requireServer,
        });
        await interaction.reply({
          embeds: [
            successEmbed(guild.id, 'Giveaway Started', `Posted → [jump](${gmsg.url})`),
          ],
          ephemeral: true,
        });
      } catch (err) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Giveaway', String(err.message || err))],
          ephemeral: true,
        });
      }
      return true;
    }

    if (name === 'gend') {
      if (!memberHasMod(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Mod permission required.')],
          ephemeral: true,
        });
        return true;
      }
      const cfg = ensureGiveaways(loadGuild(guild.id));
      const messageId =
        interaction.options.getString('message_id') ||
        Object.values(cfg.giveaways)
          .filter((g) => !g.ended && g.channelId === interaction.channelId)
          .sort((a, b) => b.endsAt - a.endsAt)[0]?.messageId;
      if (!messageId) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Giveaway', 'No active giveaway found. Pass message_id.')],
          ephemeral: true,
        });
        return true;
      }
      const result = await endGiveaway(interaction.client, guild.id, messageId);
      await interaction.reply({
        embeds: [
          result
            ? successEmbed(guild.id, 'Giveaway', 'Ended and winners drawn.')
            : errorEmbed(guild.id, 'Giveaway', 'Giveaway not found.'),
        ],
        ephemeral: true,
      });
      return true;
    }

    if (name === 'greroll') {
      if (!memberHasMod(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Mod permission required.')],
          ephemeral: true,
        });
        return true;
      }
      const cfg = ensureGiveaways(loadGuild(guild.id));
      const messageId =
        interaction.options.getString('message_id') ||
        Object.values(cfg.giveaways)
          .filter((g) => g.ended && g.channelId === interaction.channelId)
          .sort((a, b) => b.endsAt - a.endsAt)[0]?.messageId;
      if (!messageId || !getGiveaway(guild.id, messageId)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Giveaway', 'No ended giveaway found. Pass message_id.')],
          ephemeral: true,
        });
        return true;
      }
      const result = await endGiveaway(interaction.client, guild.id, messageId, { reroll: true });
      await interaction.reply({
        embeds: [
          successEmbed(
            guild.id,
            'Rerolled',
            result?.winnerIds?.length
              ? `New winner(s): ${result.winnerIds.map((id) => `<@${id}>`).join(', ')}`
              : 'No valid entries to reroll.'
          ),
        ],
        ephemeral: true,
      });
      return true;
    }

    if (name === 'warn') {
      if (!memberHasMod(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Mod required.')],
          ephemeral: true,
        });
        return true;
      }
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Warn', 'Member not found.')],
          ephemeral: true,
        });
        return true;
      }
      const row = await warnMember(guild, {
        target: member,
        moderator: interaction.user,
        reason,
      });
      await interaction.reply({
        embeds: [
          successEmbed(guild.id, 'Warned', `→ **${user.tag}** · Case #${row.id}\n→ ${reason}`),
        ],
      });
      return true;
    }

    if (name === 'warnings') {
      const user = interaction.options.getUser('user') || interaction.user;
      const cases = getCasesForUser(guild.id, user.id).filter((c) => c.type === 'warn');
      const body =
        cases.length === 0
          ? '_No warnings._'
          : cases
              .slice(-15)
              .map(
                (c) =>
                  `→ **#${c.id}** <t:${Math.floor(c.at / 1000)}:R> — ${c.reason}`
              )
              .join('\n');
      await interaction.reply({
        embeds: [baseEmbed(guild.id, { title: `Warnings · ${user.tag}`, description: body })],
        ephemeral: true,
      });
      return true;
    }

    if (name === 'softban') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Ban permission required.')],
          ephemeral: true,
        });
        return true;
      }
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const member = await guild.members.fetch(user.id).catch(() => null);
      await softbanMember(guild, {
        target: member || { id: user.id, user, tag: user.tag },
        moderator: interaction.user,
        reason,
      });
      await interaction.reply({
        embeds: [successEmbed(guild.id, 'Softbanned', `→ **${user.tag}** · ${reason}`)],
      });
      return true;
    }

    if (name === 'purge') {
      if (!memberHasMod(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Mod required.')],
          ephemeral: true,
        });
        return true;
      }
      const amount = interaction.options.getInteger('amount', true);
      const user = interaction.options.getUser('user');
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      await interaction.deferReply({ ephemeral: true });
      const deleted = await purgeMessages(channel, {
        amount,
        userId: user?.id || null,
      });
      await sendModLog(guild, {
        action: 'Purge',
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        modId: interaction.user.id,
        reason: `Purged ${deleted} in #${channel.name}`,
      });
      await interaction.editReply({
        embeds: [successEmbed(guild.id, 'Purged', `Deleted **${deleted}** in ${channel}.`)],
      });
      return true;
    }

    if (name === 'slowmode') {
      if (!memberHasMod(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Mod required.')],
          ephemeral: true,
        });
        return true;
      }
      const seconds = interaction.options.getInteger('seconds', true);
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const s = await setSlowmode(channel, seconds);
      await interaction.reply({
        embeds: [successEmbed(guild.id, 'Slowmode', `${channel} → **${s}s**`)],
      });
      return true;
    }

    if (name === 'modlog') {
      if (!memberHasAdmin(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Admin required.')],
          ephemeral: true,
        });
        return true;
      }
      const channel = interaction.options.getChannel('channel', true);
      await setModLogChannel(guild.id, channel.id);
      await interaction.reply({
        embeds: [successEmbed(guild.id, 'Mod Log', `Set to ${channel}`)],
        ephemeral: true,
      });
      return true;
    }

    if (name === 'serverlog') {
      if (!memberHasAdmin(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Admin required.')],
          ephemeral: true,
        });
        return true;
      }
      const channel = interaction.options.getChannel('channel', true);
      setLogChannel(guild.id, channel.id);
      await interaction.reply({
        embeds: [successEmbed(guild.id, 'Server Log', `Set to ${channel}`)],
        ephemeral: true,
      });
      return true;
    }

    if (name === 'rank') {
      const user = interaction.options.getUser('user') || interaction.user;
      const stats = getUserLevel(guild.id, user.id);
      const board = xpLeaderboard(guild.id, 100);
      const pos = board.findIndex((r) => r.id === user.id) + 1 || null;
      await interaction.reply({
        embeds: [rankEmbed(guild.id, user, stats, pos || null)],
      });
      return true;
    }

    if (name === 'levels') {
      const top = xpLeaderboard(guild.id, 10);
      const body =
        top.length === 0
          ? '_No XP yet._'
          : top
              .map((r, i) => `→ **#${i + 1}** <@${r.id}> — lvl **${r.level}** (${r.xp} xp)`)
              .join('\n');
      await interaction.reply({
        embeds: [baseEmbed(guild.id, { title: 'XP Leaderboard', description: body })],
      });
      return true;
    }

    if (name === 'leveling') {
      if (!memberHasAdmin(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Admin required.')],
          ephemeral: true,
        });
        return true;
      }
      const cfg = ensureLevels(loadGuild(guild.id));
      const action = interaction.options.getString('action');
      const announce = interaction.options.getChannel('announce_channel');
      if (action) cfg.levels.enabled = action === 'on';
      if (announce) cfg.levels.announceChannelId = announce.id;
      saveGuild(guild.id, cfg);
      await interaction.reply({
        embeds: [
          successEmbed(
            guild.id,
            'Leveling',
            `Enabled: **${cfg.levels.enabled}**` +
              (announce ? `\nAnnounce: ${announce}` : '')
          ),
        ],
        ephemeral: true,
      });
      return true;
    }

    if (name === 'poll') {
      if (!memberHasMod(interaction.member)) {
        await interaction.reply({
          embeds: [errorEmbed(guild.id, 'Denied', 'Mod required.')],
          ephemeral: true,
        });
        return true;
      }
      const question = interaction.options.getString('question', true);
      const options = interaction.options
        .getString('options', true)
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      await createPoll(interaction.channel, guild.id, question, options);
      await interaction.reply({
        embeds: [successEmbed(guild.id, 'Poll', 'Poll posted.')],
        ephemeral: true,
      });
      return true;
    }

    if (name === 'remind') {
      const durationRaw = interaction.options.getString('duration', true);
      const text = interaction.options.getString('text', true);
      const r = addReminder(interaction.client, {
        guildId: guild.id,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        text,
        durationMs: parseDuration(durationRaw),
      });
      await interaction.reply({
        embeds: [
          successEmbed(
            guild.id,
            'Reminder Set',
            `I'll remind you <t:${Math.floor(r.endsAt / 1000)}:R>:\n${text}`
          ),
        ],
        ephemeral: true,
      });
      return true;
    }

    if (name === 'afk') {
      const reason = interaction.options.getString('reason') || 'AFK';
      if (reason.toLowerCase() === 'clear') {
        clearAfk(guild.id, interaction.user.id);
        await interaction.reply({
          embeds: [successEmbed(guild.id, 'AFK', 'Cleared.')],
          ephemeral: true,
        });
        return true;
      }
      setAfk(guild.id, interaction.user.id, reason);
      await interaction.reply({
        embeds: [successEmbed(guild.id, 'AFK', `You're now AFK: **${reason}**`)],
      });
      return true;
    }
  } catch (err) {
    console.error('Slash error:', err);
    const payload = {
      embeds: [errorEmbed(guild.id, 'Command Error', String(err.message || err))],
      ephemeral: true,
    };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
  return true;
}

module.exports = { handleSlash };
