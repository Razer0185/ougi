const {
  PermissionFlagsBits,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
} = require('discord.js');
const store = require('../utils/store');
const { loadGuild, saveGuild } = store;
const { baseEmbed, successEmbed, errorEmbed, panelEmbed, rulesStyleList } = require('../utils/embeds');
const {
  memberHasMod,
  memberHasAdmin,
  ensureMutedRole,
  lockChannel,
  unlockChannel,
  setInvitesDisabled,
  parseDuration,
} = require('../utils/helpers');
const { parseEventStart } = require('../utils/events');
const {
  userPickRow,
  themeSelect,
  helpNav,
  modal,
  channelPick,
  lockChannelPick,
  templateSelect,
  templateHomePayload,
  templatePickPayload,
  templateHomeComponents,
  templateApplyComponents,
  panelComponents,
} = require('../ui/components');
const { helpEmbed, getHelpPages, createPanel } = require('../commands');
const { THEMES } = require('../utils/theme');
const { ticketCreateModal, postTicketPanel, openTicket, closeTicket, claimTicket } = require('../features/tickets');
const { handleVerifyButton, setupVerify } = require('../features/verify');
const {
  SERVER_TEMPLATES,
  ROLE_TEMPLATES,
  applyServerTemplate,
  applyRoleTemplate,
  getServerTemplate,
  getRoleTemplate,
  templatePreviewEmbed,
} = require('../features/templates');
const { setupJtc } = require('../features/jtc');
const {
  allInterfacesPayload,
  singleInterfacePayload,
  INTERFACE_TEMPLATES,
} = require('../features/interfaces');
const {
  profileComponents,
  nameModal,
  urlModal,
  armUpload,
  setAvatarFromUrl,
  setBannerFromUrl,
} = require('../features/profile');
const {
  channelPickRow,
  channelSettingsPayload,
  handleChannelEditButton,
  handleChannelEditModal,
} = require('../features/channels');
const {
  ensureInvites,
  trackerMenuEmbed,
  statsEmbed,
  getUserStats,
  leaderboard,
} = require('../features/invites');

const pendingAnnounce = new Map(); // userId -> channelId

async function requireMod(interaction) {
  if (!memberHasMod(interaction.member)) {
    await interaction.reply({
      embeds: [errorEmbed(interaction.guild.id, 'Denied', 'Moderator permission required.')],
      ephemeral: true,
    });
    return false;
  }
  return true;
}

async function requireAdmin(interaction) {
  if (!memberHasAdmin(interaction.member)) {
    await interaction.reply({
      embeds: [errorEmbed(interaction.guild.id, 'Denied', 'Administrator required.')],
      ephemeral: true,
    });
    return false;
  }
  return true;
}

async function handleInteraction(interaction) {
  try {
    if (interaction.isButton()) return handleButton(interaction);
    if (interaction.isUserSelectMenu()) return handleUserSelect(interaction);
    if (interaction.isStringSelectMenu()) return handleStringSelect(interaction);
    if (interaction.isChannelSelectMenu()) return handleChannelSelect(interaction);
    if (interaction.isRoleSelectMenu()) return handleRoleSelect(interaction);
    if (interaction.isModalSubmit()) return handleModal(interaction);
  } catch (err) {
    console.error('Interaction error:', err);
    const payload = {
      embeds: [errorEmbed(interaction.guildId, 'Error', 'Something went wrong running that action.')],
      ephemeral: true,
    };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
}

async function handleButton(interaction) {
  const id = interaction.customId;

  if (id.startsWith('aibuild:')) {
    const { isFreeEdition, loadConfig } = require('../utils/edition');
    if (isFreeEdition()) {
      const promo = loadConfig().promo || {};
      return interaction.reply({
        ephemeral: true,
        embeds: [
          require('../utils/embeds').errorEmbed(
            interaction.guild.id,
            'Ougi Free',
            `AI channel build is Pro-only.\n\nDiscord: ${promo.discordInvite || '—'}\nBuy: ${promo.productUrl || '—'}`
          ),
        ],
      });
    }
    const { handleAiBuildButton } = require('../features/ai');
    return handleAiBuildButton(interaction);
  }

  if (id.startsWith('template:menu:')) {
    if (!(await requireAdmin(interaction))) return;
    const { isFreeEdition } = require('../utils/edition');
    const sub = id.split(':')[2];
    if (sub === 'roles' && isFreeEdition()) {
      return interaction.update(templateHomePayload(interaction.guild.id));
    }
    if (sub === 'home') {
      return interaction.update(templateHomePayload(interaction.guild.id));
    }
    if (sub === 'server' || sub === 'roles') {
      return interaction.update(templatePickPayload(interaction.guild.id, sub));
    }
    if (sub === 'end') {
      const { ensureEmptyEndCategory } = require('../features/templates');
      await interaction.deferUpdate().catch(() => {});
      try {
        const result = await ensureEmptyEndCategory(interaction.guild);
        const moved =
          result.movedChannels.length > 0
            ? `\nMoved out from under end: ${result.movedChannels.map((n) => `\`${n}\``).join(', ')}`
            : '\nNo channels were under the end category.';
        return interaction.followUp({
          embeds: [
            successEmbed(
              interaction.guild.id,
              'End Closer Fixed',
              `Empty **${result.endCategory}** is at the bottom.${moved}`
            ),
          ],
          ephemeral: true,
        });
      } catch (err) {
        return interaction.followUp({
          embeds: [errorEmbed(interaction.guild.id, 'End Closer', err.message || 'Failed.')],
          ephemeral: true,
        });
      }
    }
  }

  if (id === 'help:noop') {
    return interaction.deferUpdate();
  }
  if (id.startsWith('help:prev:') || id.startsWith('help:next:')) {
    const parts = id.split(':');
    const dir = parts[1];
    const page = Number(parts[2]);
    const next = dir === 'next' ? page + 1 : page - 1;
    const pages = getHelpPages();
    if (next < 0 || next >= pages.length) return interaction.deferUpdate();
    return interaction.update({
      embeds: [helpEmbed(interaction.guild.id, next)],
      components: helpNav(next, pages.length, interaction.guild.id),
    });
  }

  if (id === 'event:now' || id === 'event:later') {
    if (!(await requireAdmin(interaction))) return;
    const when = id === 'event:now' ? 'now' : '24';
    return interaction.showModal(
      modal(`event:create:${when}`, id === 'event:now' ? 'Create Event · Start Now' : 'Create Event · Schedule', [
        { id: 'title', label: 'Event title', max: 100 },
        { id: 'description', label: 'Description', style: 'long', max: 1000 },
        {
          id: 'when',
          label: 'When? Type now  OR  hours (e.g. 24)',
          placeholder: when,
          value: when,
          max: 10,
        },
        { id: 'location', label: 'Location / type', placeholder: 'Voice Lounge / Tournament / etc.', max: 100 },
      ])
    );
  }

  if (id === 'panelnav:noop') {
    return interaction.deferUpdate().catch(() => {});
  }
  if (id.startsWith('panelnav:prev:') || id.startsWith('panelnav:next:')) {
    // Single-shot update is snappier than defer + editReply for page flips
    if (!memberHasAdmin(interaction.member)) {
      return interaction
        .reply({
          embeds: [errorEmbed(interaction.guild.id, 'Denied', 'Administrator required.')],
          ephemeral: true,
        })
        .catch(() => {});
    }
    const parts = id.split(':');
    const dir = parts[1];
    const page = Number(parts[2]);
    const { PANEL_PAGES } = require('../ui/components');
    const next = dir === 'next' ? page + 1 : page - 1;
    if (next < 0 || next >= PANEL_PAGES.length) {
      return interaction.deferUpdate().catch(() => {});
    }
    try {
      return await interaction.update({
        embeds: [panelEmbed(interaction.guild.id, interaction.client, next)],
        components: panelComponents(interaction.guild.id, next),
      });
    } catch (err) {
      console.error('Panel nav failed:', err.message);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.deferUpdate().catch(() => {});
      }
      await interaction
        .followUp({
          embeds: [errorEmbed(interaction.guild.id, 'Panel', 'Could not turn the page. Try `.panel` to refresh.')],
          ephemeral: true,
        })
        .catch(() => {});
    }
    return;
  }

  if (id === 'iface:noop') {
    return interaction.deferUpdate();
  }
  if (id.startsWith('iface:prev:') || id.startsWith('iface:next:')) {
    const parts = id.split(':');
    const dir = parts[1];
    const page = Number(parts[2]);
    const next = dir === 'next' ? page + 1 : page - 1;
    if (next < 0 || next >= INTERFACE_TEMPLATES.length) return interaction.deferUpdate();
    const payload = singleInterfacePayload(interaction.guild.id, next);
    return interaction.update(payload);
  }
  if (id.startsWith('iface:apply:')) {
    if (!(await requireAdmin(interaction))) return;
    await interaction.deferReply({ ephemeral: true });
    const themeId = id.split(':')[2];
    const { applyThemeAndSyncRoles } = require('../features/theme-roles');
    await applyThemeAndSyncRoles(interaction.guild, themeId);
    await createPanel(interaction.guild, interaction.client, { skipThemeRoles: true }).catch((err) => {
      console.error('Theme panel refresh failed:', err.message);
    });
    const t = INTERFACE_TEMPLATES.find((x) => x.id === themeId);
    return interaction.editReply({
      embeds: [
        successEmbed(
          interaction.guild.id,
          'Interface Applied',
          `Now using **${t?.label || themeId}**\nPanel buttons updated to this theme.`
        ),
      ],
    });
  }

  if (id === 'profile:name') {
    if (!(await requireAdmin(interaction))) return;
    return interaction.showModal(nameModal());
  }
  if (id === 'profile:avatar-url') {
    if (!(await requireAdmin(interaction))) return;
    return interaction.showModal(urlModal('avatar'));
  }
  if (id === 'profile:banner-url') {
    if (!(await requireAdmin(interaction))) return;
    return interaction.showModal(urlModal('banner'));
  }
  if (id === 'profile:avatar-upload' || id === 'profile:banner-upload') {
    if (!(await requireAdmin(interaction))) return;
    const type = id.includes('banner') ? 'banner' : 'avatar';
    armUpload(interaction.user.id, type, interaction.channel.id);
    return interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: type === 'avatar' ? 'Upload Avatar' : 'Upload Banner',
          description:
            `Send **one image** in this channel within **90 seconds**.\n` +
            `I’ll set it as the bot’s ${type}.\n\n` +
            '→ PNG, JPG, WEBP, or GIF\n→ Keep file size reasonable (Discord limits apply)',
        }),
      ],
      ephemeral: true,
    });
  }

  if (id.startsWith('invitesys:')) {
    if (!(await requireMod(interaction))) return;
    const sub = id.split(':')[1];
    const cfg = ensureInvites(loadGuild(interaction.guild.id));

    if (sub === 'toggle') {
      cfg.invites.enabled = !cfg.invites.enabled;
      saveGuild(interaction.guild.id, cfg);
      return interaction.reply({
        embeds: [
          successEmbed(
            interaction.guild.id,
            'Invite Tracker',
            cfg.invites.enabled ? 'Tracker enabled.' : 'Tracker disabled.'
          ),
        ],
        ephemeral: true,
      });
    }

    if (sub === 'log') {
      return interaction.reply({
        embeds: [
          baseEmbed(interaction.guild.id, {
            title: 'Invite Log Channel',
            description: 'Pick the channel for join / leave / fake invite logs.',
          }),
        ],
        components: [channelPick('invitesys:logchannel', 'Choose invite log channel')],
        ephemeral: true,
      });
    }

    if (sub === 'top') {
      const top = leaderboard(interaction.guild.id, 15);
      const body =
        top.length === 0
          ? '_No data yet._'
          : top
              .map(
                (r, i) =>
                  `→ **#${i + 1}** <@${r.id}> — valid **${r.valid}** · joins ${r.joins} · left ${r.left} · fake ${r.fake}`
              )
              .join('\n');
      return interaction.reply({
        embeds: [
          baseEmbed(interaction.guild.id, {
            title: 'Invite Leaderboard',
            description: body,
          }),
        ],
        ephemeral: true,
      });
    }

    if (sub === 'check') {
      return interaction.reply({
        embeds: [
          baseEmbed(interaction.guild.id, {
            title: 'Check Invites',
            description: 'Select a member to view their invite stats.',
          }),
        ],
        components: [userPickRow('invitestats')],
        ephemeral: true,
      });
    }
  }

  if (id === 'ticket:close') {
    return closeTicket(interaction);
  }
  if (id === 'ticket:claim') {
    return claimTicket(interaction);
  }
  if (id.startsWith('ticket:open:')) {
    return openTicket(interaction, id.split(':')[2]);
  }
  if (id === 'verify:button') {
    return handleVerifyButton(interaction);
  }

  if (id.startsWith('suggest:')) {
    const { handleSuggestButton } = require('../features/suggestions');
    return handleSuggestButton(interaction);
  }

  if (id.startsWith('automod:')) {
    if (!(await requireAdmin(interaction))) return;
    const cfg = loadGuild(interaction.guild.id);
    const sub = id.split(':')[1];
    if (sub === 'toggle') cfg.automod.enabled = !cfg.automod.enabled;
    if (sub === 'spam') cfg.automod.antiSpam = !cfg.automod.antiSpam;
    if (sub === 'invites') cfg.automod.antiInvite = !cfg.automod.antiInvite;
    if (sub === 'links') cfg.automod.antiLinks = !cfg.automod.antiLinks;
    if (sub === 'word') {
      return interaction.showModal(
        modal('automod:addword', 'Add Blocked Word', [
          { id: 'word', label: 'Word or phrase', max: 64 },
        ])
      );
    }
    saveGuild(interaction.guild.id, cfg);
    return interaction.reply({
      embeds: [successEmbed(interaction.guild.id, 'AutoMod', `Updated. Enabled: **${cfg.automod.enabled}**`)],
      ephemeral: true,
    });
  }

  if (id.startsWith('honeypot:')) {
    if (!(await requireAdmin(interaction))) return;
    const hp = require('../features/honeypot');
    const parts = id.split(':');
    const sub = parts[1];
    const cfg = loadGuild(interaction.guild.id);
    const h = hp.ensureHoneypot(cfg);

    if (sub === 'dismiss') {
      return interaction.update({ content: '_Dismissed._', embeds: [], components: [] }).catch(async () => {
        await interaction.message.delete().catch(() => {});
      });
    }

    if (sub === 'create') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const result = await hp.createHoneypotChannel(interaction.guild);
        return interaction.editReply({
          embeds: [
            successEmbed(
              interaction.guild.id,
              'Honeypot',
              result.created
                ? `Created ${result.channel} with a warning message.\nAction: **${hp.ensureHoneypot(result.cfg).action}**`
                : `${result.channel} already set — honeypot **enabled**.`
            ),
          ],
        });
      } catch (err) {
        return interaction.editReply({
          embeds: [errorEmbed(interaction.guild.id, 'Honeypot', String(err.message || err))],
        });
      }
    }

    if (sub === 'toggle') {
      if (!h.channelId) {
        return interaction.reply({
          embeds: [errorEmbed(interaction.guild.id, 'Honeypot', 'Create the channel first.')],
          ephemeral: true,
        });
      }
      h.enabled = !h.enabled;
      saveGuild(interaction.guild.id, cfg);
      return interaction.update({
        embeds: [hp.statusEmbed(interaction.guild.id, cfg)],
        components: hp.panelComponents(cfg),
      });
    }

    if (sub === 'action') {
      const next = parts[2];
      if (!hp.ACTIONS.includes(next)) {
        return interaction.reply({
          embeds: [errorEmbed(interaction.guild.id, 'Honeypot', 'Unknown action.')],
          ephemeral: true,
        });
      }
      h.action = next;
      saveGuild(interaction.guild.id, cfg);
      if (h.channelId) {
        const ch = interaction.guild.channels.cache.get(h.channelId);
        if (ch) {
          await hp.postWarning(ch, interaction.guild.id, h.action).catch(() => {});
        }
      }
      return interaction.update({
        embeds: [hp.statusEmbed(interaction.guild.id, cfg)],
        components: hp.panelComponents(cfg),
      });
    }

    if (sub === 'stats') {
      return interaction.reply({
        embeds: [hp.statsEmbed(interaction.guild.id, cfg)],
        components: hp.statsDismissComponents(),
        ephemeral: true,
      });
    }

    return interaction.reply({
      embeds: [hp.statusEmbed(interaction.guild.id, cfg)],
      components: hp.panelComponents(cfg),
      ephemeral: true,
    });
  }

  if (!id.startsWith('panel:')) return;

  const action = id.slice(6);

  // Ack heavy actions immediately so Discord never shows "didn't respond"
  const heavyPanel = new Set(['templates', 'automod', 'nuke', 'honeypot', 'interfaces', 'theme', 'iface-all']);
  if (heavyPanel.has(action)) {
    if (!memberHasAdmin(interaction.member)) {
      return interaction.reply({
        embeds: [errorEmbed(interaction.guild.id, 'Denied', 'Administrator required.')],
        ephemeral: true,
      });
    }
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  } else if (!(await requireAdmin(interaction))) {
    return;
  }

  const { isFreePanelActionAllowed, isFreeEdition, loadConfig } = require('../utils/edition');
  if (isFreeEdition() && !isFreePanelActionAllowed(action) && !['noop'].includes(action)) {
    const promo = loadConfig().promo || {};
    const payload = {
      embeds: [
        errorEmbed(
          interaction.guild.id,
          'Ougi Free',
          `This control is **Pro-only** on the free trial bot.\n\nDiscord: ${promo.discordInvite || '—'}\nBuy: ${promo.productUrl || '—'}`
        ),
      ],
    };
    if (interaction.deferred) return interaction.editReply(payload);
    return interaction.reply({ ...payload, ephemeral: true });
  }

  const replyEphemeral = async (payload) => {
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(payload);
    }
    return interaction.reply({ ...payload, ephemeral: true });
  };

  if (['ban', 'kick', 'mute', 'unmute', 'nick'].includes(action)) {
    return interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: action.toUpperCase(),
          description: `Select the member to **${action}**.`,
        }),
      ],
      components: [userPickRow(action)],
      ephemeral: true,
    });
  }

  const { handleExpandedPanel } = require('./panel-extra');
  if (await handleExpandedPanel(interaction, action, requireMod, requireAdmin)) return;

  if (action === 'lock' || action === 'unlock') {
    return interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: action === 'lock' ? 'Lock Channel' : 'Unlock Channel',
          description: `Select which channel to **${action}**.`,
        }),
      ],
      components: [lockChannelPick(action)],
      ephemeral: true,
    });
  }

  if (action === 'help') {
    return interaction.reply({
      embeds: [helpEmbed(interaction.guild.id, 0)],
      components: helpNav(0, getHelpPages().length, interaction.guild.id),
      ephemeral: true,
    });
  }

  if (action === 'theme' || action === 'interfaces') {
    const payload = singleInterfacePayload(interaction.guild.id, 0);
    return replyEphemeral(payload);
  }

  if (action === 'iface-all') {
    const payload = allInterfacesPayload(interaction.guild.id);
    return replyEphemeral(payload);
  }

  if (action === 'botname' || action === 'profile') {
    if (!(await requireAdmin(interaction))) return;
    return interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Bot Profile',
          description:
            '→ Change the **username**\n' +
            '→ Set **avatar** via URL or by uploading a photo\n' +
            '→ Set **banner** via URL or upload (requires bot with banner support / boosts may apply on user apps)\n\n' +
            `Current name: **${interaction.client.user.username}**`,
          thumbnail: interaction.client.user.displayAvatarURL({ size: 256 }),
        }),
      ],
      components: profileComponents(),
      ephemeral: true,
    });
  }

  if (action === 'invites') {
    if (!(await requireAdmin(interaction))) return;
    const cfg = loadGuild(interaction.guild.id);
    const disable = !cfg.invitesDisabled;
    await setInvitesDisabled(interaction.guild, disable);
    cfg.invitesDisabled = disable;
    saveGuild(interaction.guild.id, cfg);
    return interaction.reply({
      embeds: [
        successEmbed(
          interaction.guild.id,
          'Invites',
          disable ? 'Invite creation disabled for @everyone.' : 'Invite creation enabled for @everyone.'
        ),
      ],
      ephemeral: true,
    });
  }

  if (action === 'tickets') {
    if (!(await requireAdmin(interaction))) return;
    return interaction.showModal(ticketCreateModal());
  }

  if (action === 'invitetrack') {
    if (!(await requireMod(interaction))) return;
    const cfg = ensureInvites(loadGuild(interaction.guild.id));
    return interaction.reply({
      embeds: [trackerMenuEmbed(interaction.guild.id)],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              custom_id: 'invitesys:toggle',
              label: cfg.invites.enabled ? 'Disable Tracker' : 'Enable Tracker',
              style: cfg.invites.enabled ? 4 : 3,
            },
            {
              type: 2,
              custom_id: 'invitesys:log',
              label: 'Set Log Channel',
              style: 1,
            },
            {
              type: 2,
              custom_id: 'invitesys:top',
              label: 'Leaderboard',
              style: 2,
            },
            {
              type: 2,
              custom_id: 'invitesys:check',
              label: 'Check User',
              style: 2,
            },
          ],
        },
      ],
      ephemeral: true,
    });
  }

  if (action === 'announce') {
    if (!(await requireMod(interaction))) return;
    return interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Announcement',
          description: 'First pick the channel. Then you will type the message (and can attach images).',
        }),
      ],
      components: [channelPick('announce:channel', 'Choose announcement channel')],
      ephemeral: true,
    });
  }

  if (action === 'event') {
    if (!(await requireAdmin(interaction))) return;
    return interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Create Event',
          description: 'Choose when the event should start, then fill in the details.',
        }),
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, custom_id: 'event:now', label: 'Start Now', style: 3 },
            { type: 2, custom_id: 'event:later', label: 'Schedule Later', style: 1 },
          ],
        },
      ],
      ephemeral: true,
    });
  }

  if (action === 'templates') {
    return replyEphemeral(templateHomePayload(interaction.guild.id));
  }

  if (action === 'automod') {
    const cfg = loadGuild(interaction.guild.id);
    return replyEphemeral({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'AutoMod',
          description: rulesStyleList([
            { label: 'Enabled', text: cfg.automod.enabled ? 'Yes' : 'No' },
            { label: 'Anti-spam', text: String(cfg.automod.antiSpam) },
            { label: 'Anti-invite', text: String(cfg.automod.antiInvite) },
            { label: 'Anti-links', text: String(cfg.automod.antiLinks) },
            { label: 'Bad words', text: cfg.automod.badWords.join(', ') || 'none' },
          ]),
        }),
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              custom_id: 'automod:toggle',
              label: cfg.automod.enabled ? 'Disable' : 'Enable',
              style: cfg.automod.enabled ? 4 : 3,
            },
            { type: 2, custom_id: 'automod:spam', label: 'Toggle Spam', style: 2 },
            { type: 2, custom_id: 'automod:invites', label: 'Toggle Invites', style: 2 },
            { type: 2, custom_id: 'automod:links', label: 'Toggle Links', style: 2 },
            { type: 2, custom_id: 'automod:word', label: 'Add Word', style: 1 },
          ],
        },
      ],
    });
  }

  if (action === 'honeypot') {
    const hp = require('../features/honeypot');
    const cfg = loadGuild(interaction.guild.id);
    hp.ensureHoneypot(cfg);
    return replyEphemeral({
      embeds: [hp.statusEmbed(interaction.guild.id, cfg)],
      components: hp.panelComponents(cfg),
    });
  }

  if (action === 'welcome') {
    if (!(await requireAdmin(interaction))) return;
    return interaction.showModal(
      modal('welcome:setup', 'Welcome Messages', [
        { id: 'enabled', label: 'Enable? (yes/no)', placeholder: 'yes', max: 3 },
        { id: 'message', label: 'Welcome message', style: 'long', placeholder: 'Welcome {user} to {server}!', value: 'Welcome {user} to **{server}**! You are member #{count}.' },
      ])
    );
  }

  if (action === 'goodbye') {
    if (!(await requireAdmin(interaction))) return;
    return interaction.showModal(
      modal('goodbye:setup', 'Goodbye Messages', [
        { id: 'enabled', label: 'Enable? (yes/no)', placeholder: 'yes', max: 3 },
        {
          id: 'message',
          label: 'Goodbye message',
          style: 'long',
          placeholder: '{user} left {server}',
          value: '**{user}** left **{server}**. We now have {count} members.',
        },
      ])
    );
  }

  if (action === 'verify') {
    if (!(await requireAdmin(interaction))) return;
    await interaction.deferReply({ ephemeral: true });
    try {
      await setupVerify(interaction.guild, interaction.channel);
      return interaction.editReply({
        embeds: [
          successEmbed(
            interaction.guild.id,
            'Verify Ready',
            `Verification panel posted in ${interaction.channel}.\nNew members get **Unverified** until they click Verify.`
          ),
        ],
      });
    } catch (err) {
      return interaction.editReply({
        embeds: [errorEmbed(interaction.guild.id, 'Verify', err.message || 'Setup failed.')],
      });
    }
  }

  if (action === 'jtc') {
    if (!(await requireAdmin(interaction))) return;
    const { hub } = await setupJtc(interaction.guild);
    return interaction.reply({
      embeds: [
        successEmbed(
          interaction.guild.id,
          'Join-to-Create',
          `→ Hub: ${hub}\n→ Join it to spawn your own call\n→ Your **custom status** becomes the channel name\n→ Enable **Presence Intent** in the Discord Developer Portal for status names`
        ),
      ],
      ephemeral: true,
    });
  }

  if (action === 'channels') {
    if (!(await requireMod(interaction))) return;
    return interaction.reply({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Channel Manager',
          description:
            'Pick any channel below to view its **current settings**.\n' +
            'Then edit name, topic, slowmode, NSFW, voice limit, bitrate, lock/unlock — all from the interface.',
        }),
      ],
      components: [channelPickRow()],
      ephemeral: true,
    });
  }

  if (action === 'settings') {
    if (!(await requireAdmin(interaction))) return;
    return interaction.showModal(
      modal('settings:prefix', 'Set Command Prefix', [
        { id: 'prefix', label: 'Prefix (e.g. . / , !)', placeholder: '.', max: 5 },
      ])
    );
  }
}

async function handleUserSelect(interaction) {
  const [, action] = interaction.customId.split(':');
  if (!(await requireMod(interaction))) return;
  const userId = interaction.values[0];
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!member) {
    return interaction.reply({
      embeds: [errorEmbed(interaction.guild.id, 'Error', 'Member not found.')],
      ephemeral: true,
    });
  }

  if (action === 'invitestats') {
    const cfg = ensureInvites(loadGuild(interaction.guild.id));
    const stats = getUserStats(cfg, member.id);
    saveGuild(interaction.guild.id, cfg);
    return interaction.reply({
      embeds: [statsEmbed(interaction.guild.id, member.user, stats)],
      ephemeral: true,
    });
  }

  if (action === 'nick') {
    return interaction.showModal(
      modal(`mod:nick:${member.id}`, 'Set Nickname', [
        { id: 'nick', label: `Nickname for ${member.user.username}`, max: 32 },
      ])
    );
  }

  if (action === 'mute') {
    return interaction.showModal(
      modal(`mod:mute:${member.id}`, 'Mute Member', [
        { id: 'duration', label: 'Duration (e.g. 10m, 1h, 1d)', placeholder: '1h', max: 10 },
        { id: 'reason', label: 'Reason', required: false, max: 200 },
      ])
    );
  }

  if (action === 'ban' || action === 'kick' || action === 'unmute') {
    return interaction.showModal(
      modal(`mod:${action}:${member.id}`, `${action.toUpperCase()} Member`, [
        { id: 'reason', label: 'Reason', required: false, max: 200, placeholder: 'No reason provided' },
      ])
    );
  }

  if (action === 'warn') {
    return interaction.showModal(
      modal(`mod:warn:${member.id}`, 'Warn Member', [
        { id: 'reason', label: 'Reason', required: false, max: 200, placeholder: 'No reason provided' },
      ])
    );
  }

  if (action === 'softban') {
    return interaction.showModal(
      modal(`mod:softban:${member.id}`, 'Softban Member', [
        { id: 'reason', label: 'Reason', required: false, max: 200, placeholder: 'No reason provided' },
      ])
    );
  }

  if (action === 'addrole' || action === 'removerole') {
    const { RoleSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
    return interaction.update({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: action === 'addrole' ? 'Add Role' : 'Remove Role',
          description: `Select a role for ${member}.`,
        }),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder()
            .setCustomId(`roles:${action}:${member.id}`)
            .setPlaceholder('Select a role')
            .setMinValues(1)
            .setMaxValues(1)
        ),
      ],
    });
  }
}

async function handleStringSelect(interaction) {
  const [scope, kind] = interaction.customId.split(':');

  if (interaction.customId === 'selfrole:toggle') {
    const { handleSelfRoleSelect } = require('../features/roles');
    return handleSelfRoleSelect(interaction);
  }

  if (interaction.customId === 'settings:theme') {
    if (!(await requireAdmin(interaction))) return;
    const theme = interaction.values[0];
    const { applyThemeAndSyncRoles } = require('../features/theme-roles');
    await applyThemeAndSyncRoles(interaction.guild, theme);
    await createPanel(interaction.guild, interaction.client, { skipThemeRoles: true }).catch((err) => {
      console.error('Theme panel refresh failed:', err.message);
    });
    return interaction.update({
      embeds: [
        successEmbed(
          interaction.guild.id,
          'Theme',
          `Accent set to **${THEMES[theme].label}**\nPanel buttons updated to this theme.`
        ),
      ],
      components: [],
    });
  }

  if (interaction.customId === 'iface:pick') {
    if (!(await requireAdmin(interaction))) return;
    const id = interaction.values[0];
    const page = INTERFACE_TEMPLATES.findIndex((t) => t.id === id);
    const payload = singleInterfacePayload(interaction.guild.id, page < 0 ? 0 : page);
    return interaction.update(payload);
  }

  if (scope === 'template') {
    if (!(await requireAdmin(interaction))) return;
    const { isFreeEdition, isFreeServerTemplateAllowed } = require('../utils/edition');
    const id = interaction.values[0];
    if (kind === 'roles' && isFreeEdition()) {
      return interaction.update(templateHomePayload(interaction.guild.id));
    }
    if (kind === 'server') {
      if (!isFreeServerTemplateAllowed(id)) {
        return interaction.update({
          embeds: [
            errorEmbed(
              interaction.guild.id,
              'Ougi Free',
              'Free includes **Community Hub** only. Extra layouts are Pro.'
            ),
          ],
          components: templateHomeComponents(interaction.guild.id),
        });
      }
      const template = getServerTemplate(id);
      await interaction.update({
        embeds: [templatePreviewEmbed(interaction.guild.id, 'server', template)],
        components: templateApplyComponents('server', id, interaction.guild.id),
      });
      return;
    }
    if (kind === 'roles') {
      const template = getRoleTemplate(id);
      await interaction.update({
        embeds: [templatePreviewEmbed(interaction.guild.id, 'roles', template)],
        components: templateApplyComponents('roles', id, interaction.guild.id),
      });
    }
  }
}

// Apply template buttons are handled here by extending button handler
async function handleTemplateApply(interaction) {
  const parts = interaction.customId.split(':');
  // template:apply:server:id:keep|wipe  OR  template:apply:roles:id
  if (parts[0] !== 'template' || parts[1] !== 'apply') return false;

  // Acknowledge immediately — builds can take longer than Discord's 3s limit
  await interaction.deferReply({ ephemeral: true }).catch(() => {});
  if (!memberHasAdmin(interaction.member)) {
    await interaction.editReply({
      embeds: [errorEmbed(interaction.guild.id, 'Denied', 'Administrator required.')],
    });
    return true;
  }

  const kind = parts[2];
  const id = parts[3];
  const mode = parts[4] || 'keep';

  const { isFreeEdition, isFreeServerTemplateAllowed, FREE_SERVER_TEMPLATE_ID } = require('../utils/edition');
  if (isFreeEdition()) {
    if (kind === 'roles') {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            interaction.guild.id,
            'Ougi Free',
            'Role templates are **Pro-only**. Free includes the **Community Hub** channel layout only.'
          ),
        ],
      });
      return true;
    }
    if (kind === 'server' && !isFreeServerTemplateAllowed(id)) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            interaction.guild.id,
            'Ougi Free',
            `Free includes **${FREE_SERVER_TEMPLATE_ID}** only. Extra layouts are Pro.`
          ),
        ],
      });
      return true;
    }
  }

  try {
    if (kind === 'server') {
      const wipeChannels = mode === 'wipe';
      if (wipeChannels) {
        await interaction.editReply({
          embeds: [
            baseEmbed(interaction.guild.id, {
              title: 'Wiping Channels',
              description: 'Deleting all channels, then building the template. This can take a moment...',
            }),
          ],
        });
      } else {
        await interaction.editReply({
          embeds: [
            baseEmbed(interaction.guild.id, {
              title: 'Building…',
              description: 'Applying server template…',
            }),
          ],
        });
      }
      const result = await applyServerTemplate(interaction.guild, id, null, {
        wipeChannels,
        skipTickets: true,
      });

      let panelNote = '';
      if (wipeChannels) {
        try {
          const { createPanel } = require('../commands');
          const panel = await createPanel(interaction.guild, interaction.client, {
            skipThemeRoles: true,
          });
          panelNote = `\n\nControl panel recreated in ${panel}.`;
        } catch (err) {
          panelNote = `\n\nCould not recreate panel automatically — run \`.setup\`.`;
        }
      }

      const staffNote = result.staffRoles?.length
        ? `\n\nStaff access granted to: **${result.staffRoles.join(', ')}**`
        : `\n\n_No mod/staff roles found — apply a **Role template** first, then re-apply channels (or run \`.template\` wipe again)._`;

      await interaction.editReply({
        embeds: [
          baseEmbed(interaction.guild.id, {
            title: 'Finishing…',
            description: 'Channels built. Setting up tickets…',
          }),
        ],
      });

      let ticketNote = '';
      try {
        const { setupTicketsFromTemplate } = require('../features/tickets');
        const ticketsSetup = await setupTicketsFromTemplate(interaction.guild, {
          staffRoles: result.staffRolesRaw || [],
          vipRoles: result.vipRolesRaw || [],
        });
        if (ticketsSetup?.ok) {
          ticketNote = `\n\nTickets ready in <#${ticketsSetup.panelChannelId}>.`;
        }
      } catch (err) {
        console.error('ticket setup after template:', err.message);
        ticketNote = '\n\n_Ticket auto-setup failed — open Templates again or use Tickets on the panel._';
      }

      await interaction.editReply({
        embeds: [
          successEmbed(
            interaction.guild.id,
            'Server Built',
            `${wipeChannels ? `Wiped existing channels, then applied **${result.template.name}**.` : `**${result.template.name}** applied.`}\n\`\`\`\n${result.created.join('\n')}\n\`\`\`${staffNote}${ticketNote}${panelNote}`
          ),
        ],
      });
    } else {
      await interaction.editReply({
        embeds: [
          baseEmbed(interaction.guild.id, {
            title: 'Creating Roles…',
            description: 'Applying role template…',
          }),
        ],
      });
      const result = await applyRoleTemplate(interaction.guild, id);
      const createdBlock = result.created.length
        ? result.created.map((r) => `→ ${r}`).join('\n')
        : '_No new roles (all names already existed)._';
      const skippedBlock = result.skipped?.length
        ? `\n\n__**Skipped**__\n${result.skipped.map((r) => `→ ${r}`).join('\n')}`
        : '';
      await interaction.editReply({
        embeds: [
          successEmbed(
            interaction.guild.id,
            'Roles Created',
            `**${result.template.name}**\n${createdBlock}${skippedBlock}\n\n_Staff/VIP channel permissions were re-synced._`
          ),
        ],
      });
    }
  } catch (err) {
    await interaction.editReply({
      embeds: [errorEmbed(interaction.guild.id, 'Template', String(err.message || err))],
    });
  }
  return true;
}

async function handleRoleSelect(interaction) {
  if (interaction.customId === 'roles:autorole') {
    if (!(await requireAdmin(interaction))) return;
    const { setAutoroles } = require('../features/roles');
    const ids = interaction.values;
    setAutoroles(interaction.guild.id, ids);
    return interaction.update({
      embeds: [
        successEmbed(
          interaction.guild.id,
          'Autorole',
          ids.length ? `On join: ${ids.map((id) => `<@&${id}>`).join(', ')}` : 'Cleared.'
        ),
      ],
      components: [],
    });
  }

  if (interaction.customId.startsWith('roles:addrole:') || interaction.customId.startsWith('roles:removerole:')) {
    if (!(await requireMod(interaction))) return;
    const [, action, userId] = interaction.customId.split(':');
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    const role = interaction.guild.roles.cache.get(interaction.values[0]);
    if (!member || !role) {
      return interaction.update({
        embeds: [errorEmbed(interaction.guild.id, 'Role', 'Member or role not found.')],
        components: [],
      });
    }
    if (action === 'addrole') await member.roles.add(role);
    else await member.roles.remove(role);
    return interaction.update({
      embeds: [
        successEmbed(
          interaction.guild.id,
          action === 'addrole' ? 'Role Added' : 'Role Removed',
          `${action === 'addrole' ? 'Gave' : 'Removed'} ${role} ${action === 'addrole' ? 'to' : 'from'} ${member}.`
        ),
      ],
      components: [],
    });
  }
}

async function handleChannelSelect(interaction) {
  if (interaction.customId === 'channedit:pick') {
    if (!(await requireMod(interaction))) return;
    const channelId = interaction.values[0];
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      return interaction.reply({
        embeds: [errorEmbed(interaction.guild.id, 'Channels', 'Channel not found.')],
        ephemeral: true,
      });
    }
    return interaction.update(channelSettingsPayload(interaction.guild.id, channel));
  }

  if (interaction.customId === 'invitesys:logchannel') {
    if (!(await requireMod(interaction))) return;
    const channelId = interaction.values[0];
    const cfg = ensureInvites(loadGuild(interaction.guild.id));
    cfg.invites.logChannelId = channelId;
    saveGuild(interaction.guild.id, cfg);
    return interaction.update({
      embeds: [
        successEmbed(interaction.guild.id, 'Invite Logs', `Log channel set to <#${channelId}>`),
      ],
      components: [],
    });
  }

  if (interaction.customId === 'modlog:channel') {
    if (!(await requireAdmin(interaction))) return;
    const { setModLogChannel } = require('../features/moderation');
    const channelId = interaction.values[0];
    await setModLogChannel(interaction.guild.id, channelId);
    return interaction.update({
      embeds: [successEmbed(interaction.guild.id, 'Mod Log', `Set to <#${channelId}>`)],
      components: [],
    });
  }

  if (interaction.customId === 'serverlog:channel') {
    if (!(await requireAdmin(interaction))) return;
    const { setLogChannel } = require('../features/logging');
    const channelId = interaction.values[0];
    setLogChannel(interaction.guild.id, channelId);
    return interaction.update({
      embeds: [successEmbed(interaction.guild.id, 'Server Log', `Set to <#${channelId}>`)],
      components: [],
    });
  }

  if (interaction.customId === 'levels:announce') {
    if (!(await requireAdmin(interaction))) return;
    const { ensureLevels } = require('../features/levels');
    const channelId = interaction.values[0];
    const cfg = ensureLevels(loadGuild(interaction.guild.id));
    cfg.levels.announceChannelId = channelId;
    saveGuild(interaction.guild.id, cfg);
    return interaction.update({
      embeds: [successEmbed(interaction.guild.id, 'Leveling', `Announce channel: <#${channelId}>`)],
      components: [],
    });
  }

  if (interaction.customId === 'starboard:channel') {
    if (!(await requireAdmin(interaction))) return;
    const { configureStarboard } = require('../features/starboard');
    const channelId = interaction.values[0];
    configureStarboard(interaction.guild.id, { channelId, enabled: true, threshold: 3 });
    return interaction.update({
      embeds: [successEmbed(interaction.guild.id, 'Starboard', `Enabled in <#${channelId}> (3 stars)`)],
      components: [],
    });
  }

  if (interaction.customId === 'channellock:lock' || interaction.customId === 'channellock:unlock') {
    if (!(await requireMod(interaction))) return;
    const action = interaction.customId.split(':')[1];
    const channelId = interaction.values[0];
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      return interaction.update({
        embeds: [errorEmbed(interaction.guild.id, 'Channel', 'Channel not found.')],
        components: [],
      });
    }
    if (action === 'lock') await lockChannel(channel);
    else await unlockChannel(channel);
    return interaction.update({
      embeds: [
        successEmbed(
          interaction.guild.id,
          action === 'lock' ? 'Locked' : 'Unlocked',
          `${channel} is now ${action === 'lock' ? 'locked' : 'unlocked'}.`
        ),
      ],
      components: [],
    });
  }

  if (interaction.customId === 'channellock:nuke') {
    if (!(await requireMod(interaction))) return;
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.update({
        embeds: [errorEmbed(interaction.guild.id, 'Denied', 'Manage Channels permission required.')],
        components: [],
      });
    }
    const channelId = interaction.values[0];
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || channel.isThread()) {
      return interaction.update({
        embeds: [errorEmbed(interaction.guild.id, 'Nuke', 'Pick a normal text channel.')],
        components: [],
      });
    }
    await interaction.update({
      embeds: [successEmbed(interaction.guild.id, 'Nuking…', `Clearing ${channel}.`)],
      components: [],
    });
    const { runNuke } = require('../commands');
    await runNuke(interaction.guild, channel, interaction.user.tag);
    return;
  }

  if (interaction.customId === 'announce:channel') {
    if (!(await requireMod(interaction))) return;
    const channelId = interaction.values[0];
    pendingAnnounce.set(interaction.user.id, channelId);
    return interaction.update({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'Announcement',
          description:
            `Channel set to <#${channelId}>.\n\n` +
            'Click **Write Message** to type your announcement. You can include an image URL.',
        }),
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, custom_id: 'announce:write', label: 'Write Message', style: 1, emoji: { name: '✍️' } },
          ],
        },
      ],
    });
  }
}

async function handleModal(interaction) {
  const id = interaction.customId;

  if (id === 'settings:botname') {
    if (!(await requireAdmin(interaction))) return;
    const name = interaction.fields.getTextInputValue('name').trim();
    try {
      await interaction.client.user.setUsername(name);
      return interaction.reply({
        embeds: [successEmbed(interaction.guild.id, 'Bot Renamed', `My name is now **${name}**`)],
        ephemeral: true,
      });
    } catch (err) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            interaction.guild.id,
            'Bot Name',
            'Discord rate-limits username changes (often only a couple times per hour).\n' +
              String(err.message || err)
          ),
        ],
        ephemeral: true,
      });
    }
  }

  if (id === 'profile:avatar-url-submit' || id === 'profile:banner-url-submit') {
    if (!(await requireAdmin(interaction))) return;
    const url = interaction.fields.getTextInputValue('url').trim();
    const kind = id.includes('banner') ? 'banner' : 'avatar';
    await interaction.deferReply({ ephemeral: true });
    try {
      if (kind === 'avatar') await setAvatarFromUrl(interaction.client, url);
      else await setBannerFromUrl(interaction.client, url);
      return interaction.editReply({
        embeds: [
          successEmbed(
            interaction.guild.id,
            kind === 'avatar' ? 'Avatar Updated' : 'Banner Updated',
            'Profile image changed successfully.'
          ),
        ],
      });
    } catch (err) {
      return interaction.editReply({
        embeds: [
          errorEmbed(
            interaction.guild.id,
            'Profile',
            'Could not set that image. Use a direct image link, and note Discord rate-limits profile changes.\n' +
              String(err.message || err)
          ),
        ],
      });
    }
  }

  if (id === 'settings:prefix') {
    if (!(await requireAdmin(interaction))) return;
    const { setGuildPrefix } = require('../utils/store');
    const raw = interaction.fields.getTextInputValue('prefix').trim();
    const prefix = setGuildPrefix(interaction.guild.id, raw);
    if (!prefix) {
      return interaction.reply({
        embeds: [errorEmbed(interaction.guild.id, 'Prefix', 'Prefix must be 1–5 characters.')],
        ephemeral: true,
      });
    }
    return interaction.reply({
      embeds: [
        successEmbed(
          interaction.guild.id,
          'Prefix',
          `Prefix set to \`${prefix}\`\nTry: \`${prefix}help\` · \`${prefix}ping\``
        ),
      ],
      ephemeral: true,
    });
  }

  if (id === 'ticket:createpanel') {
    if (!(await requireAdmin(interaction))) return;
    const { parseStyle } = require('../features/tickets');
    const label = interaction.fields.getTextInputValue('label').trim();
    const description = interaction.fields.getTextInputValue('description').trim();
    const prefix = interaction.fields.getTextInputValue('prefix').trim().toLowerCase().replace(/\s+/g, '-');
    let style = 'star';
    try {
      style = parseStyle(interaction.fields.getTextInputValue('style'));
    } catch {
      style = 'star';
    }
    // Infer a fitting emoji from the label
    const lower = label.toLowerCase();
    let emoji = '🎫';
    if (lower.includes('support')) emoji = '🎫';
    else if (lower.includes('report')) emoji = '🚨';
    else if (lower.includes('buy') || lower.includes('shop')) emoji = '🛒';
    else if (lower.includes('partner')) emoji = '🤝';
    else if (lower.includes('help')) emoji = '💬';
    const cfg = loadGuild(interaction.guild.id);
    const panelId = `p${Date.now()}`;
    const panel = { id: panelId, label, description, prefix, emoji, style };
    cfg.tickets.panels[panelId] = panel;
    saveGuild(interaction.guild.id, cfg);
    await postTicketPanel(interaction.channel, interaction.guild.id, panel);
    return interaction.reply({
      embeds: [
        successEmbed(interaction.guild.id, 'Ticket Panel Created', `Posted · **${label}**`),
      ],
      ephemeral: true,
    });
  }

  if (id.startsWith('event:create')) {
    if (!(await requireAdmin(interaction))) return;
    const title = interaction.fields.getTextInputValue('title').trim();
    const description = interaction.fields.getTextInputValue('description').trim();
    let whenRaw = '24';
    try {
      whenRaw = interaction.fields.getTextInputValue('when');
    } catch {
      try {
        whenRaw = interaction.fields.getTextInputValue('hours');
      } catch {
        whenRaw = id.split(':')[2] || '24';
      }
    }
    const location = interaction.fields.getTextInputValue('location').trim() || 'Server Event';
    const { start, label } = parseEventStart(whenRaw);
    const end = new Date(start.getTime() + 2 * 3600 * 1000);
    const event = await interaction.guild.scheduledEvents.create({
      name: title.slice(0, 100),
      description: description.slice(0, 1000),
      scheduledStartTime: start,
      scheduledEndTime: end,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: location.slice(0, 100) },
    });
    return interaction.reply({
      embeds: [
        successEmbed(
          interaction.guild.id,
          'Event Created',
          `→ __**${event.name}**__\n→ Starts <t:${Math.floor(start.getTime() / 1000)}:F> (${label})\n→ ${location}`
        ),
      ],
      ephemeral: true,
    });
  }

  if (id === 'welcome:setup') {
    if (!(await requireAdmin(interaction))) return;
    const enabled = interaction.fields.getTextInputValue('enabled').toLowerCase().startsWith('y');
    const message = interaction.fields.getTextInputValue('message');
    const cfg = loadGuild(interaction.guild.id);
    cfg.welcome.enabled = enabled;
    cfg.welcome.message = message;
    cfg.welcome.channelId = interaction.channel.id;
    saveGuild(interaction.guild.id, cfg);
    return interaction.reply({
      embeds: [
        successEmbed(
          interaction.guild.id,
          'Welcome',
          enabled
            ? `Welcomes ON in ${interaction.channel}\nMessage: ${message}`
            : 'Welcomes disabled.'
        ),
      ],
      ephemeral: true,
    });
  }

  if (id === 'goodbye:setup') {
    if (!(await requireAdmin(interaction))) return;
    const enabled = interaction.fields.getTextInputValue('enabled').toLowerCase().startsWith('y');
    const message = interaction.fields.getTextInputValue('message');
    const cfg = loadGuild(interaction.guild.id);
    if (!cfg.goodbye) cfg.goodbye = { enabled: false, channelId: null, message: '' };
    cfg.goodbye.enabled = enabled;
    cfg.goodbye.message = message;
    cfg.goodbye.channelId = interaction.channel.id;
    saveGuild(interaction.guild.id, cfg);
    return interaction.reply({
      embeds: [
        successEmbed(
          interaction.guild.id,
          'Goodbye',
          enabled
            ? `Goodbyes ON in ${interaction.channel}\nMessage: ${message}`
            : 'Goodbye messages disabled.'
        ),
      ],
      ephemeral: true,
    });
  }

  if (id === 'panel:purge') {
    if (!(await requireMod(interaction))) return;
    const { purgeMessages, sendModLog } = require('../features/moderation');
    const amount = parseInt(interaction.fields.getTextInputValue('amount'), 10);
    const deleted = await purgeMessages(interaction.channel, { amount });
    await sendModLog(interaction.guild, {
      action: 'Purge',
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      modId: interaction.user.id,
      reason: `Purged ${deleted} via panel in #${interaction.channel.name}`,
    });
    return interaction.reply({
      embeds: [successEmbed(interaction.guild.id, 'Purged', `Deleted **${deleted}** message(s).`)],
      ephemeral: true,
    });
  }

  if (id === 'panel:slowmode') {
    if (!(await requireMod(interaction))) return;
    const { setSlowmode } = require('../features/moderation');
    const seconds = parseInt(interaction.fields.getTextInputValue('seconds'), 10);
    if (Number.isNaN(seconds)) {
      return interaction.reply({
        embeds: [errorEmbed(interaction.guild.id, 'Slowmode', 'Enter a number of seconds.')],
        ephemeral: true,
      });
    }
    const s = await setSlowmode(interaction.channel, seconds);
    return interaction.reply({
      embeds: [successEmbed(interaction.guild.id, 'Slowmode', `${interaction.channel} set to **${s}s**.`)],
      ephemeral: true,
    });
  }

  if (id === 'panel:sticky') {
    if (!(await requireMod(interaction))) return;
    const { setSticky, clearSticky } = require('../features/sticky');
    const text = interaction.fields.getTextInputValue('text').trim();
    if (text.toLowerCase() === 'clear') {
      await clearSticky(interaction.channel);
      return interaction.reply({
        embeds: [successEmbed(interaction.guild.id, 'Sticky', 'Cleared sticky in this channel.')],
        ephemeral: true,
      });
    }
    await setSticky(interaction.channel, text);
    return interaction.reply({
      embeds: [successEmbed(interaction.guild.id, 'Sticky', 'Sticky message set.')],
      ephemeral: true,
    });
  }

  if (id === 'panel:poll') {
    if (!(await requireMod(interaction))) return;
    const { createPoll } = require('../features/polls');
    const question = interaction.fields.getTextInputValue('question').trim();
    const options = interaction.fields
      .getTextInputValue('options')
      .split('|')
      .map((p) => p.trim())
      .filter(Boolean);
    if (!question || options.length < 2) {
      return interaction.reply({
        embeds: [errorEmbed(interaction.guild.id, 'Poll', 'Need a question and at least 2 options (split with |).')],
        ephemeral: true,
      });
    }
    await createPoll(interaction.channel, interaction.guild.id, question, options);
    return interaction.reply({
      embeds: [successEmbed(interaction.guild.id, 'Poll', 'Poll posted in this channel.')],
      ephemeral: true,
    });
  }

  if (id === 'panel:remind') {
    const { addReminder } = require('../features/reminders');
    const when = interaction.fields.getTextInputValue('when').trim();
    const text = interaction.fields.getTextInputValue('text').trim();
    const durationMs = parseDuration(when);
    if (!durationMs || !text) {
      return interaction.reply({
        embeds: [errorEmbed(interaction.guild.id, 'Remind', 'Use a duration like `1h` and a message.')],
        ephemeral: true,
      });
    }
    const r = addReminder(interaction.client, {
      guildId: interaction.guild.id,
      channelId: interaction.channel.id,
      userId: interaction.user.id,
      text,
      durationMs,
    });
    return interaction.reply({
      embeds: [
        successEmbed(
          interaction.guild.id,
          'Reminder Set',
          `I'll remind you <t:${Math.floor(r.endsAt / 1000)}:R>:\n${text}`
        ),
      ],
      ephemeral: true,
    });
  }

  if (id === 'panel:embed') {
    if (!(await requireMod(interaction))) return;
    const title = interaction.fields.getTextInputValue('title').trim();
    const description = interaction.fields.getTextInputValue('description').trim();
    let image = '';
    try {
      image = interaction.fields.getTextInputValue('image')?.trim() || '';
    } catch {
      /* optional */
    }
    const payload = {
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: title || 'Embed',
          description,
          image: image || undefined,
        }),
      ],
    };
    await interaction.channel.send(payload);
    return interaction.reply({
      embeds: [successEmbed(interaction.guild.id, 'Embed', 'Posted in this channel.')],
      ephemeral: true,
    });
  }

  if (id === 'panel:afk') {
    const { setAfk, clearAfk } = require('../features/afk');
    const reason = interaction.fields.getTextInputValue('reason').trim();
    if (reason.toLowerCase() === 'clear') {
      clearAfk(interaction.guild.id, interaction.user.id);
      return interaction.reply({
        embeds: [successEmbed(interaction.guild.id, 'AFK', 'AFK cleared.')],
        ephemeral: true,
      });
    }
    setAfk(interaction.guild.id, interaction.user.id, reason || 'AFK');
    return interaction.reply({
      embeds: [successEmbed(interaction.guild.id, 'AFK', `You're now AFK: ${reason || 'AFK'}`)],
      ephemeral: true,
    });
  }

  if (id === 'panel:autorespond') {
    if (!(await requireAdmin(interaction))) return;
    const { addRule } = require('../features/autoresponder');
    const trigger = interaction.fields.getTextInputValue('trigger').trim();
    const response = interaction.fields.getTextInputValue('response').trim();
    if (!trigger || !response) {
      return interaction.reply({
        embeds: [errorEmbed(interaction.guild.id, 'Autorespond', 'Trigger and response are required.')],
        ephemeral: true,
      });
    }
    addRule(interaction.guild.id, trigger, response);
    return interaction.reply({
      embeds: [successEmbed(interaction.guild.id, 'Autorespond', `Added trigger \`${trigger}\``)],
      ephemeral: true,
    });
  }

  if (id === 'panel:giveaway') {
    if (!(await requireMod(interaction))) return;
    const { startGiveaway } = require('../features/giveaways');
    const prize = interaction.fields.getTextInputValue('prize').trim();
    const durationRaw = interaction.fields.getTextInputValue('duration').trim();
    const winners = Math.max(1, parseInt(interaction.fields.getTextInputValue('winners'), 10) || 1);
    const durationMs = parseDuration(durationRaw);
    if (!prize || !durationMs) {
      return interaction.reply({
        embeds: [errorEmbed(interaction.guild.id, 'Giveaway', 'Need a prize and duration like `1h`.')],
        ephemeral: true,
      });
    }
    try {
      const { message: gmsg } = await startGiveaway(interaction.client, {
        guild: interaction.guild,
        channel: interaction.channel,
        host: interaction.user,
        prize,
        durationMs,
        winners,
        maxEntries: null,
        requireServer: false,
      });
      return interaction.reply({
        embeds: [
          successEmbed(
            interaction.guild.id,
            'Giveaway Started',
            `Posted in ${interaction.channel} → [jump](${gmsg.url})`
          ),
        ],
        ephemeral: true,
      });
    } catch (err) {
      return interaction.reply({
        embeds: [errorEmbed(interaction.guild.id, 'Giveaway', err.message || 'Failed to start.')],
        ephemeral: true,
      });
    }
  }

  if (id === 'automod:addword') {
    if (!(await requireAdmin(interaction))) return;
    const word = interaction.fields.getTextInputValue('word').toLowerCase().trim();
    const cfg = loadGuild(interaction.guild.id);
    if (!cfg.automod.badWords.includes(word)) cfg.automod.badWords.push(word);
    cfg.automod.enabled = true;
    saveGuild(interaction.guild.id, cfg);
    return interaction.reply({
      embeds: [successEmbed(interaction.guild.id, 'AutoMod', `Blocked word added: \`${word}\``)],
      ephemeral: true,
    });
  }

  if (id === 'announce:message') {
    if (!(await requireMod(interaction))) return;
    const channelId = pendingAnnounce.get(interaction.user.id);
    if (!channelId) {
      return interaction.reply({
        embeds: [errorEmbed(interaction.guild.id, 'Announce', 'Pick a channel first from the panel.')],
        ephemeral: true,
      });
    }
    const text = interaction.fields.getTextInputValue('message');
    let image = '';
    try {
      image = interaction.fields.getTextInputValue('image')?.trim() || '';
    } catch {
      /* optional */
    }
    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel) {
      return interaction.reply({
        embeds: [errorEmbed(interaction.guild.id, 'Announce', 'Channel not found.')],
        ephemeral: true,
      });
    }
    const embed = baseEmbed(interaction.guild.id, {
      title: 'ANNOUNCEMENT',
      description: text,
      footer: `Posted by ${interaction.user.tag}`,
      image: image || undefined,
    });
    await channel.send({ embeds: [embed] });
    pendingAnnounce.delete(interaction.user.id);
    return interaction.reply({
      embeds: [successEmbed(interaction.guild.id, 'Announced', `Sent to ${channel}`)],
      ephemeral: true,
    });
  }

  if (id.startsWith('mod:')) {
    const [, action, userId] = id.split(':');
    if (!(await requireMod(interaction))) return;
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member) {
      return interaction.reply({
        embeds: [errorEmbed(interaction.guild.id, 'Error', 'Member not found.')],
        ephemeral: true,
      });
    }
    let reason = 'No reason provided';
    try {
      reason = interaction.fields.getTextInputValue('reason') || reason;
    } catch {
      /* optional */
    }

    if (action === 'ban') {
      await member.ban({ reason: `${interaction.user.tag}: ${reason}` });
      const { addCase, sendModLog } = require('../features/moderation');
      const row = addCase(interaction.guild.id, {
        type: 'ban',
        userId: member.id,
        modId: interaction.user.id,
        reason,
      });
      await sendModLog(interaction.guild, {
        action: 'Ban',
        userId: member.id,
        userTag: member.user.tag,
        modId: interaction.user.id,
        reason,
        caseId: row.id,
      });
      return interaction.reply({
        embeds: [successEmbed(interaction.guild.id, 'Banned', `→ **${member.user.tag}**\n→ ${reason}`)],
        ephemeral: true,
      });
    }
    if (action === 'kick') {
      await member.kick(`${interaction.user.tag}: ${reason}`);
      const { addCase, sendModLog } = require('../features/moderation');
      const row = addCase(interaction.guild.id, {
        type: 'kick',
        userId: member.id,
        modId: interaction.user.id,
        reason,
      });
      await sendModLog(interaction.guild, {
        action: 'Kick',
        userId: member.id,
        userTag: member.user.tag,
        modId: interaction.user.id,
        reason,
        caseId: row.id,
      });
      return interaction.reply({
        embeds: [successEmbed(interaction.guild.id, 'Kicked', `→ **${member.user.tag}**\n→ ${reason}`)],
        ephemeral: true,
      });
    }
    if (action === 'warn') {
      const { warnMember } = require('../features/moderation');
      const row = await warnMember(interaction.guild, {
        target: member,
        moderator: interaction.user,
        reason,
      });
      return interaction.reply({
        embeds: [
          successEmbed(
            interaction.guild.id,
            'Warned',
            `→ **${member.user.tag}** · Case #${row.id}\n→ ${reason}`
          ),
        ],
        ephemeral: true,
      });
    }
    if (action === 'softban') {
      const { softbanMember } = require('../features/moderation');
      await softbanMember(interaction.guild, {
        target: member,
        moderator: interaction.user,
        reason,
      });
      return interaction.reply({
        embeds: [successEmbed(interaction.guild.id, 'Softbanned', `→ **${member.user.tag}**\n→ ${reason}`)],
        ephemeral: true,
      });
    }
    if (action === 'unmute') {
      const { unmuteMember } = require('../features/moderation');
      await unmuteMember(interaction.guild, {
        target: member,
        moderator: interaction.user,
        reason,
      });
      return interaction.reply({
        embeds: [successEmbed(interaction.guild.id, 'Unmuted', `→ **${member.user.tag}**`)],
        ephemeral: true,
      });
    }
    if (action === 'mute') {
      const duration = parseDuration(interaction.fields.getTextInputValue('duration'));
      const { muteMember } = require('../features/moderation');
      const row = await muteMember(interaction.guild, {
        target: member,
        moderator: interaction.user,
        reason,
        durationMs: duration,
        store,
      });
      return interaction.reply({
        embeds: [
          successEmbed(
            interaction.guild.id,
            'Muted',
            `→ **${member.user.tag}** · Case #${row.id}\n→ ${reason}`
          ),
        ],
        ephemeral: true,
      });
    }
    if (action === 'nick') {
      const nick = interaction.fields.getTextInputValue('nick').slice(0, 32);
      await member.setNickname(nick);
      return interaction.reply({
        embeds: [successEmbed(interaction.guild.id, 'Nickname', `→ **${member.user.tag}** → **${nick}**`)],
        ephemeral: true,
      });
    }
  }
}

// Fix announce write button + wrap handler
async function handleInteractionFixed(interaction) {
  try {
    if (interaction.isButton() && (interaction.customId === 'event:now' || interaction.customId === 'event:later')) {
      return handleButton(interaction);
    }
    if (interaction.isButton() && interaction.customId === 'announce:write') {
      if (!(await requireMod(interaction))) return;
      return interaction.showModal(
        modal('announce:message', 'Announcement Message', [
          { id: 'message', label: 'Message', style: 'long', max: 2000 },
          { id: 'image', label: 'Image URL (optional)', required: false, max: 300 },
        ])
      );
    }
    if (interaction.isButton() && interaction.customId.startsWith('template:apply:')) {
      return handleTemplateApply(interaction);
    }
    if (interaction.isButton() && interaction.customId.startsWith('channedit:')) {
      return handleChannelEditButton(interaction, requireMod);
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('channedit:modal:')) {
      return handleChannelEditModal(interaction, requireMod);
    }
    if (interaction.isButton() && interaction.customId.startsWith('automod:')) {
      return handleButton(interaction);
    }
    if (interaction.isButton() && interaction.customId.startsWith('honeypot:')) {
      return handleButton(interaction);
    }
    return handleInteraction(interaction);
  } catch (err) {
    console.error(err);
  }
}

module.exports = { handleInteraction: handleInteractionFixed, createPanel };
