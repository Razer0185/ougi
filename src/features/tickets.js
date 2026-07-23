const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
} = require('discord.js');
const { loadGuild, saveGuild, updateGuild } = require('../utils/store');
const { baseEmbed, successEmbed, errorEmbed, rulesStyleList } = require('../utils/embeds');
const { modal, accentStyle } = require('../ui/components');

const TICKET_CATEGORY_NAME = '╭─── Tickets 🎫 ˅';

function formatTicketChannelName(panel, num) {
  const emoji = panel.emoji || '🎫';
  const base = `${(panel.prefix || 'ticket').toLowerCase().replace(/\s+/g, '-')}-${num}`;
  const style = (panel.style || 'dot').toLowerCase();
  if (style === 'pipe') return `${emoji}｜${base}`;
  if (style === 'dash') return `${emoji}-${base}`;
  return `${emoji}・${base}`;
}

function parseStyle(raw) {
  const s = String(raw || 'dot').toLowerCase().trim();
  if (s.startsWith('pipe') || s === '|' || s === '｜') return 'pipe';
  if (s.startsWith('dash') || s === '-') return 'dash';
  return 'dot';
}

async function ensureTicketCategory(guild) {
  const cfg = loadGuild(guild.id);
  if (cfg.tickets.categoryId) {
    const existing = guild.channels.cache.get(cfg.tickets.categoryId);
    if (existing) {
      if (existing.name !== TICKET_CATEGORY_NAME) {
        await existing.setName(TICKET_CATEGORY_NAME).catch(() => {});
      }
      return existing;
    }
  }
  const cat = await guild.channels.create({
    name: TICKET_CATEGORY_NAME,
    type: ChannelType.GuildCategory,
    reason: 'Ougi ticket category',
  });
  cfg.tickets.categoryId = cat.id;
  saveGuild(guild.id, cfg);
  return cat;
}

function ticketCreateModal() {
  return modal('ticket:createpanel', 'Create Ticket Panel', [
    { id: 'label', label: 'Button label', placeholder: 'Support', max: 80 },
    { id: 'description', label: 'Panel description', style: 'long', placeholder: 'Click below to open a ticket' },
    { id: 'prefix', label: 'Channel name (e.g. support)', placeholder: 'support', max: 40 },
    {
      id: 'style',
      label: 'Style: dot, pipe, or dash',
      placeholder: 'dot',
      value: 'dot',
      max: 8,
    },
  ]);
}

async function postTicketPanel(channel, guildId, panel) {
  const example = formatTicketChannelName(
    { ...panel, emoji: panel.emoji || '🎫' },
    '0001'
  );
  const embed = baseEmbed(guildId, {
    title: panel.label,
    description:
      `${panel.description}\n\n` +
      rulesStyleList([
        { label: 'Open', text: 'click the button below' },
        { label: 'Channels', text: `\`${example}\` style` },
        { label: 'Staff', text: 'will reply in your private channel' },
      ]),
    footer: 'Ougi Tickets',
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:open:${panel.id}`)
      .setLabel(panel.label)
      .setStyle(accentStyle(guildId))
  );
  return channel.send({ embeds: [embed], components: [row] });
}

async function openTicket(interaction, panelId) {
  const guild = interaction.guild;
  const cfg = loadGuild(guild.id);
  const panel = cfg.tickets.panels[panelId];
  if (!panel) {
    return interaction.reply({
      embeds: [errorEmbed(guild.id, 'Ticket', 'This panel no longer exists.')],
      ephemeral: true,
    });
  }

  const existing = Object.values(cfg.tickets.open || {}).find(
    (t) => t.userId === interaction.user.id && t.panelId === panelId && !t.closed
  );
  if (existing) {
    return interaction.reply({
      embeds: [errorEmbed(guild.id, 'Ticket', `You already have an open ticket: <#${existing.channelId}>`)],
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });
  const category = await ensureTicketCategory(guild);
  cfg.tickets.counter = (cfg.tickets.counter || 0) + 1;
  const num = String(cfg.tickets.counter).padStart(4, '0');
  const channelName = formatTicketChannelName(panel, num);

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
  ];
  if (cfg.tickets.supportRoleId) {
    overwrites.push({
      id: cfg.tickets.supportRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: overwrites,
    topic: `${panel.label} · ${interaction.user.tag} · #${num}`,
    reason: 'Ougi ticket opened',
  });

  cfg.tickets.open[ticketChannel.id] = {
    userId: interaction.user.id,
    panelId,
    number: num,
    openedAt: Date.now(),
  };
  saveGuild(guild.id, cfg);

  const embed = baseEmbed(guild.id, {
    title: `${panel.label}`,
    description:
      `Welcome ${interaction.user}\n\n` +
      rulesStyleList([
        { label: 'Ticket', text: `#${num}` },
        { label: 'Type', text: panel.label },
        { label: 'Status', text: 'open — staff will help soon' },
      ]) +
      `\n\n→ Tell us what you need help with.\n→ Close anytime with the button below.`,
    footer: 'Ougi Tickets',
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setLabel('Close Ticket')
      .setStyle(accentStyle(guild.id))
  );
  await ticketChannel.send({
    content: `${interaction.user}${cfg.tickets.supportRoleId ? ` · <@&${cfg.tickets.supportRoleId}>` : ''}`,
    embeds: [embed],
    components: [row],
  });

  return interaction.editReply({
    embeds: [successEmbed(guild.id, 'Ticket Opened', `Your ticket: ${ticketChannel}\n\`${channelName}\``)],
  });
}

async function closeTicket(interaction) {
  const cfg = loadGuild(interaction.guild.id);
  const info = cfg.tickets.open?.[interaction.channel.id];
  if (!info) {
    return interaction.reply({
      embeds: [errorEmbed(interaction.guild.id, 'Ticket', 'This is not an active ticket channel.')],
      ephemeral: true,
    });
  }
  await interaction.reply({
    embeds: [
      baseEmbed(interaction.guild.id, {
        title: 'Closing Ticket',
        description: 'This channel will be deleted in 3 seconds...',
      }),
    ],
  });
  delete cfg.tickets.open[interaction.channel.id];
  saveGuild(interaction.guild.id, cfg);
  setTimeout(() => {
    interaction.channel.delete('Ticket closed').catch(() => {});
  }, 3000);
}

module.exports = {
  ticketCreateModal,
  postTicketPanel,
  openTicket,
  closeTicket,
  ensureTicketCategory,
  formatTicketChannelName,
  parseStyle,
  updateGuild,
};
