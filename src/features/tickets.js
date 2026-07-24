'use strict';

const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { loadGuild, saveGuild, updateGuild } = require('../utils/store');
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');
const { modal, accentStyle } = require('../ui/components');
const { memberHasMod } = require('../utils/helpers');

const TICKET_CATEGORY_NAME = '╭─── Tickets 🎫 ˅';

function formatTicketChannelName(panel, num) {
  const emoji = panel.emoji || '🎫';
  const base = `${(panel.prefix || 'ticket').toLowerCase().replace(/\s+/g, '-')}-${num}`;
  const style = (panel.style || 'dot').toLowerCase();
  if (style === 'star') return `${emoji} ★ ${base}`;
  if (style === 'pipe') return `${emoji}｜${base}`;
  if (style === 'dash') return `${emoji}-${base}`;
  return `${emoji}・${base}`;
}

/** Buyer / priority tickets: priority-ticket-623 (no emoji fluff). */
function formatPriorityTicketChannelName(panel, counter) {
  const prefix = String(panel?.prefix || 'ticket')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 40) || 'ticket';
  const n = String(Number(counter) || counter).replace(/^0+(?=\d)/, '') || '0';
  return `priority-${prefix}-${n}`.slice(0, 100);
}

function parseStyle(raw) {
  const s = String(raw || 'dot').toLowerCase().trim();
  if (s.startsWith('star') || s === '★' || s === '*') return 'star';
  if (s.startsWith('pipe') || s === '|' || s === '｜') return 'pipe';
  if (s.startsWith('dash') || s === '-') return 'dash';
  return 'dot';
}

/**
 * Buyer role for priority tickets.
 * Prefer configured tickets.buyerRoleId (not spoofable by renaming a fake role).
 * Fallback: role name contains "buyer" as a whole word.
 */
function memberHasBuyerRole(member, cfg) {
  if (!member?.roles?.cache) return false;
  const configured = cfg?.tickets?.buyerRoleId;
  if (configured && member.roles.cache.has(configured)) return true;
  return member.roles.cache.some((r) => /\bbuyer\b/i.test(r.name));
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
      label: 'Style: star, dot, pipe, or dash',
      placeholder: 'star',
      value: 'star',
      max: 8,
    },
  ]);
}

function ticketControls(guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:claim')
      .setLabel('Claim')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setLabel('Close Ticket')
      .setStyle(accentStyle(guildId))
  );
}

async function postTicketPanel(channel, guildId, panel) {
  const desc = String(panel.description || '')
    .replace(/\*\*Buyers\*\*[^\n]*/gi, '')
    .replace(/Buyers are helped first\.?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const embed = baseEmbed(guildId, {
    title: panel.label || 'Tickets',
    description: desc || 'Need help? Open a private ticket with staff.',
    footer: 'Ougi Tickets',
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:open:${panel.id}`)
      .setLabel(panel.label || 'Open Ticket')
      .setStyle(accentStyle(guildId))
  );
  return channel.send({ embeds: [embed], components: [row] });
}

async function buildTranscript(channel, limit = 80) {
  const messages = await channel.messages.fetch({ limit }).catch(() => null);
  if (!messages?.size) return '_No messages_';
  const lines = [...messages.values()]
    .reverse()
    .map((m) => {
      const time = new Date(m.createdTimestamp).toISOString();
      const author = m.author?.tag || 'unknown';
      const text = (m.content || '[embed/attachment]').replace(/\n/g, ' ').slice(0, 300);
      return `[${time}] ${author}: ${text}`;
    });
  return lines.join('\n').slice(0, 3800);
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

  const existingEntry = Object.entries(cfg.tickets.open || {}).find(
    ([, t]) => t.userId === interaction.user.id && t.panelId === panelId && !t.closed
  );
  if (existingEntry) {
    const [existingChannelId] = existingEntry;
    return interaction.reply({
      embeds: [errorEmbed(guild.id, 'Ticket', `You already have an open ticket: <#${existingChannelId}>`)],
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });
  const category = await ensureTicketCategory(guild);
  cfg.tickets.counter = (cfg.tickets.counter || 0) + 1;
  const counter = cfg.tickets.counter;
  const num = String(counter).padStart(4, '0');
  const priority = memberHasBuyerRole(interaction.member, cfg);
  const channelName = priority
    ? formatPriorityTicketChannelName(panel, counter)
    : formatTicketChannelName(panel, num);

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
    topic: `${priority ? 'PRIORITY · ' : ''}${panel.label} · ${interaction.user.tag} · #${counter}`,
    reason: priority ? 'Ougi priority ticket opened (buyer)' : 'Ougi ticket opened',
  });

  // Priority tickets float to the top of the category for staff
  if (priority) {
    await ticketChannel.setPosition(0).catch(() => {});
  }

  cfg.tickets.open[ticketChannel.id] = {
    channelId: ticketChannel.id,
    userId: interaction.user.id,
    panelId,
    number: num,
    counter,
    priority: !!priority,
    openedAt: Date.now(),
    claimedBy: null,
  };
  saveGuild(guild.id, cfg);

  const embed = baseEmbed(guild.id, {
    title: priority ? `Priority · ${panel.label}` : panel.label,
    description: `Hey ${interaction.user} — describe your issue below.\nStaff will reply here.`,
    footer: priority ? `Priority · #${counter}` : `#${counter}`,
  });
  await ticketChannel.send({
    content: `${interaction.user}${cfg.tickets.supportRoleId ? ` · <@&${cfg.tickets.supportRoleId}>` : ''}`,
    embeds: [embed],
    components: [ticketControls(guild.id)],
  });

  return interaction.editReply({
    embeds: [successEmbed(guild.id, 'Ticket Opened', `${ticketChannel}`)],
  });
}

async function claimTicket(interaction) {
  const cfg = loadGuild(interaction.guild.id);
  const info = cfg.tickets.open?.[interaction.channel.id];
  if (!info) {
    return interaction.reply({
      embeds: [errorEmbed(interaction.guild.id, 'Ticket', 'This is not an active ticket channel.')],
      ephemeral: true,
    });
  }
  if (!memberHasMod(interaction.member) && !interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({
      embeds: [errorEmbed(interaction.guild.id, 'Ticket', 'Only staff can claim tickets.')],
      ephemeral: true,
    });
  }
  if (info.claimedBy) {
    return interaction.reply({
      embeds: [errorEmbed(interaction.guild.id, 'Ticket', `Already claimed by <@${info.claimedBy}>.`)],
      ephemeral: true,
    });
  }
  info.claimedBy = interaction.user.id;
  saveGuild(interaction.guild.id, cfg);
  await interaction.channel.send({
    embeds: [
      baseEmbed(interaction.guild.id, {
        title: 'Ticket Claimed',
        description: `${interaction.user} is handling this ticket.`,
      }),
    ],
  });
  return interaction.reply({
    embeds: [successEmbed(interaction.guild.id, 'Claimed', 'You claimed this ticket.')],
    ephemeral: true,
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

  const isOwner = info.userId === interaction.user.id;
  const isStaff =
    memberHasMod(interaction.member) ||
    interaction.member.permissions.has(PermissionFlagsBits.ManageChannels);
  if (!isOwner && !isStaff) {
    return interaction.reply({
      embeds: [errorEmbed(interaction.guild.id, 'Ticket', 'Only the opener or staff can close.')],
      ephemeral: true,
    });
  }

  await interaction.reply({
    embeds: [
      baseEmbed(interaction.guild.id, {
        title: 'Closing Ticket',
        description: 'Saving transcript… channel deletes in a few seconds.',
      }),
    ],
  });

  const transcript = await buildTranscript(interaction.channel);
  const logId = cfg.tickets.logChannelId || cfg.logging?.channelId;
  if (logId) {
    const logCh = interaction.guild.channels.cache.get(logId);
    if (logCh?.isTextBased?.()) {
      await logCh
        .send({
          embeds: [
            baseEmbed(interaction.guild.id, {
              title: `${info.priority ? 'Priority ' : ''}Ticket #${info.number || info.counter} closed`,
              description:
                `→ __**User:**__ <@${info.userId}>\n` +
                `→ __**Closed by:**__ ${interaction.user}\n` +
                `→ __**Priority:**__ ${info.priority ? 'yes (buyer)' : 'no'}\n` +
                `→ __**Claimed:**__ ${info.claimedBy ? `<@${info.claimedBy}>` : '_nobody_'}\n\n` +
                `\`\`\`\n${transcript.slice(0, 3500)}\n\`\`\``,
              footer: 'Ticket Transcript',
            }),
          ],
        })
        .catch(() => {});
    }
  }

  delete cfg.tickets.open[interaction.channel.id];
  saveGuild(interaction.guild.id, cfg);
  setTimeout(() => {
    interaction.channel.delete('Ticket closed').catch(() => {});
  }, 3500);
}

/** Prefix-command close (no interaction object). */
async function closeTicketChannel(channel, closer) {
  const cfg = loadGuild(channel.guild.id);
  const info = cfg.tickets.open?.[channel.id];
  if (!info) return { ok: false, error: 'Not a ticket channel.' };

  const member = await channel.guild.members.fetch(closer.id).catch(() => null);
  const isOwner = info.userId === closer.id;
  const isStaff =
    (member && memberHasMod(member)) ||
    member?.permissions?.has?.(PermissionFlagsBits.ManageChannels);
  if (!isOwner && !isStaff) return { ok: false, error: 'Only the opener or staff can close.' };

  const transcript = await buildTranscript(channel);
  const logId = cfg.tickets.logChannelId || cfg.logging?.channelId;
  if (logId) {
    const logCh = channel.guild.channels.cache.get(logId);
    if (logCh?.isTextBased?.()) {
      await logCh
        .send({
          embeds: [
            baseEmbed(channel.guild.id, {
              title: `${info.priority ? 'Priority ' : ''}Ticket #${info.number || info.counter} closed`,
              description:
                `→ __**User:**__ <@${info.userId}>\n` +
                `→ __**Closed by:**__ ${closer}\n` +
                `→ __**Priority:**__ ${info.priority ? 'yes (buyer)' : 'no'}\n` +
                `→ __**Claimed:**__ ${info.claimedBy ? `<@${info.claimedBy}>` : '_nobody_'}\n\n` +
                `\`\`\`\n${transcript.slice(0, 3500)}\n\`\`\``,
              footer: 'Ticket Transcript',
            }),
          ],
        })
        .catch(() => {});
    }
  }

  delete cfg.tickets.open[channel.id];
  saveGuild(channel.guild.id, cfg);
  setTimeout(() => channel.delete('Ticket closed').catch(() => {}), 3500);
  return { ok: true };
}

function normalizeChannelKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function findTextChannelByKeys(guild, keys) {
  const want = keys.map((k) => normalizeChannelKey(k));
  return (
    guild.channels.cache.find(
      (c) =>
        c.isTextBased?.() &&
        c.type === ChannelType.GuildText &&
        want.some((k) => normalizeChannelKey(c.name).includes(k))
    ) || null
  );
}

async function ensureNamedRole(guild, name, { color = 0xf1c40f, hoist = false } = {}) {
  const existing = guild.roles.cache.find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  try {
    return await guild.roles.create({
      name,
      color,
      hoist,
      mentionable: false,
      reason: 'Ougi template ticket setup',
      permissions: [],
    });
  } catch (err) {
    console.warn(`Could not create role ${name}:`, err.message);
    return null;
  }
}

function pickSupportRole(guild) {
  const ranked = [
    /^ticket\s*support$/i,
    /^support$/i,
    /^moderator$/i,
    /^mod$/i,
    /^staff$/i,
  ];
  for (const re of ranked) {
    const hit = guild.roles.cache.find((r) => re.test(r.name) && !r.managed);
    if (hit) return hit;
  }
  return null;
}

async function ensureTicketTemplateChannels(guild, { staffRoles = [], vipRoles = [] } = {}) {
  const me = guild.members.me;
  if (!me?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
    return { createCh: null, priorityCh: null, logsCh: null };
  }

  let createCh = findTextChannelByKeys(guild, ['createticket', 'create-ticket', 'openticket']);
  let priorityCh = findTextChannelByKeys(guild, ['prioritysupport', 'priority-support']);
  let logsCh = findTextChannelByKeys(guild, ['ticketlogs', 'ticket-logs', 'ticketlog']);

  const applyPerms = async (channel, perm) => {
    try {
      const { applyChannelPermissions } = require('./templates');
      await applyChannelPermissions(channel, perm, guild, staffRoles, vipRoles);
    } catch {
      /* ignore */
    }
  };

  if (!createCh || !priorityCh) {
    let supportCat = guild.channels.cache.find(
      (c) =>
        c.type === ChannelType.GuildCategory &&
        /support|ticket/i.test(c.name)
    );
    if (!supportCat) {
      supportCat = await guild.channels.create({
        name: '🎫 SUPPORT',
        type: ChannelType.GuildCategory,
        reason: 'Ougi ticket auto-setup',
      });
    }
    if (!createCh) {
      createCh = await guild.channels.create({
        name: 'create-ticket',
        type: ChannelType.GuildText,
        parent: supportCat.id,
        reason: 'Ougi ticket auto-setup',
        permissionOverwrites: [],
      });
      await applyPerms(createCh, 'readonly');
    }
    if (!priorityCh) {
      priorityCh = await guild.channels.create({
        name: 'priority-support',
        type: ChannelType.GuildText,
        parent: supportCat.id,
        reason: 'Ougi ticket auto-setup',
        permissionOverwrites: [],
      });
      await applyPerms(priorityCh, 'staff');
    }
  }

  if (!logsCh) {
    let staffCat = guild.channels.cache.find(
      (c) =>
        c.type === ChannelType.GuildCategory &&
        /staff|team|mod/i.test(c.name)
    );
    if (!staffCat) {
      staffCat = await guild.channels.create({
        name: '🛡️ STAFF',
        type: ChannelType.GuildCategory,
        reason: 'Ougi ticket auto-setup',
      });
      try {
        const { applyCategoryPermissions } = require('./templates');
        await applyCategoryPermissions(staffCat, { staffOnly: true }, guild, staffRoles, vipRoles);
      } catch {
        /* ignore */
      }
    }
    logsCh = await guild.channels.create({
      name: 'ticket-logs',
      type: ChannelType.GuildText,
      parent: staffCat.id,
      reason: 'Ougi ticket auto-setup',
      permissionOverwrites: [],
    });
    await applyPerms(logsCh, 'logs');
  }

  return { createCh, priorityCh, logsCh };
}

/**
 * After a server template apply (Free + Pro): ensure ticket channels exist,
 * wire Buyer/Support roles, post the panel, and staff priority guide.
 */
async function setupTicketsFromTemplate(guild, { staffRoles = [], vipRoles = [] } = {}) {
  if (!guild) return { ok: false, reason: 'no guild' };

  const ensured = await ensureTicketTemplateChannels(guild, { staffRoles, vipRoles }).catch((err) => {
    console.warn('ensureTicketTemplateChannels:', err.message);
    return null;
  });

  const createCh =
    ensured?.createCh ||
    findTextChannelByKeys(guild, ['createticket', 'create-ticket', 'openticket']);
  if (!createCh) return { ok: false, reason: 'no create-ticket channel' };

  const priorityCh =
    ensured?.priorityCh ||
    findTextChannelByKeys(guild, ['prioritysupport', 'priority-support']);
  const logsCh =
    ensured?.logsCh ||
    findTextChannelByKeys(guild, ['ticketlogs', 'ticket-logs', 'ticketlog']);

  const cfg = loadGuild(guild.id);
  if (!cfg.tickets) cfg.tickets = {};
  if (!cfg.tickets.panels) cfg.tickets.panels = {};
  if (!cfg.tickets.open) cfg.tickets.open = {};

  // Buyer = priority ticket gate (no elevated perms)
  let buyerRole =
    (cfg.tickets.buyerRoleId && guild.roles.cache.get(cfg.tickets.buyerRoleId)) ||
    guild.roles.cache.find((r) => /\bbuyer\b/i.test(r.name) && !r.managed) ||
    (await ensureNamedRole(guild, 'Buyer', { color: 0xe67e22, hoist: true }));
  if (buyerRole) cfg.tickets.buyerRoleId = buyerRole.id;

  // Support staff role for ticket visibility / pings
  let supportRole =
    (cfg.tickets.supportRoleId && guild.roles.cache.get(cfg.tickets.supportRoleId)) ||
    pickSupportRole(guild) ||
    (await ensureNamedRole(guild, 'Support', { color: 0x3498db, hoist: true }));
  if (supportRole) cfg.tickets.supportRoleId = supportRole.id;

  if (logsCh) cfg.tickets.logChannelId = logsCh.id;

  // Avoid duplicate panels when re-applying without wipe
  const existingPanel = Object.values(cfg.tickets.panels).find(
    (p) => p?.autoFromTemplate && p.prefix === 'ticket'
  );
  let panel = existingPanel;
  if (!panel) {
    const id = `tpl${Date.now().toString(36)}`;
    panel = {
      id,
      label: 'Open Ticket',
      description: 'Need help? Open a private ticket with staff.',
      prefix: 'ticket',
      emoji: '🎫',
      style: 'star',
      autoFromTemplate: true,
    };
    cfg.tickets.panels[id] = panel;
  } else {
    panel.description = 'Need help? Open a private ticket with staff.';
    panel.label = panel.label || 'Open Ticket';
    cfg.tickets.panels[panel.id] = panel;
  }

  saveGuild(guild.id, cfg);

  // Clear old bot ticket-panel messages in create-ticket (keep other content)
  try {
    const recent = await createCh.messages.fetch({ limit: 20 }).catch(() => null);
    if (recent?.size) {
      for (const msg of recent.values()) {
        if (
          msg.author?.id === guild.client.user.id &&
          msg.components?.some((row) =>
            row.components?.some((c) => String(c.customId || '').startsWith('ticket:open:'))
          )
        ) {
          await msg.delete().catch(() => {});
        }
      }
    }
  } catch {
    /* ignore */
  }

  await postTicketPanel(createCh, guild.id, panel);

  // Remove old how-to / owner explainers from #priority-support (setup is silent)
  if (priorityCh) {
    try {
      const recent = await priorityCh.messages.fetch({ limit: 20 }).catch(() => null);
      if (recent?.size) {
        for (const msg of recent.values()) {
          if (msg.author?.id !== guild.client.user.id) continue;
          const title = msg.embeds?.[0]?.title || msg.embeds?.[0]?.data?.title || '';
          if (/priority tickets/i.test(title)) {
            await msg.delete().catch(() => {});
          }
        }
      }
    } catch (err) {
      console.warn('priority-support cleanup:', err.message);
    }
  }

  return {
    ok: true,
    panelChannelId: createCh.id,
    priorityChannelId: priorityCh?.id || null,
    logChannelId: logsCh?.id || null,
    buyerRoleId: buyerRole?.id || null,
    supportRoleId: supportRole?.id || null,
  };
}

module.exports = {
  ticketCreateModal,
  postTicketPanel,
  openTicket,
  closeTicket,
  closeTicketChannel,
  claimTicket,
  ensureTicketCategory,
  formatTicketChannelName,
  formatPriorityTicketChannelName,
  memberHasBuyerRole,
  setupTicketsFromTemplate,
  ensureTicketTemplateChannels,
  parseStyle,
  updateGuild,
};
