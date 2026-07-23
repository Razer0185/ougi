const { PermissionFlagsBits, GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel } = require('discord.js');
const store = require('../utils/store');
const { loadGuild, saveGuild } = store;
const {
  baseEmbed,
  successEmbed,
  errorEmbed,
  panelEmbed,
  rulesStyleList,
} = require('../utils/embeds');
const {
  memberHasMod,
  memberHasAdmin,
  resolveMember,
  resolveChannel,
  ensureMutedRole,
  lockChannel,
  unlockChannel,
  nukeChannel,
  retargetAfterNuke,
  setInvitesDisabled,
  parseDuration,
} = require('../utils/helpers');
const { panelComponents, helpNav } = require('../ui/components');
const { HELP_PAGES } = require('../data/help');
const { THEMES } = require('../utils/theme');
const { setupJtc } = require('../features/jtc');
const {
  SERVER_TEMPLATES,
  ROLE_TEMPLATES,
  applyServerTemplate,
  applyRoleTemplate,
  templatePreviewEmbed,
  ensureEmptyEndCategory,
} = require('../features/templates');
const { ticketCreateModal, postTicketPanel } = require('../features/tickets');
const {
  startGiveaway,
  endGiveaway,
  parseGiveawayArgs,
  getGiveaway,
  ensureGiveaways,
} = require('../features/giveaways');
const { ChannelType } = require('discord.js');

const PANEL_CATEGORY_NAME = '╭─── Ougi ✨ ˅';
const PANEL_CHANNEL_NAME = '✨・ougi';

/** Admins bypass overwrites; hide panel from everyone else. */
async function lockPanelVisibility(guild, channel, category) {
  const everyone = guild.roles.everyone.id;
  if (category) {
    await category.permissionOverwrites
      .edit(everyone, { ViewChannel: false })
      .catch(() => {});
  }
  if (channel) {
    await channel.permissionOverwrites
      .edit(everyone, { ViewChannel: false, SendMessages: false })
      .catch(() => {});
  }
}

function isPanelChannel(guildId, channelId) {
  return loadGuild(guildId).panelChannelId === channelId;
}

/** Prefer #mention / name / id; else current channel — unless you're in the panel (then pick). */
async function resolveChannelArg(message, args) {
  const mentioned = message.mentions.channels.first();
  let target = mentioned || null;
  if (!target && args[0]) {
    target = await resolveChannel(message.guild, args[0]);
  }
  if (target) return { target, needPick: false };
  if (isPanelChannel(message.guild.id, message.channel.id)) {
    return { target: null, needPick: true };
  }
  return { target: message.channel, needPick: false };
}

async function runNuke(guild, channel, actorTag) {
  const oldId = channel.id;
  const cfgBefore = loadGuild(guild.id);
  const wasPanel = cfgBefore.panelChannelId === oldId;

  const cloned = await nukeChannel(channel, `Nuked by ${actorTag}`);
  retargetAfterNuke(guild.id, oldId, cloned.id);

  await cloned.send({
    embeds: [
      successEmbed(
        guild.id,
        'Channel Nuked',
        `→ Cleared by **${actorTag}**\n→ All previous messages are gone.`
      ),
    ],
  });

  // If the control panel was nuked, rebuild it in the new channel
  if (wasPanel) {
    const { panelEmbed } = require('../utils/embeds');
    const { panelComponents } = require('../ui/components');
    const panelMsg = await cloned.send({
      embeds: [panelEmbed(guild.id, guild.client, 0)],
      components: panelComponents(guild.id, 0),
    });
    const cfg = loadGuild(guild.id);
    cfg.panelChannelId = cloned.id;
    cfg.panelMessageId = panelMsg.id;
    saveGuild(guild.id, cfg);
    if (cloned.name !== PANEL_CHANNEL_NAME) {
      await cloned.setName(PANEL_CHANNEL_NAME).catch(() => {});
    }
    await lockPanelVisibility(guild, cloned, cloned.parent);
  }

  return cloned;
}

function findLatestGiveawayId(guildId, channelId) {
  const cfg = ensureGiveaways(loadGuild(guildId));
  const active = Object.values(cfg.giveaways)
    .filter((g) => !g.ended && (!channelId || g.channelId === channelId))
    .sort((a, b) => b.endsAt - a.endsAt);
  return active[0]?.messageId || null;
}

function findLatestEndedGiveawayId(guildId, channelId) {
  const cfg = ensureGiveaways(loadGuild(guildId));
  const ended = Object.values(cfg.giveaways)
    .filter((g) => g.ended && (!channelId || g.channelId === channelId))
    .sort((a, b) => b.endsAt - a.endsAt);
  return ended[0]?.messageId || null;
}

function helpEmbed(guildId, page) {
  const p = HELP_PAGES[page];
  const { getGuildPrefix } = require('../utils/store');
  const prefix = getGuildPrefix(guildId);
  return baseEmbed(guildId, {
    title: `Help · ${p.title}`,
    description: `_Prefix: \`${prefix}\` · e.g. \`${prefix}ping\`_\n\n${p.body}`,
    footer: `Page ${page + 1} of ${HELP_PAGES.length} • Use arrows to navigate`,
  });
}

function isPanelCategoryName(name) {
  const n = String(name || '').toLowerCase();
  return (
    n.includes('ougi') ||
    n.includes('example') ||
    n.includes('nexus') ||
    n.includes('╭─── ougi') ||
    n.includes('╭─── example') ||
    /^╭───\s*(ougi|example)/i.test(name)
  );
}

async function createPanel(guild, client) {
  const cfg = loadGuild(guild.id);
  let channel = cfg.panelChannelId && guild.channels.cache.get(cfg.panelChannelId);
  if (!channel) {
    let category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && isPanelCategoryName(c.name)
    );
    if (!category) {
      category = await guild.channels.create({
        name: PANEL_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
        ],
        reason: 'Ougi control panel',
      });
    } else if (category.name !== PANEL_CATEGORY_NAME) {
      await category.setName(PANEL_CATEGORY_NAME).catch(() => {});
    }
    channel = await guild.channels.create({
      name: PANEL_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: 'Ougi control panel — admins only',
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        },
      ],
      reason: 'Ougi control panel',
    });
    await lockPanelVisibility(guild, channel, category);
  } else {
    if (channel.name !== PANEL_CHANNEL_NAME) {
      await channel.setName(PANEL_CHANNEL_NAME).catch(() => {});
    }
    if (channel.parent && channel.parent.name !== PANEL_CATEGORY_NAME) {
      if (isPanelCategoryName(channel.parent.name) || /nexus|example|ougi/i.test(channel.parent.name)) {
        await channel.parent.setName(PANEL_CATEGORY_NAME).catch(() => {});
      }
    }
    await channel.setTopic('Ougi control panel — admins only').catch(() => {});
    await lockPanelVisibility(guild, channel, channel.parent);
  }

  // Remove old panel message if present to avoid duplicates
  if (cfg.panelMessageId) {
    const old = await channel.messages.fetch(cfg.panelMessageId).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }

  const msg = await channel.send({
    embeds: [panelEmbed(guild.id, client, 0)],
    components: panelComponents(guild.id, 0),
  });
  cfg.panelChannelId = channel.id;
  cfg.panelMessageId = msg.id;
  saveGuild(guild.id, cfg);
  return channel;
}

const commands = {
  ping: {
    description: 'Check bot latency',
    async execute(message) {
      const sent = await message.reply({
        embeds: [baseEmbed(message.guild.id, { title: 'Pong', description: 'Measuring...' })],
      });
      const latency = sent.createdTimestamp - message.createdTimestamp;
      await sent.edit({
        embeds: [
          successEmbed(
            message.guild.id,
            'Pong',
            `→ __**WS:**__ ${message.client.ws.ping}ms\n→ __**Roundtrip:**__ ${latency}ms`
          ),
        ],
      });
    },
  },

  help: {
    description: 'Paginated command guide',
    async execute(message) {
      await message.reply({
        embeds: [helpEmbed(message.guild.id, 0)],
        components: helpNav(0, HELP_PAGES.length, message.guild.id),
      });
    },
  },

  setup: {
    description: 'Create the Ougi control panel',
    mod: true,
    async execute(message) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const channel = await createPanel(message.guild, message.client);
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Setup Complete', `Control panel ready in ${channel}`)],
      });
    },
  },

  panel: {
    description: 'Show / refresh the control panel',
    mod: true,
    async execute(message) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Denied', 'Administrator required.')],
        });
      }
      const channel = await createPanel(message.guild, message.client);
      return message.reply({
        embeds: [
          successEmbed(
            message.guild.id,
            'Control Panel',
            `Panel ready in ${channel}\n→ Category: \`${PANEL_CATEGORY_NAME}\`\n→ Channel: \`${PANEL_CHANNEL_NAME}\``
          ),
        ],
      });
    },
  },

  invite: {
    description: 'Get the private invite link (owner / approved use only)',
    async execute(message) {
      const { buildBotInviteUrl } = require('../utils/invite');
      const { isPrivateMode, loadAccess, allowGuild } = require('../utils/access');
      const url = buildBotInviteUrl(message.client.user.id);
      const application = await message.client.application.fetch().catch(() => null);
      const isOwner =
        application?.owner?.id === message.author.id ||
        application?.owner?.ownerId === message.author.id ||
        loadAccess().ownerDiscordIds.includes(message.author.id);

      if (isPrivateMode() && !isOwner && !memberHasAdmin(message.member)) {
        return message.reply({
          embeds: [
            errorEmbed(
              message.guild.id,
              'Private Bot',
              'Ougi is invite-only. Request access on the website — there is no public add link.'
            ),
          ],
        });
      }

      // Keep current server approved when owner refreshes invite
      if (message.guild) allowGuild(message.guild.id);

      return message.reply({
        embeds: [
          baseEmbed(message.guild.id, {
            title: 'Private Invite',
            description:
              (isPrivateMode()
                ? '**Private mode is ON.** Only whitelisted servers can keep Ougi.\n\n'
                : '') +
              `Invite link (do not post publicly):\n${url}\n\n` +
              `After they authorize, approve their server with:\n\`access allow <serverId>\`\n` +
              `Or approve from Ougi Host → Access.\n\n` +
              'Tip: In Discord Developer Portal → Bot, turn **Public Bot OFF** for extra lock-down.',
          }),
        ],
      });
    },
  },

  access: {
    description: 'Manage private server access',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Administrator required.')] });
      }
      const {
        loadAccess,
        allowGuild,
        revokeGuild,
        setPrivateMode,
        createLicense,
        redeemLicense,
        setRequestStatus,
      } = require('../utils/access');
      const sub = (args[0] || 'status').toLowerCase();
      const cfg = loadAccess();

      if (sub === 'on') {
        setPrivateMode(true);
        allowGuild(message.guild.id);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Private Mode', 'ON — unauthorized servers will be left.')],
        });
      }
      if (sub === 'off') {
        setPrivateMode(false);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Private Mode', 'OFF — anyone with the invite can add Ougi.')],
        });
      }
      if (sub === 'allow' && args[1]) {
        allowGuild(args[1]);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Access', `Allowed server \`${args[1]}\`.`)],
        });
      }
      if (sub === 'revoke' && args[1]) {
        revokeGuild(args[1]);
        const g = message.client.guilds.cache.get(args[1]);
        if (g) await g.leave().catch(() => {});
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Access', `Revoked \`${args[1]}\`.`)],
        });
      }
      if (sub === 'license') {
        const lic = createLicense(args.slice(1).join(' ') || message.guild.name);
        return message.reply({
          embeds: [
            successEmbed(
              message.guild.id,
              'License Created',
              `Key: \`${lic.key}\`\nCustomer runs: \`access redeem ${lic.key}\` in their server after invite.`
            ),
          ],
        });
      }
      if (sub === 'redeem' && args[1]) {
        try {
          redeemLicense(args[1], message.guild.id);
          return message.reply({
            embeds: [successEmbed(message.guild.id, 'License', 'This server is now approved for Ougi.')],
          });
        } catch (err) {
          return message.reply({ embeds: [errorEmbed(message.guild.id, 'License', err.message)] });
        }
      }
      if (sub === 'approve' && args[1]) {
        try {
          setRequestStatus(args[1], 'approved', args[2] || null);
          return message.reply({
            embeds: [
              successEmbed(
                message.guild.id,
                'Request Approved',
                args[2]
                  ? `Request \`${args[1]}\` approved + server \`${args[2]}\` allowed.`
                  : `Request \`${args[1]}\` marked approved. Also run \`access allow <serverId>\` after they invite.`
              ),
            ],
          });
        } catch (err) {
          return message.reply({ embeds: [errorEmbed(message.guild.id, 'Access', err.message)] });
        }
      }

      const pending = (cfg.requests || []).filter((r) => r.status === 'pending').slice(0, 8);
      const pendingText = pending.length
        ? pending.map((r) => `• \`${r.id}\` ${r.discord} — ${r.server || 'n/a'}`).join('\n')
        : '_No pending website requests._';

      return message.reply({
        embeds: [
          baseEmbed(message.guild.id, {
            title: 'Ougi Access',
            description:
              `Private mode: **${cfg.privateMode ? 'ON' : 'OFF'}**\n` +
              `Allowed servers: **${cfg.allowedGuildIds.length}**\n` +
              `\`${cfg.allowedGuildIds.slice(0, 10).join('`, `') || 'none'}\`\n\n` +
              `**Pending requests**\n${pendingText}\n\n` +
              'Commands: `access on|off` · `access allow <id>` · `access revoke <id>`\n' +
              '`access license` · `access redeem <key>` · `access approve <requestId> [guildId]`',
          }),
        ],
      });
    },
  },

  prefix: {
    description: 'Set command prefix',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const { setGuildPrefix, getGuildPrefix } = require('../utils/store');
      const nextRaw = args.join(' ').trim() || args[0];
      if (!nextRaw) {
        return message.reply({
          embeds: [
            baseEmbed(message.guild.id, {
              title: 'Prefix',
              description: `Current prefix: \`${getGuildPrefix(message.guild.id)}\`\n\nUsage: \`prefix <symbol>\`\nExamples: \`prefix !\` · \`prefix ?\` · \`prefix .\``,
            }),
          ],
        });
      }
      const next = setGuildPrefix(message.guild.id, nextRaw);
      if (!next) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Prefix', 'Provide a prefix up to 5 characters.')],
        });
      }
      return message.reply({
        embeds: [
          successEmbed(
            message.guild.id,
            'Prefix Updated',
            `New prefix: \`${next}\`\nTry: \`${next}help\` · \`${next}ping\` · \`${next}panel\``
          ),
        ],
      });
    },
  },

  theme: {
    description: 'Set theme color',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const key = (args[0] || '').toLowerCase();
      if (!THEMES[key]) {
        return message.reply({
          embeds: [
            errorEmbed(
              message.guild.id,
              'Theme',
              'Choose: red, black, white, pink, blue, purple, green, orange, cyan, gold'
            ),
          ],
        });
      }
      const cfg = loadGuild(message.guild.id);
      cfg.theme = key;
      saveGuild(message.guild.id, cfg);
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Theme Updated', `Accent set to **${THEMES[key].label}**`)],
      });
    },
  },

  botname: {
    description: 'Rename the bot',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const name = args.join(' ').trim();
      if (!name || name.length > 32) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Bot Name', 'Provide a name (1–32 characters).')],
        });
      }
      try {
        await message.client.user.setUsername(name);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Bot Renamed', `My name is now **${name}**`)],
        });
      } catch (err) {
        return message.reply({
          embeds: [
            errorEmbed(
              message.guild.id,
              'Bot Name',
              'Discord rate-limits username changes. Try again later.\n' + String(err.message || err)
            ),
          ],
        });
      }
    },
  },

  avatar: {
    description: 'Set bot avatar from attachment or URL',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const { setAvatarFromUrl, setAvatarFromAttachment } = require('../features/profile');
      const attachment = message.attachments.find((a) => a.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.name || ''));
      const url = args[0];
      if (!attachment && !url) {
        return message.reply({
          embeds: [
            errorEmbed(
              message.guild.id,
              'Avatar',
              'Attach an image or provide a URL.\nExample: `avatar` + photo, or `avatar https://...'
            ),
          ],
        });
      }
      try {
        if (attachment) await setAvatarFromAttachment(message.client, attachment);
        else await setAvatarFromUrl(message.client, url);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Avatar Updated', 'Bot profile picture changed.')],
        });
      } catch (err) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Avatar', String(err.message || err))],
        });
      }
    },
  },

  interfaces: {
    description: 'Browse interface color templates',
    mod: true,
    async execute(message) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const { singleInterfacePayload } = require('../features/interfaces');
      const payload = singleInterfacePayload(message.guild.id, 0);
      return message.reply(payload);
    },
  },

  ban: {
    description: 'Ban a member',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member) || !message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Ban permission required.')] });
      }
      const target = await resolveMember(message.guild, args[0]);
      if (!target) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Ban', 'Member not found.')] });
      }
      const reason = args.slice(1).join(' ') || 'No reason provided';
      await target.ban({ reason: `${message.author.tag}: ${reason}` });
      const { addCase, sendModLog } = require('../features/moderation');
      const row = addCase(message.guild.id, {
        type: 'ban',
        userId: target.id,
        modId: message.author.id,
        reason,
      });
      await sendModLog(message.guild, {
        action: 'Ban',
        userId: target.id,
        userTag: target.user.tag,
        modId: message.author.id,
        reason,
        caseId: row.id,
      });
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Banned', `→ **${target.user.tag}**\n→ ${reason}`)],
      });
    },
  },

  kick: {
    description: 'Kick a member',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member) || !message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Kick permission required.')] });
      }
      const target = await resolveMember(message.guild, args[0]);
      if (!target) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Kick', 'Member not found.')] });
      }
      const reason = args.slice(1).join(' ') || 'No reason provided';
      await target.kick(`${message.author.tag}: ${reason}`);
      const { addCase, sendModLog } = require('../features/moderation');
      const row = addCase(message.guild.id, {
        type: 'kick',
        userId: target.id,
        modId: message.author.id,
        reason,
      });
      await sendModLog(message.guild, {
        action: 'Kick',
        userId: target.id,
        userTag: target.user.tag,
        modId: message.author.id,
        reason,
        caseId: row.id,
      });
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Kicked', `→ **${target.user.tag}**\n→ ${reason}`)],
      });
    },
  },

  mute: {
    description: 'Mute / timeout a member',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod permission required.')] });
      }
      const target = await resolveMember(message.guild, args[0]);
      if (!target) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Mute', 'Member not found.')] });
      }
      const duration = parseDuration(args[1]);
      const reason = args.slice(2).join(' ') || args.slice(1).join(' ') || 'No reason provided';
      try {
        await target.timeout(duration, `${message.author.tag}: ${reason}`);
      } catch {
        const role = await ensureMutedRole(message.guild, store);
        await target.roles.add(role, reason);
      }
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Muted', `→ **${target.user.tag}**\n→ ${reason}`)],
      });
    },
  },

  unmute: {
    description: 'Unmute a member',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod permission required.')] });
      }
      const target = await resolveMember(message.guild, args[0]);
      if (!target) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Unmute', 'Member not found.')] });
      }
      await target.timeout(null).catch(() => {});
      const cfg = loadGuild(message.guild.id);
      if (cfg.mutedRoleId && target.roles.cache.has(cfg.mutedRoleId)) {
        await target.roles.remove(cfg.mutedRoleId).catch(() => {});
      }
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Unmuted', `→ **${target.user.tag}**`)],
      });
    },
  },

  nick: {
    description: 'Change a nickname',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod permission required.')] });
      }
      const target = await resolveMember(message.guild, args[0]);
      if (!target) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Nick', 'Member not found.')] });
      }
      const nick = args.slice(1).join(' ');
      if (!nick) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Nick', 'Provide a nickname.')] });
      }
      await target.setNickname(nick.slice(0, 32));
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Nickname Updated', `→ **${target.user.tag}** is now **${nick.slice(0, 32)}**`)],
      });
    },
  },

  lock: {
    description: 'Lock this channel (or pick one from the panel)',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod permission required.')] });
      }
      const { lockChannelPick } = require('../ui/components');
      const { target, needPick } = await resolveChannelArg(message, args);
      if (needPick) {
        return message.reply({
          embeds: [
            baseEmbed(message.guild.id, {
              title: 'Lock Channel',
              description: 'Select a channel, or run `lock #general`.',
            }),
          ],
          components: [lockChannelPick('lock')],
        });
      }
      await lockChannel(target);
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Locked', `${target} is now locked.`)],
      });
    },
  },

  unlock: {
    description: 'Unlock this channel (or pick one from the panel)',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod permission required.')] });
      }
      const { lockChannelPick } = require('../ui/components');
      const { target, needPick } = await resolveChannelArg(message, args);
      if (needPick) {
        return message.reply({
          embeds: [
            baseEmbed(message.guild.id, {
              title: 'Unlock Channel',
              description: 'Select a channel, or run `unlock #general`.',
            }),
          ],
          components: [lockChannelPick('unlock')],
        });
      }
      await unlockChannel(target);
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Unlocked', `${target} is now unlocked.`)],
      });
    },
  },

  nuke: {
    description: 'Wipe this channel (or pick one from the panel)',
    mod: true,
    async execute(message, args) {
      if (
        !memberHasMod(message.member) ||
        !message.member.permissions.has(PermissionFlagsBits.ManageChannels)
      ) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Denied', 'Manage Channels permission required.')],
        });
      }
      const { nukeChannelPick } = require('../ui/components');
      const { target, needPick } = await resolveChannelArg(message, args);
      if (needPick) {
        return message.reply({
          embeds: [
            baseEmbed(message.guild.id, {
              title: 'Nuke Channel',
              description: 'Select a channel, or run `nuke #general`.',
            }),
          ],
          components: [nukeChannelPick()],
        });
      }
      if (!target.isTextBased() || target.isDMBased() || target.isThread()) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Nuke', 'Run this in a normal text channel.')],
        });
      }
      await runNuke(message.guild, target, message.author.tag);
    },
  },

  inviteperms: {
    description: 'Toggle invite creation for @everyone',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const mode = (args[0] || '').toLowerCase();
      const cfg = loadGuild(message.guild.id);
      const disable = mode === 'off' || mode === 'disable' || (!mode && !cfg.invitesDisabled);
      await setInvitesDisabled(message.guild, disable);
      cfg.invitesDisabled = disable;
      saveGuild(message.guild.id, cfg);
      return message.reply({
        embeds: [
          successEmbed(
            message.guild.id,
            'Invite Perms',
            disable ? 'Members can no longer create invites.' : 'Members can create invites again.'
          ),
        ],
      });
    },
  },

  announce: {
    description: 'Send an announcement',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod permission required.')] });
      }
      const channelMention = message.mentions.channels.first();
      let target = channelMention || null;
      let textArgs = args;
      if (!target && args[0]) {
        target = await resolveChannel(message.guild, args[0]);
        if (target) textArgs = args.slice(1);
      }
      const text = textArgs.join(' ');
      if (!target) target = message.channel;
      if (!text && message.attachments.size === 0) {
        return message.reply({
          embeds: [
            errorEmbed(
              message.guild.id,
              'Announce',
              'Usage: `announce [#channel] <message>` — try `announce #general hello` or attach images.'
            ),
          ],
        });
      }
      const embed = baseEmbed(message.guild.id, {
        title: 'ANNOUNCEMENT',
        description: text || undefined,
        footer: `Posted by ${message.author.tag}`,
      });
      const files = [...message.attachments.values()].map((a) => a.url);
      if (files[0]) embed.setImage(files[0]);
      await target.send({ embeds: [embed], files: files.slice(1).map((url) => ({ attachment: url })) });
      if (target.id !== message.channel.id) {
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Announced', `Sent to ${target}`)],
        });
      }
    },
  },

  giveaway: {
    description: 'Start a reaction giveaway',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod permission required.')],
        });
      }
      const parsed = parseGiveawayArgs(args.join(' '));
      if (parsed.error) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Giveaway', parsed.error)],
        });
      }
      try {
        const { message: gmsg } = await startGiveaway(message.client, {
          guild: message.guild,
          channel: message.channel,
          host: message.author,
          prize: parsed.prize,
          durationMs: parsed.durationMs,
          winners: parsed.winners,
          maxEntries: parsed.maxEntries,
          requireServer: parsed.requireServer,
        });
        return message.reply({
          embeds: [
            successEmbed(
              message.guild.id,
              'Giveaway Started',
              `Posted in ${message.channel} → [jump](${gmsg.url})`
            ),
          ],
        });
      } catch (err) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Giveaway', String(err.message || err))],
        });
      }
    },
  },

  gend: {
    description: 'End a giveaway early',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod permission required.')],
        });
      }
      const messageId = args[0] || (await findLatestGiveawayId(message.guild.id, message.channel.id));
      if (!messageId) {
        return message.reply({
          embeds: [
            errorEmbed(
              message.guild.id,
              'Giveaway',
              'Provide a giveaway message ID, or run this in a channel with an active giveaway.'
            ),
          ],
        });
      }
      const result = await endGiveaway(message.client, message.guild.id, messageId);
      if (!result) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Giveaway', 'Giveaway not found.')],
        });
      }
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Giveaway', 'Ended and winners drawn.')],
      });
    },
  },

  greroll: {
    description: 'Reroll giveaway winners',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod permission required.')],
        });
      }
      const messageId = args[0] || (await findLatestEndedGiveawayId(message.guild.id, message.channel.id));
      if (!messageId) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Giveaway', 'Provide an ended giveaway message ID.')],
        });
      }
      const g = getGiveaway(message.guild.id, messageId);
      if (!g) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Giveaway', 'Giveaway not found.')],
        });
      }
      const result = await endGiveaway(message.client, message.guild.id, messageId, { reroll: true });
      return message.reply({
        embeds: [
          successEmbed(
            message.guild.id,
            'Rerolled',
            result?.winnerIds?.length
              ? `New winner(s): ${result.winnerIds.map((id) => `<@${id}>`).join(', ')}`
              : 'No valid entries to reroll.'
          ),
        ],
      });
    },
  },

  event: {
    description: 'Create a scheduled event (use now to start immediately)',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const { parseEventStart } = require('../utils/events');
      const {
        GuildScheduledEventEntityType,
        GuildScheduledEventPrivacyLevel,
      } = require('discord.js');
      const raw = args.join(' ');
      const parts = raw.split('|').map((p) => p.trim());
      if (parts.length < 2) {
        return message.reply({
          embeds: [
            errorEmbed(
              message.guild.id,
              'Event',
              'Usage: `event Title | Description | now|hours | location`\n' +
                'Examples:\n' +
                '`event Game Night | Ranked customs | now | Voice Lounge`\n' +
                '`event Meetup | Hang out | 24 | Lobby`'
            ),
          ],
        });
      }
      const [title, description, whenRaw = '24', location = 'Server Event'] = parts;
      const { start, label } = parseEventStart(whenRaw);
      const end = new Date(start.getTime() + 2 * 3600 * 1000);
      const event = await message.guild.scheduledEvents.create({
        name: title.slice(0, 100),
        description: description.slice(0, 1000),
        scheduledStartTime: start,
        scheduledEndTime: end,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
        entityMetadata: { location: location.slice(0, 100) },
      });
      return message.reply({
        embeds: [
          successEmbed(
            message.guild.id,
            'Event Created',
            `→ __**${event.name}**__\n→ Starts <t:${Math.floor(start.getTime() / 1000)}:F> (${label})\n→ ${location}`
          ),
        ],
      });
    },
  },

  welcome: {
    description: 'Configure welcome messages',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const cfg = loadGuild(message.guild.id);
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'off') {
        cfg.welcome.enabled = false;
        saveGuild(message.guild.id, cfg);
        return message.reply({ embeds: [successEmbed(message.guild.id, 'Welcome', 'Welcome messages disabled.')] });
      }
      if (sub === 'on') {
        cfg.welcome.enabled = true;
        const mentioned = message.mentions.channels.first();
        let channel = mentioned || null;
        let msgParts = args.slice(1);
        if (!channel && args[1]) {
          channel = await resolveChannel(message.guild, args[1]);
          if (channel) msgParts = args.slice(2);
        }
        cfg.welcome.channelId = channel?.id || message.channel.id;
        const msg = msgParts.join(' ').replace(/<#\d+>/g, '').trim();
        if (msg) cfg.welcome.message = msg;
        saveGuild(message.guild.id, cfg);
        return message.reply({
          embeds: [
            successEmbed(
              message.guild.id,
              'Welcome',
              `Enabled in <#${cfg.welcome.channelId}>\nMessage: ${cfg.welcome.message}`
            ),
          ],
        });
      }
      return message.reply({
        embeds: [
          baseEmbed(message.guild.id, {
            title: 'Welcome Setup',
            description:
              '→ `welcome on [#channel] [message]` — enable\n' +
              '→ Examples: `welcome on #welcome Hello {user}!`\n' +
              '→ `welcome off` — disable\n' +
              'Placeholders: `{user}` `{server}` `{count}`',
          }),
        ],
      });
    },
  },

  jtc: {
    description: 'Setup join-to-create voice',
    mod: true,
    async execute(message) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const { hub } = await setupJtc(message.guild);
      return message.reply({
        embeds: [
          successEmbed(
            message.guild.id,
            'Join-to-Create Ready',
            `→ Join ${hub}\n→ Your **custom status** becomes the call name\n→ Tip: set status to the call name you want (Presence Intent must be on)`
          ),
        ],
      });
    },
  },

  invites: {
    description: 'Invite tracker stats / leaderboard',
    async execute(message, args) {
      const {
        ensureInvites,
        getUserStats,
        statsEmbed,
        leaderboard,
        trackerMenuEmbed,
      } = require('../features/invites');
      const sub = (args[0] || '').toLowerCase();
      const cfg = ensureInvites(loadGuild(message.guild.id));

      if (sub === 'top' || sub === 'lb' || sub === 'leaderboard') {
        const top = leaderboard(message.guild.id, 15);
        const body =
          top.length === 0
            ? '_No data yet._'
            : top
                .map(
                  (r, i) =>
                    `→ **#${i + 1}** <@${r.id}> — valid **${r.valid}** · joins ${r.joins} · left ${r.left} · fake ${r.fake}`
                )
                .join('\n');
        return message.reply({
          embeds: [baseEmbed(message.guild.id, { title: 'Invite Leaderboard', description: body })],
        });
      }

      if (sub === 'on' || sub === 'off') {
        if (!memberHasAdmin(message.member)) {
          return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
        }
        cfg.invites.enabled = sub === 'on';
        saveGuild(message.guild.id, cfg);
        return message.reply({
          embeds: [
            successEmbed(message.guild.id, 'Invite Tracker', `Tracker ${cfg.invites.enabled ? 'ON' : 'OFF'}`),
          ],
        });
      }

      if (sub === 'log') {
        if (!memberHasAdmin(message.member)) {
          return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
        }
        const ch = message.mentions.channels.first() || message.channel;
        cfg.invites.logChannelId = ch.id;
        saveGuild(message.guild.id, cfg);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Invite Logs', `Logging to ${ch}`)],
        });
      }

      const target =
        message.mentions.users.first() ||
        (args[0] ? (await resolveMember(message.guild, args[0]))?.user : null) ||
        message.author;
      const stats = getUserStats(cfg, target.id);
      saveGuild(message.guild.id, cfg);
      if (!args[0] && !message.mentions.users.size) {
        return message.reply({ embeds: [trackerMenuEmbed(message.guild.id)] });
      }
      return message.reply({ embeds: [statsEmbed(message.guild.id, target, stats)] });
    },
  },

  automod: {
    description: 'Toggle automod filters',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const cfg = loadGuild(message.guild.id);
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'on') cfg.automod.enabled = true;
      else if (sub === 'off') cfg.automod.enabled = false;
      else if (['spam', 'invites', 'links'].includes(sub)) {
        const map = { spam: 'antiSpam', invites: 'antiInvite', links: 'antiLinks' };
        cfg.automod[map[sub]] = !cfg.automod[map[sub]];
      } else if (sub === 'word' && args[1]) {
        const word = args.slice(1).join(' ').toLowerCase();
        if (!cfg.automod.badWords.includes(word)) cfg.automod.badWords.push(word);
      } else {
        return message.reply({
          embeds: [
            baseEmbed(message.guild.id, {
              title: 'AutoMod',
              description: rulesStyleList([
                { label: 'Status', text: cfg.automod.enabled ? 'ON' : 'OFF' },
                { label: 'Spam', text: String(cfg.automod.antiSpam) },
                { label: 'Invites', text: String(cfg.automod.antiInvite) },
                { label: 'Links', text: String(cfg.automod.antiLinks) },
                { label: 'Words', text: cfg.automod.badWords.join(', ') || 'none' },
              ]) + '\n\nUsage: `automod on|off|spam|invites|links|word <text>`',
            }),
          ],
        });
      }
      saveGuild(message.guild.id, cfg);
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'AutoMod Updated', `Enabled: **${cfg.automod.enabled}**`)],
      });
    },
  },

  template: {
    description: 'Preview / apply templates',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const kind = (args[0] || '').toLowerCase();
      const id = args[1];

      if (kind === 'end' || kind === 'fixend' || kind === 'footer') {
        const result = await ensureEmptyEndCategory(message.guild);
        const moved =
          result.movedChannels.length > 0
            ? `\nMoved out from under end: ${result.movedChannels.map((n) => `\`${n}\``).join(', ')}`
            : '\nNo channels were under the end category.';
        return message.reply({
          embeds: [
            successEmbed(
              message.guild.id,
              'End Closer Fixed',
              `Empty **${result.endCategory}** is at the bottom.${moved}\n\nStaff uses \`│───\` so channels sit above the end, not under it.`
            ),
          ],
        });
      }

      if (kind === 'server' && id) {
        const wipeChannels = (args[2] || '').toLowerCase() === 'wipe';
        if (wipeChannels) {
          await message.reply({
            embeds: [
              baseEmbed(message.guild.id, {
                title: 'Wiping Channels',
                description: 'Deleting all channels, then building the template...',
              }),
            ],
          });
        }
        const result = await applyServerTemplate(message.guild, id, null, { wipeChannels });
        if (wipeChannels) {
          try {
            await createPanel(message.guild, message.client);
          } catch {
            /* ignore */
          }
        }
        return message.channel.send({
          embeds: [
            successEmbed(
              message.guild.id,
              'Server Template Applied',
              `${wipeChannels ? 'Wiped channels, then applied' : 'Applied'} **${result.template.name}**\n\`\`\`\n${result.created.join('\n')}\n\`\`\``
            ),
          ],
        });
      }
      if (kind === 'roles' && id) {
        const result = await applyRoleTemplate(message.guild, id);
        return message.reply({
          embeds: [
            successEmbed(
              message.guild.id,
              'Role Template Applied',
              `**${result.template.name}**\n${result.created.map((r) => `→ ${r}`).join('\n')}`
            ),
          ],
        });
      }
      const serverList = SERVER_TEMPLATES.map((t) => `→ __**${t.id}**__ — ${t.name}`).join('\n');
      const roleList = ROLE_TEMPLATES.map((t) => `→ __**${t.id}**__ — ${t.name}`).join('\n');
      return message.reply({
        embeds: [
          baseEmbed(message.guild.id, {
            title: 'Templates',
            description:
              `__**Server templates**__\n${serverList}\n\n__**Role templates**__\n${roleList}\n\n` +
              'Apply: `template server community` · `template server community wipe` · `template roles staff-ladder`\n' +
              'Fix empty end closer: `template end`\n' +
              'Or use the **Templates** button — choose **Apply** or **Wipe + Apply**.',
          }),
        ],
      });
    },
  },

  ticketpanel: {
    description: 'Create a ticket panel',
    mod: true,
    async execute(message) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      // Prefix flow: open modal via a button prompt isn't possible without interaction.
      // Collect via simple args prompt message — tell them to use panel for full UI.
      return message.reply({
        embeds: [
          baseEmbed(message.guild.id, {
            title: 'Ticket Panel',
            description:
              'Use the **Tickets** button on the control panel to build a custom panel ' +
              '(label, description, channel prefix, emoji).\n\n' +
              'Quick create: `ticketpanel quick <label> | <prefix> | <description>`',
          }),
        ],
      });
    },
  },

  'ticketpanel-quick': {
    description: 'internal',
    skip: true,
  },

  ticketclose: {
    description: 'Close current ticket',
    async execute(message) {
      const { closeTicket } = require('../features/tickets');
      // fake interaction-like
      const cfg = loadGuild(message.guild.id);
      if (!cfg.tickets.open?.[message.channel.id]) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Ticket', 'Not a ticket channel.')],
        });
      }
      await message.reply({
        embeds: [baseEmbed(message.guild.id, { title: 'Closing Ticket', description: 'Deleting in 3 seconds...' })],
      });
      delete cfg.tickets.open[message.channel.id];
      saveGuild(message.guild.id, cfg);
      setTimeout(() => message.channel.delete('Ticket closed').catch(() => {}), 3000);
    },
  },

  serverinfo: {
    description: 'Server info card',
    async execute(message) {
      const g = message.guild;
      return message.reply({
        embeds: [
          baseEmbed(g.id, {
            title: g.name,
            thumbnail: g.iconURL({ size: 256 }),
            description: rulesStyleList([
              { label: 'Members', text: String(g.memberCount) },
              { label: 'Channels', text: String(g.channels.cache.size) },
              { label: 'Roles', text: String(g.roles.cache.size) },
              { label: 'Owner', text: `<@${g.ownerId}>` },
              { label: 'Created', text: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>` },
            ]),
          }),
        ],
      });
    },
  },

  userinfo: {
    description: 'User info card',
    async execute(message, args) {
      const target =
        (await resolveMember(message.guild, args[0])) ||
        message.mentions.members.first() ||
        message.member;
      return message.reply({
        embeds: [
          baseEmbed(message.guild.id, {
            title: target.user.tag,
            thumbnail: target.user.displayAvatarURL({ size: 256 }),
            description: rulesStyleList([
              { label: 'ID', text: target.id },
              { label: 'Nickname', text: target.displayName },
              { label: 'Joined', text: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>` },
              { label: 'Roles', text: String(target.roles.cache.size - 1) },
            ]),
          }),
        ],
      });
    },
  },
};

// Alias for quick ticket panel from prefix
commands.ticketpanel.execute = async function ticketPanelExec(message, args) {
  if (!memberHasAdmin(message.member)) {
    return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
  }
  if ((args[0] || '').toLowerCase() === 'quick') {
    const raw = args.slice(1).join(' ');
    const [label, prefix, styleRaw, ...descParts] = raw.includes('|')
      ? raw.split('|').map((s) => s.trim())
      : [raw, 'support', 'dot'];
    // support both: Label | prefix | desc   AND   Label | prefix | style | desc
    const { parseStyle, formatTicketChannelName } = require('../features/tickets');
    let style = 'dot';
    let description = 'Click below to open a ticket.';
    if (['dot', 'pipe', 'dash'].includes((styleRaw || '').toLowerCase())) {
      style = parseStyle(styleRaw);
      description = descParts.join('|') || description;
    } else {
      description = [styleRaw, ...descParts].filter(Boolean).join('|') || description;
    }
    if (!label || !prefix) {
      return message.reply({
        embeds: [
          errorEmbed(
            message.guild.id,
            'Ticket Panel',
            'Usage: `ticketpanel quick Label | prefix | style | description`\nStyle: `dot` `pipe` `dash`'
          ),
        ],
      });
    }
    const cfg = loadGuild(message.guild.id);
    const id = `p${Date.now()}`;
    const panel = {
      id,
      label,
      prefix: prefix.toLowerCase().replace(/\s+/g, '-'),
      description,
      emoji: '🎫',
      style,
    };
    cfg.tickets.panels[id] = panel;
    saveGuild(message.guild.id, cfg);
    await postTicketPanel(message.channel, message.guild.id, panel);
    return message.reply({
      embeds: [
        successEmbed(
          message.guild.id,
          'Ticket Panel',
          `Channels will look like \`${formatTicketChannelName(panel, '0001')}\``
        ),
      ],
    });
  }
  return message.reply({
    embeds: [
      baseEmbed(message.guild.id, {
        title: 'Ticket Panel',
        description:
          '→ Use **Tickets** on the control panel for the full builder\n' +
          '→ Or: `ticketpanel quick Support | support | dot | Click to open a ticket`\n' +
          '→ Styles: **dot** `🎫・support-0001` · **pipe** `🎫｜support-0001` · **dash** `🎫-support-0001`',
      }),
    ],
  });
};

module.exports = { commands, createPanel, helpEmbed, HELP_PAGES, runNuke };

// Aliases
commands.gstart = commands.giveaway;

const { extraCommands } = require('./extra');
Object.assign(commands, extraCommands);
