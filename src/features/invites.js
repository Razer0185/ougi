const { PermissionFlagsBits } = require('discord.js');
const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed, successEmbed, errorEmbed, rulesStyleList } = require('../utils/embeds');

const TWO_MONTHS_MS = 60 * 24 * 60 * 60 * 1000;
/** @type {Map<string, Map<string, { uses: number, inviterId: string|null }>>} */
const inviteCache = new Map();

function ensureInvites(cfg) {
  if (!cfg.invites || typeof cfg.invites !== 'object') {
    cfg.invites = {
      enabled: true,
      logChannelId: null,
      users: {},
      members: {},
    };
  }
  if (!cfg.invites.users) cfg.invites.users = {};
  if (!cfg.invites.members) cfg.invites.members = {};
  if (typeof cfg.invites.enabled !== 'boolean') cfg.invites.enabled = true;
  return cfg;
}

function emptyStats() {
  return { joins: 0, left: 0, fake: 0, valid: 0 };
}

function getUserStats(cfg, userId) {
  ensureInvites(cfg);
  if (!cfg.invites.users[userId]) cfg.invites.users[userId] = emptyStats();
  return cfg.invites.users[userId];
}

function isFakeAccount(user) {
  if (!user?.createdTimestamp) return false;
  return Date.now() - user.createdTimestamp < TWO_MONTHS_MS;
}

function accountAgeLabel(user) {
  const days = Math.floor((Date.now() - user.createdTimestamp) / 86400000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d old`;
  const months = Math.floor(days / 30);
  return `${months}mo old`;
}

async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    const map = new Map();
    for (const [code, inv] of invites) {
      map.set(code, {
        uses: inv.uses ?? 0,
        inviterId: inv.inviter?.id || null,
      });
    }
    // vanity
    if (guild.vanityURLCode) {
      try {
        const vanity = await guild.fetchVanityData();
        map.set(guild.vanityURLCode, {
          uses: vanity.uses ?? 0,
          inviterId: null,
        });
      } catch {
        map.set(guild.vanityURLCode, { uses: 0, inviterId: null });
      }
    }
    inviteCache.set(guild.id, map);
  } catch (err) {
    console.error(`Invite cache failed for ${guild.name}:`, err.message);
    if (!inviteCache.has(guild.id)) inviteCache.set(guild.id, new Map());
  }
}

function syncInviteToCache(guildId, invite) {
  if (!inviteCache.has(guildId)) inviteCache.set(guildId, new Map());
  inviteCache.get(guildId).set(invite.code, {
    uses: invite.uses ?? 0,
    inviterId: invite.inviter?.id || null,
  });
}

function removeInviteFromCache(guildId, code) {
  inviteCache.get(guildId)?.delete(code);
}

async function findUsedInvite(guild) {
  const cached = inviteCache.get(guild.id) || new Map();
  let used = null;

  try {
    const current = await guild.invites.fetch();
    for (const [code, inv] of current) {
      const before = cached.get(code);
      const uses = inv.uses ?? 0;
      if (!before && uses > 0) {
        used = { code, uses, inviterId: inv.inviter?.id || null, newInvite: true };
      } else if (before && uses > before.uses) {
        used = { code, uses, inviterId: inv.inviter?.id || before.inviterId, newInvite: false };
      }
    }

    // vanity check
    if (!used && guild.vanityURLCode) {
      try {
        const vanity = await guild.fetchVanityData();
        const before = cached.get(guild.vanityURLCode);
        if (before && vanity.uses > before.uses) {
          used = { code: guild.vanityURLCode, uses: vanity.uses, inviterId: null, vanity: true };
        }
      } catch {
        /* ignore */
      }
    }

    // refresh cache
    await cacheGuildInvites(guild);
  } catch (err) {
    console.error('findUsedInvite:', err.message);
  }

  return used;
}

async function handleMemberJoin(member) {
  const cfg = ensureInvites(loadGuild(member.guild.id));
  if (!cfg.invites.enabled) return null;

  const used = await findUsedInvite(member.guild);
  const fake = isFakeAccount(member.user);
  // Discord never exposes member IPs to bots — same-IP fake checks are not possible.
  const reasons = [];
  if (fake) reasons.push('account younger than 2 months');

  const inviterId = used?.inviterId || null;
  const record = {
    inviterId,
    code: used?.code || null,
    joinedAt: Date.now(),
    fake,
    fakeReasons: reasons,
    left: false,
    vanity: !!used?.vanity,
  };

  cfg.invites.members[member.id] = record;

  if (inviterId) {
    const stats = getUserStats(cfg, inviterId);
    stats.joins += 1;
    if (fake) stats.fake += 1;
    else stats.valid += 1;
  }

  saveGuild(member.guild.id, cfg);

  return { used, fake, reasons, inviterId, record };
}

async function handleMemberLeave(member) {
  const cfg = ensureInvites(loadGuild(member.guild.id));
  if (!cfg.invites.enabled) return null;

  const record = cfg.invites.members[member.id];
  if (!record || record.left) return null;

  record.left = true;
  record.leftAt = Date.now();

  if (record.inviterId) {
    const stats = getUserStats(cfg, record.inviterId);
    stats.left += 1;
    if (record.fake) {
      // fake leave: keep fake count, don't touch valid
    } else if (stats.valid > 0) {
      stats.valid -= 1;
    }
  }

  saveGuild(member.guild.id, cfg);
  return record;
}

function leaderboard(guildId, limit = 10) {
  const cfg = ensureInvites(loadGuild(guildId));
  return Object.entries(cfg.invites.users)
    .map(([id, s]) => ({
      id,
      joins: s.joins || 0,
      left: s.left || 0,
      fake: s.fake || 0,
      valid: s.valid || 0,
    }))
    .filter((s) => s.joins > 0)
    .sort((a, b) => b.valid - a.valid || b.joins - a.joins)
    .slice(0, limit);
}

function statsEmbed(guildId, user, stats) {
  return baseEmbed(guildId, {
    title: `Invites · ${user.username}`,
    thumbnail: user.displayAvatarURL({ size: 256 }),
    description: rulesStyleList([
      { label: 'Joins', text: String(stats.joins || 0) },
      { label: 'Valid', text: String(stats.valid || 0) },
      { label: 'Left', text: String(stats.left || 0) },
      { label: 'Fake', text: String(stats.fake || 0) },
    ]) +
      '\n\n_Fake = invited account younger than **2 months**._\n' +
      '_Left = they joined via your invite, then left (valid goes down)._\n' +
      '_Same-IP fakes are not detectable — Discord does not give bots IPs._',
  });
}

function trackerMenuEmbed(guildId) {
  const cfg = ensureInvites(loadGuild(guildId));
  const top = leaderboard(guildId, 5);
  const topText =
    top.length === 0
      ? '_No invites tracked yet._'
      : top
          .map(
            (r, i) =>
              `→ **#${i + 1}** <@${r.id}> — valid **${r.valid}** · joins ${r.joins} · left ${r.left} · fake ${r.fake}`
          )
          .join('\n');

  return baseEmbed(guildId, {
    title: 'Invite Tracker',
    description:
      `Status: **${cfg.invites.enabled ? 'ON' : 'OFF'}**\n` +
      `Log channel: ${cfg.invites.logChannelId ? `<#${cfg.invites.logChannelId}>` : '_not set_'}\n\n` +
      `__**Top invites**__\n${topText}\n\n` +
      '→ Fake invites: account created in the last **2 months**\n' +
      '→ Left: join then leave removes from **valid**\n' +
      '→ Same-IP: Discord bots cannot see user IPs (not available)',
  });
}

async function sendJoinLog(guild, member, result) {
  if (!result) return;
  const cfg = ensureInvites(loadGuild(guild.id));
  const channelId = cfg.invites.logChannelId;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;

  const inviterLine = result.inviterId
    ? `<@${result.inviterId}>`
    : result.used?.vanity
      ? 'Vanity URL'
      : 'Unknown';

  await channel
    .send({
      embeds: [
        baseEmbed(guild.id, {
          title: result.fake ? 'Join · Fake invite' : 'Join · Invite tracked',
          description: rulesStyleList([
            { label: 'Member', text: `${member} (\`${member.user.tag}\`)` },
            { label: 'Account', text: accountAgeLabel(member.user) },
            { label: 'Invited by', text: inviterLine },
            { label: 'Code', text: result.used?.code ? `\`${result.used.code}\`` : 'unknown' },
            {
              label: 'Flags',
              text: result.fake ? `FAKE — ${result.reasons.join(', ')}` : 'clean',
            },
          ]),
        }),
      ],
    })
    .catch(() => {});
}

async function sendLeaveLog(guild, member, record) {
  if (!record?.inviterId) return;
  const cfg = ensureInvites(loadGuild(guild.id));
  const channelId = cfg.invites.logChannelId;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;

  await channel
    .send({
      embeds: [
        baseEmbed(guild.id, {
          title: 'Leave · Invite adjusted',
          description: rulesStyleList([
            { label: 'Member', text: `${member.user.tag}` },
            { label: 'Was invited by', text: `<@${record.inviterId}>` },
            { label: 'Was fake', text: record.fake ? 'yes' : 'no' },
            { label: 'Effect', text: record.fake ? 'left +1 (fake kept)' : 'left +1 · valid −1' },
          ]),
        }),
      ],
    })
    .catch(() => {});
}

module.exports = {
  TWO_MONTHS_MS,
  ensureInvites,
  cacheGuildInvites,
  syncInviteToCache,
  removeInviteFromCache,
  handleMemberJoin,
  handleMemberLeave,
  leaderboard,
  statsEmbed,
  trackerMenuEmbed,
  sendJoinLog,
  sendLeaveLog,
  getUserStats,
  isFakeAccount,
  emptyStats,
  PermissionFlagsBits,
  successEmbed,
  errorEmbed,
  baseEmbed,
};
