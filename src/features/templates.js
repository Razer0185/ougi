const { ChannelType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const {
  SERVER_TEMPLATES,
  ROLE_TEMPLATES,
  resolveRolePermissionFlags,
  resolveRolePermNames,
} = require('../data/templates');
const { baseEmbed } = require('../utils/embeds');
const { loadGuild, saveGuild } = require('../utils/store');

const END_CATEGORY_NAME = '╰──── End 🔚';

function styleFromTemplateId(id) {
  const s = String(id || '').toLowerCase();
  if (s.includes('star')) return 'star';
  if (s.includes('pipe')) return 'pipe';
  if (s.includes('dash')) return 'dash';
  if (s.includes('dot') || s.includes('aesthetic')) return 'dot';
  return 'plain';
}

function setActiveServerTemplate(guildId, template) {
  if (!guildId || !template) return;
  const cfg = loadGuild(guildId);
  cfg.activeTemplate = {
    id: template.id,
    name: template.name,
    style: styleFromTemplateId(template.id),
    kind: 'server',
    at: Date.now(),
  };
  saveGuild(guildId, cfg);
}

function getServerTemplate(id) {
  return SERVER_TEMPLATES.find((t) => t.id === id);
}

function getRoleTemplate(id) {
  return ROLE_TEMPLATES.find((t) => t.id === id);
}

function stripChannelDecor(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, '')
    .replace(/[・｜|│┊\-_.\s★★]/g, '');
}

/**
 * Infer channel permission mode from name / category flags.
 * Modes: readonly | logs | staff | vip | default
 */
function inferPerm(channelName, explicit, staffOnlyCat, vipOnlyCat) {
  if (explicit) return explicit;
  if (vipOnlyCat) return 'vip';
  if (staffOnlyCat) {
    const n = stripChannelDecor(channelName);
    if (/(modlog|ticketlog|logs|report)/.test(n)) return 'logs';
    return 'staff';
  }
  const n = stripChannelDecor(channelName);
  if (/(announce|announcement|rules|updates|welcome|faq|schedule|news|uploads|roles|perks|resources)/.test(n)) {
    return 'readonly';
  }
  if (/(modlog|ticketlog|logs|report)/.test(n)) return 'logs';
  if (/(staff|modchat|teamchat|teachers|planning|mods|prioritysupport|team)/.test(n)) return 'staff';
  if (/(^vip|vipchat|viponly)/.test(n)) return 'vip';
  return 'default';
}

function roleLooksStaff(role) {
  if (!role || role.managed || role.id === role.guild?.id) return false;
  const n = role.name.toLowerCase();
  if (/(bot|everyone|member|fan|client|casual|competitive|pro\b|vip)/i.test(n) && !/mod|staff|admin|owner|support|manager/i.test(n)) {
    // pure community ranks — not staff for overwrites
    if (!role.permissions.has(PermissionFlagsBits.ManageMessages) && !role.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return false;
    }
  }
  return (
    role.permissions.has(PermissionFlagsBits.ManageMessages) ||
    role.permissions.has(PermissionFlagsBits.ModerateMembers) ||
    role.permissions.has(PermissionFlagsBits.KickMembers) ||
    role.permissions.has(PermissionFlagsBits.BanMembers) ||
    /mod|staff|admin|owner|support|manager|teacher|ceo|ticket/i.test(n)
  );
}

/**
 * Staff roles that need channel overwrites.
 * Prefer real mod/staff roles — skip pure Administrator (they bypass overs anyway),
 * but still include Admin if it's the only option.
 */
function findStaffRoles(guild, staffRoleId) {
  const picked = new Map();

  if (staffRoleId) {
    const role = guild.roles.cache.get(staffRoleId);
    if (role) picked.set(role.id, role);
  }

  const candidates = guild.roles.cache
    .filter((r) => roleLooksStaff(r))
    .sort((a, b) => b.position - a.position);

  for (const role of candidates.values()) {
    const isPureAdmin =
      role.permissions.has(PermissionFlagsBits.Administrator) &&
      !/mod|staff|support|ticket|manager|teacher/i.test(role.name);
    if (isPureAdmin && picked.size > 0) continue;
    picked.set(role.id, role);
  }

  // If we only found Administrator roles, keep the top one so something can post in readonly
  if (!picked.size) {
    const admin = guild.roles.cache
      .filter(
        (r) =>
          !r.managed &&
          r.id !== guild.id &&
          r.permissions.has(PermissionFlagsBits.Administrator)
      )
      .sort((a, b) => b.position - a.position)
      .first();
    if (admin) picked.set(admin.id, admin);
  }

  return [...picked.values()];
}

/** @deprecated use findStaffRoles — kept for callers expecting a single role */
function findStaffRole(guild, staffRoleId) {
  return findStaffRoles(guild, staffRoleId)[0] || null;
}

function findVipRoles(guild) {
  return guild.roles.cache
    .filter((r) => !r.managed && r.id !== guild.id && /\bvip\b/i.test(r.name))
    .sort((a, b) => b.position - a.position);
}

function staffTextAllows() {
  return [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ManageThreads,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.UseExternalEmojis,
  ];
}

function staffVoiceAllows() {
  return [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
    PermissionFlagsBits.Stream,
    PermissionFlagsBits.UseVAD,
    PermissionFlagsBits.MoveMembers,
    PermissionFlagsBits.MuteMembers,
  ];
}

function pushStaffAllows(overwrites, staffRoles, extras = []) {
  for (const role of staffRoles) {
    overwrites.push({
      id: role.id,
      allow: [...new Set([...staffTextAllows(), ...staffVoiceAllows(), ...extras])],
    });
  }
}

/**
 * Apply correct overwrites for a template channel.
 * staffRoles: GuildRole[] — mod/staff ladder (not just one Admin)
 */
async function applyChannelPermissions(channel, perm, guild, staffRoleOrRoles, vipRoles = []) {
  const everyone = guild.roles.everyone.id;
  const staffRoles = Array.isArray(staffRoleOrRoles)
    ? staffRoleOrRoles.filter(Boolean)
    : staffRoleOrRoles
      ? [staffRoleOrRoles]
      : [];
  const vips = [...(vipRoles || [])].filter(Boolean);
  const overwrites = [];

  if (perm === 'readonly') {
    overwrites.push({
      id: everyone,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.CreatePrivateThreads,
        PermissionFlagsBits.AddReactions,
      ],
    });
    pushStaffAllows(overwrites, staffRoles, [PermissionFlagsBits.MentionEveryone]);
  } else if (perm === 'logs') {
    // Staff can view; bots post — humans shouldn't chat in log channels
    overwrites.push({
      id: everyone,
      deny: [PermissionFlagsBits.ViewChannel],
    });
    for (const role of staffRoles) {
      overwrites.push({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
        ],
        deny: [
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AddReactions,
          PermissionFlagsBits.CreatePublicThreads,
          PermissionFlagsBits.CreatePrivateThreads,
        ],
      });
    }
  } else if (perm === 'staff') {
    overwrites.push({
      id: everyone,
      deny: [PermissionFlagsBits.ViewChannel],
    });
    pushStaffAllows(overwrites, staffRoles);
  } else if (perm === 'vip') {
    overwrites.push({
      id: everyone,
      deny: [PermissionFlagsBits.ViewChannel],
    });
    pushStaffAllows(overwrites, staffRoles);
    for (const role of vips) {
      overwrites.push({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.AddReactions,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.Stream,
          PermissionFlagsBits.UseVAD,
        ],
      });
    }
  } else {
    return;
  }

  await channel.permissionOverwrites.set(overwrites);
}

async function applyCategoryPermissions(category, { staffOnly, vipOnly }, guild, staffRoles, vipRoles) {
  if (!staffOnly && !vipOnly) return;
  const overs = [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
  const roles = staffOnly ? staffRoles : [...staffRoles, ...vipRoles];
  for (const role of roles) {
    overs.push({
      id: role.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.Stream,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }
  if (vipOnly) {
    for (const role of vipRoles) {
      if (overs.some((o) => o.id === role.id)) continue;
      overs.push({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
        ],
      });
    }
  }
  await category.permissionOverwrites.set(overs);
}

async function wipeAllChannels(guild) {
  const channels = [...guild.channels.cache.values()];
  const nonCats = channels.filter((c) => c.type !== ChannelType.GuildCategory);
  const cats = channels.filter((c) => c.type === ChannelType.GuildCategory);

  for (const ch of nonCats) {
    await ch.delete('Ougi template: wipe before build').catch(() => {});
  }
  for (const ch of cats) {
    await ch.delete('Ougi template: wipe before build').catch(() => {});
  }
}

async function applyServerTemplate(guild, templateId, staffRoleId, options = {}) {
  const template = getServerTemplate(templateId);
  if (!template) throw new Error('Unknown server template');

  let wiped = 0;
  if (options.wipeChannels) {
    wiped = guild.channels.cache.size;
    await wipeAllChannels(guild);
  }

  const staffRoles = findStaffRoles(guild, staffRoleId);
  const vipRoles = [...findVipRoles(guild).values()];
  const created = [];
  const categoryRefs = [];

  for (const cat of template.categories) {
    const category = await guild.channels.create({
      name: cat.name,
      type: ChannelType.GuildCategory,
      reason: `Ougi template: ${template.name}`,
    });
    created.push(category.name);
    categoryRefs.push(category);

    await applyCategoryPermissions(
      category,
      { staffOnly: !!cat.staffOnly, vipOnly: !!cat.vipOnly },
      guild,
      staffRoles,
      vipRoles
    );

    const channels = cat.channels || [];
    if (cat.footer || channels.length === 0) {
      if (cat.footer) created.push('  (end closer — no channels)');
      continue;
    }

    for (const ch of channels) {
      const channel = await guild.channels.create({
        name: ch.name,
        type: ch.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
        parent: category.id,
        reason: `Ougi template: ${template.name}`,
        // Don't lock to category — we set precise overs next
        permissionOverwrites: [],
      });

      const perm = inferPerm(ch.name, ch.perm, cat.staffOnly, cat.vipOnly);
      await applyChannelPermissions(channel, perm, guild, staffRoles, vipRoles);

      if (ch.honeypot) {
        try {
          const { bindTemplateChannel } = require('./honeypot');
          await bindTemplateChannel(guild, channel, 'kick');
          await channel
            .setTopic('SECURITY HONEYPOT — do not type here. Spammers are removed automatically.')
            .catch(() => {});
        } catch (err) {
          console.error('template honeypot bind:', err.message);
        }
      }

      const tag =
        perm === 'readonly'
          ? ' [read-only]'
          : perm === 'staff' || perm === 'logs'
            ? ' [staff]'
            : perm === 'vip'
              ? ' [vip]'
              : ch.honeypot
                ? ' [honeypot]'
                : '';
      created.push(`  #${channel.name}${tag}`);
    }
  }

  for (let i = 0; i < categoryRefs.length; i++) {
    await categoryRefs[i].setPosition(i, { reason: 'Ougi template order' }).catch(() => {});
  }

  setActiveServerTemplate(guild.id, template);

  // Free + Pro: ticket panel, Buyer priority, Support role, logs
  // Can be deferred with options.skipTickets so the UI can reply sooner
  let ticketsSetup = null;
  if (!options.skipTickets) {
    try {
      const { setupTicketsFromTemplate } = require('./tickets');
      ticketsSetup = await setupTicketsFromTemplate(guild, { staffRoles, vipRoles });
      if (ticketsSetup?.ok) {
        created.push('  ✓ Tickets auto-setup (panel + buyer/priority)');
      }
    } catch (err) {
      console.error('template ticket setup:', err.message);
    }
  }

  return {
    template,
    created,
    staffRole: staffRoles.map((r) => r.name).join(', ') || null,
    staffRoles: staffRoles.map((r) => r.name),
    wiped: options.wipeChannels ? wiped : 0,
    ticketsSetup,
    staffRolesRaw: staffRoles,
    vipRolesRaw: vipRoles,
  };
}

async function applyRoleTemplate(guild, templateId, options = {}) {
  const template = getRoleTemplate(templateId);
  if (!template) throw new Error('Unknown role template');

  const created = [];
  const skipped = [];
  const roles = [...template.roles].reverse();
  for (const r of roles) {
    const existing = guild.roles.cache.find(
      (x) => !x.managed && x.name.toLowerCase() === String(r.name).toLowerCase()
    );
    if (existing && !options.forceDuplicate) {
      skipped.unshift(`${existing.name} · already exists (skipped)`);
      continue;
    }

    const flags = resolveRolePermissionFlags(r.baseName || r.name, r.perms || []);
    const permissions = new PermissionsBitField(flags);
    const permNames = resolveRolePermNames(r.baseName || r.name, r.perms || []);

    const role = await guild.roles.create({
      name: r.name,
      color: r.color,
      permissions,
      reason: `Ougi role template: ${template.name}`,
      hoist: true,
      mentionable: false,
    });

    const permLabel =
      permNames.length === 0
        ? 'no extra perms'
        : permNames.includes('Administrator')
          ? 'Administrator'
          : `${permNames.length} permissions`;
    created.unshift(`${role.name} · ${permLabel}`);
  }

  // Re-sync staff/vip overs on existing staff/vip channels after new roles appear
  if (options.syncChannels !== false) {
    await syncTemplateChannelPermissions(guild).catch(() => {});
  }

  // Re-wire ticket Buyer/Support if ticket channels already exist (Free + Pro)
  let ticketsSetup = null;
  try {
    const { setupTicketsFromTemplate } = require('./tickets');
    const staff = findStaffRoles(guild);
    const vips = [...findVipRoles(guild).values()];
    ticketsSetup = await setupTicketsFromTemplate(guild, { staffRoles: staff, vipRoles: vips });
  } catch (err) {
    console.warn('role-template ticket rewire:', err.message);
  }

  return { template, created, skipped, ticketsSetup };
}

/**
 * Re-apply overs on channels that look like staff / logs / vip / readonly
 * using current staff + VIP roles. Safe to run after role templates.
 */
async function syncTemplateChannelPermissions(guild, staffRoleId) {
  const staffRoles = findStaffRoles(guild, staffRoleId);
  const vipRoles = [...findVipRoles(guild).values()];
  let updated = 0;

  for (const channel of guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildCategory) {
      const staffOnly = /staff|team|mod/i.test(channel.name) && !/end/i.test(channel.name);
      const vipOnly = /\bvip\b/i.test(channel.name);
      if (staffOnly || vipOnly) {
        await applyCategoryPermissions(channel, { staffOnly, vipOnly }, guild, staffRoles, vipRoles).catch(
          () => {}
        );
        updated += 1;
      }
      continue;
    }
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildVoice) continue;

    const parent = channel.parent;
    const staffOnlyCat = !!(parent && /staff|team/i.test(parent.name) && !/end/i.test(parent.name));
    const vipOnlyCat = !!(parent && /\bvip\b/i.test(parent.name));
    const perm = inferPerm(channel.name, null, staffOnlyCat, vipOnlyCat);
    if (perm === 'default') continue;
    await applyChannelPermissions(channel, perm, guild, staffRoles, vipRoles).catch(() => {});
    updated += 1;
  }
  return { updated, staffRoles: staffRoles.map((r) => r.name) };
}

function templatePreviewEmbed(guildId, kind, template) {
  return baseEmbed(guildId, {
    title: `${kind === 'server' ? 'Server' : 'Role'} Template · ${template.name}`,
    description:
      `${template.description}\n\n__**Preview**__\n\`\`\`\n${template.preview}\n\`\`\`\n\n` +
      (kind === 'server'
        ? '_Permissions auto-applied:_\n' +
          '→ __**Read-only**__ — rules / announcements (staff can post)\n' +
          '→ __**Staff**__ — staff chat hidden from @everyone\n' +
          '→ __**Logs**__ — view-only for staff (no chatting)\n' +
          '→ __**VIP**__ — VIP + staff only\n\n' +
          '**Build options**\n' +
          '→ __**Apply**__ — add this layout (keeps existing channels)\n' +
          '→ __**Wipe + Apply**__ — delete **all** channels first, then build'
        : '_Roles get real Discord permissions for that rank. Existing same-name roles are skipped. Staff/VIP channel access is re-synced after apply._'),
    footer:
      kind === 'roles'
        ? 'Example: 👑・Owner (Administrator) · 🛡️・Mod (kick, mute, manage messages)'
        : 'Wipe + Apply permanently deletes every channel first',
  });
}

/**
 * Keep an empty ╰──── End 🔚 category at the bottom (after Support when present).
 */
async function ensureEmptyEndCategory(guild) {
  const categories = [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.rawPosition - b.rawPosition);

  for (const cat of categories) {
    if (/^╰─+\s*Staff/i.test(cat.name)) {
      await cat.setName(cat.name.replace(/^╰─+/, '│───')).catch(() => {});
    }
  }

  let endCat = categories.find(
    (c) =>
      /^╰─+\s*end\b/i.test(c.name) ||
      /^╰─+\s*$/i.test(c.name.trim()) ||
      c.name === END_CATEGORY_NAME
  );
  if (!endCat) {
    endCat = await guild.channels.create({
      name: END_CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      reason: 'Ougi aesthetic end closer',
    });
  } else if (endCat.name !== END_CATEGORY_NAME) {
    await endCat.setName(END_CATEGORY_NAME).catch(() => {});
  }

  const underEnd = [...guild.channels.cache.values()].filter(
    (c) => c.parentId === endCat.id && c.type !== ChannelType.GuildCategory
  );
  if (underEnd.length) {
    const staffCat =
      guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && /Staff|Team/i.test(c.name) && c.id !== endCat.id
      ) ||
      [...guild.channels.cache.values()]
        .filter((c) => c.type === ChannelType.GuildCategory && c.id !== endCat.id)
        .sort((a, b) => b.rawPosition - a.rawPosition)[0];

    for (const ch of underEnd) {
      if (staffCat) await ch.setParent(staffCat.id, { lockPermissions: false }).catch(() => {});
      else await ch.setParent(null).catch(() => {});
    }
  }

  // Prefer: … → Support → End → (Ougi / other). Never leave Support under End.
  const supportCat = [...guild.channels.cache.values()].find(
    (c) =>
      c.type === ChannelType.GuildCategory &&
      /\bsupport\b/i.test(c.name) &&
      c.id !== endCat.id &&
      !/^╰─+/i.test(c.name)
  );
  const ougiCat = [...guild.channels.cache.values()].find(
    (c) => c.type === ChannelType.GuildCategory && /\bougi\b/i.test(c.name) && c.id !== endCat.id
  );

  if (supportCat) {
    const staffLike = [...guild.channels.cache.values()]
      .filter(
        (c) =>
          c.type === ChannelType.GuildCategory &&
          /staff|team/i.test(c.name) &&
          c.id !== endCat.id &&
          c.id !== supportCat.id
      )
      .sort((a, b) => b.rawPosition - a.rawPosition)[0];
    const basePos = staffLike ? staffLike.rawPosition + 1 : supportCat.rawPosition;
    await supportCat.setPosition(basePos, { reason: 'Ougi Support before End' }).catch(() => {});
    await endCat.setPosition(basePos + 1, { reason: 'Ougi End under Support' }).catch(() => {});
    if (ougiCat) {
      await ougiCat.setPosition(basePos + 2, { reason: 'Ougi panel after End' }).catch(() => {});
    }
  } else {
    const maxPos = Math.max(
      0,
      ...[...guild.channels.cache.values()]
        .filter((c) => c.type === ChannelType.GuildCategory && c.id !== endCat.id)
        .map((c) => c.rawPosition)
    );
    await endCat.setPosition(maxPos + 1, { reason: 'Ougi keep end at bottom' }).catch(() => {});
  }

  return {
    endCategory: endCat.name,
    movedChannels: underEnd.map((c) => c.name),
  };
}

/** Category name matching the server's aesthetic style. */
function supportCategoryNameForGuild(guild) {
  const cfg = loadGuild(guild.id);
  const style = cfg.activeTemplate?.style || styleFromTemplateId(cfg.activeTemplate?.id);
  if (style === 'plain') return '🎫 SUPPORT';
  return '│─── Support 🎫 ˅';
}

module.exports = {
  SERVER_TEMPLATES,
  ROLE_TEMPLATES,
  END_CATEGORY_NAME,
  getServerTemplate,
  getRoleTemplate,
  applyServerTemplate,
  applyRoleTemplate,
  syncTemplateChannelPermissions,
  templatePreviewEmbed,
  ensureEmptyEndCategory,
  supportCategoryNameForGuild,
  inferPerm,
  applyChannelPermissions,
  applyCategoryPermissions,
  findStaffRole,
  findStaffRoles,
  findVipRoles,
  wipeAllChannels,
  styleFromTemplateId,
  setActiveServerTemplate,
};
