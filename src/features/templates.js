const { ChannelType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const {
  SERVER_TEMPLATES,
  ROLE_TEMPLATES,
  PERM_MAP,
  resolveRolePermissionFlags,
  resolveRolePermNames,
} = require('../data/templates');
const { baseEmbed } = require('../utils/embeds');

function getServerTemplate(id) {
  return SERVER_TEMPLATES.find((t) => t.id === id);
}

function getRoleTemplate(id) {
  return ROLE_TEMPLATES.find((t) => t.id === id);
}

function inferPerm(channelName, explicit, staffOnlyCat) {
  if (explicit) return explicit;
  if (staffOnlyCat) return 'staff';
  const n = String(channelName)
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, '')
    .replace(/[・｜|│┊\-_.\s]/g, '');
  if (/(announce|announcement|rules|updates|welcome|faq|schedule|news|uploads|roles|perks)/.test(n)) {
    return 'readonly';
  }
  if (/(modlog|ticketlog|logs|report)/.test(n)) return 'logs';
  if (/(staff|modchat|teamchat|teachers|planning|mods|prioritysupport)/.test(n)) return 'staff';
  return 'default';
}

function findStaffRole(guild, staffRoleId) {
  if (staffRoleId) {
    const role = guild.roles.cache.get(staffRoleId);
    if (role) return role;
  }
  return (
    guild.roles.cache
      .filter(
        (r) =>
          !r.managed &&
          r.id !== guild.id &&
          (r.permissions.has(PermissionFlagsBits.ManageMessages) ||
            r.permissions.has(PermissionFlagsBits.ModerateMembers) ||
            r.permissions.has(PermissionFlagsBits.Administrator))
      )
      .sort((a, b) => b.position - a.position)
      .first() || null
  );
}

/**
 * Auto permissions when channels are created from templates.
 * Admins (Administrator perm) always bypass overwrites in Discord.
 */
async function applyChannelPermissions(channel, perm, guild, staffRole) {
  const everyone = guild.roles.everyone.id;
  const overwrites = [];

  if (perm === 'readonly') {
    // View yes, send/react/threads no — announcements, rules, etc.
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
    if (staffRole) {
      overwrites.push({
        id: staffRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.MentionEveryone,
        ],
      });
    }
  } else if (perm === 'logs') {
    overwrites.push({
      id: everyone,
      deny: [PermissionFlagsBits.ViewChannel],
    });
    if (staffRole) {
      overwrites.push({
        id: staffRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.SendMessages,
        ],
        deny: [PermissionFlagsBits.AddReactions],
      });
    }
  } else if (perm === 'staff') {
    overwrites.push({
      id: everyone,
      deny: [PermissionFlagsBits.ViewChannel],
    });
    if (staffRole) {
      overwrites.push({
        id: staffRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
        ],
      });
    }
  } else {
    // default — leave Discord defaults (inherit category)
    return;
  }

  await channel.permissionOverwrites.set(overwrites);
}

async function wipeAllChannels(guild) {
  const channels = [...guild.channels.cache.values()];
  // Children first, then categories
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

  const staffRole = findStaffRole(guild, staffRoleId);
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

    if (cat.staffOnly) {
      const overs = [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
      if (staffRole) {
        overs.push({
          id: staffRole.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
        });
      }
      await category.permissionOverwrites.set(overs);
    }

    // Empty footer closer — no channels under it (keeps ╰─── at the very bottom)
    const channels = cat.channels || [];
    if (cat.footer || channels.length === 0) {
      if (cat.footer) created.push('  (empty end — no channels)');
      continue;
    }

    for (const ch of channels) {
      const channel = await guild.channels.create({
        name: ch.name,
        type: ch.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
        parent: category.id,
        reason: `Ougi template: ${template.name}`,
      });

      const perm = inferPerm(ch.name, ch.perm, cat.staffOnly);
      await applyChannelPermissions(channel, perm, guild, staffRole);

      const tag =
        perm === 'readonly' ? ' [read-only]' : perm === 'staff' || perm === 'logs' ? ' [staff]' : '';
      created.push(`  #${channel.name}${tag}`);
    }
  }

  // Force category order so ╰─── end stays last (Discord can shuffle on create)
  for (let i = 0; i < categoryRefs.length; i++) {
    await categoryRefs[i].setPosition(i, { reason: 'Ougi template order' }).catch(() => {});
  }

  return { template, created, staffRole: staffRole?.name || null, wiped: options.wipeChannels ? wiped : 0 };
}

async function applyRoleTemplate(guild, templateId) {
  const template = getRoleTemplate(templateId);
  if (!template) throw new Error('Unknown role template');

  const created = [];
  // Create from bottom to top so hierarchy looks natural
  const roles = [...template.roles].reverse();
  for (const r of roles) {
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
  return { template, created };
}

function templatePreviewEmbed(guildId, kind, template) {
  return baseEmbed(guildId, {
    title: `${kind === 'server' ? 'Server' : 'Role'} Template · ${template.name}`,
    description:
      `${template.description}\n\n__**Preview**__\n\`\`\`\n${template.preview}\n\`\`\`\n\n` +
      (kind === 'server'
        ? '_Channels like announcements/rules are auto set to read-only (admins/staff can post)._\n\n' +
          '**Build options**\n' +
          '→ __**Apply**__ — add this layout (keeps existing channels)\n' +
          '→ __**Wipe + Apply**__ — delete **all** channels first, then build'
        : '_Roles use emoji・Name and get real Discord permissions for that rank (Owner, Mod, Support, etc.)._'),
    footer:
      kind === 'roles'
        ? 'Example: 👑・Owner (Administrator) · 🛡️・Mod (kick, mute, manage messages)'
        : 'Wipe + Apply permanently deletes every channel first',
  });
}

/**
 * Keep an empty ╰─── end category at the bottom.
 * Moves any channels that were wrongly nested under it up into Staff (or previous category).
 */
async function ensureEmptyEndCategory(guild) {
  const categories = [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.rawPosition - b.rawPosition);

  // Staff should be a middle │─── not the closer ╰───
  for (const cat of categories) {
    if (/^╰───\s*Staff/i.test(cat.name)) {
      await cat.setName(cat.name.replace(/^╰───/, '│───')).catch(() => {});
    }
  }

  let endCat = categories.find((c) => /^╰───\s*end\b/i.test(c.name) || /^╰───\s*$/i.test(c.name.trim()));
  if (!endCat) {
    endCat = await guild.channels.create({
      name: '╰─── end',
      type: ChannelType.GuildCategory,
      reason: 'Ougi aesthetic end closer',
    });
  } else if (endCat.name !== '╰─── end') {
    await endCat.setName('╰─── end').catch(() => {});
  }

  // If anything is under end, move it to Staff (or the category above end)
  const underEnd = [...guild.channels.cache.values()].filter(
    (c) => c.parentId === endCat.id && c.type !== ChannelType.GuildCategory
  );
  if (underEnd.length) {
    const staffCat =
      guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && /Staff/i.test(c.name) && c.id !== endCat.id
      ) ||
      [...guild.channels.cache.values()]
        .filter((c) => c.type === ChannelType.GuildCategory && c.id !== endCat.id)
        .sort((a, b) => b.rawPosition - a.rawPosition)[0];

    for (const ch of underEnd) {
      if (staffCat) await ch.setParent(staffCat.id, { lockPermissions: false }).catch(() => {});
      else await ch.setParent(null).catch(() => {});
    }
  }

  // Put end at the very bottom
  const maxPos = Math.max(
    0,
    ...[...guild.channels.cache.values()]
      .filter((c) => c.type === ChannelType.GuildCategory)
      .map((c) => c.rawPosition)
  );
  await endCat.setPosition(maxPos + 1, { reason: 'Ougi keep end at bottom' }).catch(() => {});

  return {
    endCategory: endCat.name,
    movedChannels: underEnd.map((c) => c.name),
  };
}

module.exports = {
  SERVER_TEMPLATES,
  ROLE_TEMPLATES,
  getServerTemplate,
  getRoleTemplate,
  applyServerTemplate,
  applyRoleTemplate,
  templatePreviewEmbed,
  ensureEmptyEndCategory,
  inferPerm,
  applyChannelPermissions,
  wipeAllChannels,
};
