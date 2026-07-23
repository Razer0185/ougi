const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');
const { parseDuration } = require('../utils/helpers');
const { themeRule } = require('../utils/theme');

const DEFAULT_EMOJI = '🎁';
const timers = new Map(); // messageId -> Timeout

function ensureGiveaways(cfg) {
  if (!cfg.giveaways || typeof cfg.giveaways !== 'object') cfg.giveaways = {};
  return cfg;
}

function getGiveaway(guildId, messageId) {
  const cfg = ensureGiveaways(loadGuild(guildId));
  return cfg.giveaways[messageId] || null;
}

function saveGiveaway(guildId, giveaway) {
  const cfg = ensureGiveaways(loadGuild(guildId));
  cfg.giveaways[giveaway.messageId] = giveaway;
  saveGuild(guildId, cfg);
}

function deleteGiveaway(guildId, messageId) {
  const cfg = ensureGiveaways(loadGuild(guildId));
  delete cfg.giveaways[messageId];
  saveGuild(guildId, cfg);
  clearTimer(messageId);
}

function clearTimer(messageId) {
  const t = timers.get(messageId);
  if (t) clearTimeout(t);
  timers.delete(messageId);
}

function scheduleEnd(client, giveaway) {
  clearTimer(giveaway.messageId);
  const delay = Math.max(0, giveaway.endsAt - Date.now());
  const handle = setTimeout(() => {
    endGiveaway(client, giveaway.guildId, giveaway.messageId).catch((err) =>
      console.error('Giveaway end error:', err.message)
    );
  }, Math.min(delay, 2147483647));
  timers.set(giveaway.messageId, handle);
}

function parseInviteInput(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{16,20}$/.test(s)) return { guildId: s, code: null };
  const m = s.match(/(?:discord(?:app)?\.com\/invite\/|discord\.gg\/)([a-zA-Z0-9-]+)/i);
  if (m) return { guildId: null, code: m[1] };
  if (/^[a-zA-Z0-9-]{2,32}$/.test(s)) return { guildId: null, code: s };
  return null;
}

async function resolveRequiredServer(client, input) {
  const parsed = parseInviteInput(input);
  if (!parsed) return null;

  if (parsed.guildId) {
    const guild = client.guilds.cache.get(parsed.guildId);
    if (!guild) {
      throw new Error(
        'I must be in that server to check membership. Invite the bot there, or use an invite link.'
      );
    }
    return { guildId: guild.id, name: guild.name, invite: null };
  }

  const invite = await client.fetchInvite(parsed.code).catch(() => null);
  if (!invite?.guild) throw new Error('Could not resolve that invite / server.');

  const inBot = client.guilds.cache.has(invite.guild.id);
  if (!inBot) {
    throw new Error(
      `I need to be a member of **${invite.guild.name}** to verify entries. Invite the bot there first.`
    );
  }

  return {
    guildId: invite.guild.id,
    name: invite.guild.name,
    invite: `https://discord.gg/${invite.code}`,
  };
}

function buildGiveawayEmbed(guildId, g, { ended = false, winners = [] } = {}) {
  const emoji = g.emoji || DEFAULT_EMOJI;
  const lines = [];
  lines.push(themeRule());
  lines.push(`React with ${emoji} to enter!`);
  lines.push('');
  lines.push(`**Winners:** ${g.winners}`);
  lines.push(`**Hosted by:** <@${g.hostId}>`);
  if (ended) {
    lines.push(`**Ended:** <t:${Math.floor(g.endsAt / 1000)}:R>`);
  } else {
    lines.push(`**Ends:** <t:${Math.floor(g.endsAt / 1000)}:R>`);
  }
  lines.push(`**Entries:** ${g.entries.length}${g.maxEntries ? ` / ${g.maxEntries}` : ''}`);

  if (g.requireGuildId) {
    lines.push('');
    lines.push('**Requirement**');
    lines.push(`→ Must be in **${g.requireGuildName || 'required server'}**`);
    if (g.requireInvite) lines.push(`→ ${g.requireInvite}`);
  }

  if (ended) {
    lines.push('');
    lines.push('**Winner(s)**');
    if (winners.length === 0) lines.push('_No valid entries._');
    else lines.push(winners.map((id) => `<@${id}>`).join(', '));
  }
  lines.push(themeRule());

  return baseEmbed(guildId, {
    title: `${emoji} ${g.prize}`,
    description: lines.join('\n'),
    footer: 'Giveaway',
  });
}

async function startGiveaway(client, {
  guild,
  channel,
  host,
  prize,
  durationMs,
  winners = 1,
  maxEntries = null,
  requireServer = null,
  emoji = DEFAULT_EMOJI,
}) {
  const endsAt = Date.now() + durationMs;
  let requireGuildId = null;
  let requireGuildName = null;
  let requireInvite = null;

  if (requireServer) {
    const req = await resolveRequiredServer(client, requireServer);
    requireGuildId = req.guildId;
    requireGuildName = req.name;
    requireInvite = req.invite;
  }

  const draft = {
    guildId: guild.id,
    channelId: channel.id,
    messageId: null,
    prize: String(prize).slice(0, 200),
    winners: Math.max(1, Math.min(Number(winners) || 1, 20)),
    maxEntries: maxEntries == null || maxEntries <= 0 ? null : Math.max(1, Number(maxEntries)),
    endsAt,
    hostId: host.id,
    emoji,
    requireGuildId,
    requireGuildName,
    requireInvite,
    entries: [],
    ended: false,
    winnerIds: [],
  };

  const msg = await channel.send({
    embeds: [buildGiveawayEmbed(guild.id, { ...draft, entries: [] })],
  });
  await msg.react(emoji);

  draft.messageId = msg.id;
  saveGiveaway(guild.id, draft);
  scheduleEnd(client, draft);
  return { message: msg, giveaway: draft };
}

async function userMeetsRequirement(client, giveaway, userId) {
  if (!giveaway.requireGuildId) return { ok: true };
  const guild = client.guilds.cache.get(giveaway.requireGuildId);
  if (!guild) return { ok: false, reason: 'Required server is unavailable.' };
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    return {
      ok: false,
      reason: giveaway.requireInvite
        ? `Join **${giveaway.requireGuildName || 'the required server'}** first: ${giveaway.requireInvite}`
        : `You must be in **${giveaway.requireGuildName || 'the required server'}** to enter.`,
    };
  }
  return { ok: true };
}

function reactionMatches(emoji, giveaway) {
  const want = giveaway.emoji || DEFAULT_EMOJI;
  if (emoji.id) return emoji.id === want || `<:${emoji.name}:${emoji.id}>` === want;
  return emoji.name === want;
}

async function handleReactionAdd(reaction, user, client) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  if (reaction.message.partial) await reaction.message.fetch().catch(() => null);

  const message = reaction.message;
  if (!message.guild) return;

  const giveaway = getGiveaway(message.guild.id, message.id);
  if (!giveaway || giveaway.ended) return;
  if (!reactionMatches(reaction.emoji, giveaway)) return;

  if (giveaway.entries.includes(user.id)) return;

  if (giveaway.maxEntries && giveaway.entries.length >= giveaway.maxEntries) {
    await reaction.users.remove(user.id).catch(() => {});
    await user
      .send({
        embeds: [
          errorEmbed(
            message.guild.id,
            'Giveaway Full',
            `**${giveaway.prize}** already has the maximum of **${giveaway.maxEntries}** entries.`
          ),
        ],
      })
      .catch(() => {});
    return;
  }

  const check = await userMeetsRequirement(client, giveaway, user.id);
  if (!check.ok) {
    await reaction.users.remove(user.id).catch(() => {});
    await user
      .send({
        embeds: [errorEmbed(message.guild.id, 'Requirement Not Met', check.reason)],
      })
      .catch(() => {});
    return;
  }

  giveaway.entries.push(user.id);
  saveGiveaway(message.guild.id, giveaway);

  await message.edit({ embeds: [buildGiveawayEmbed(message.guild.id, giveaway)] }).catch(() => {});
}

async function handleReactionRemove(reaction, user) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  if (reaction.message.partial) await reaction.message.fetch().catch(() => null);

  const message = reaction.message;
  if (!message.guild) return;

  const giveaway = getGiveaway(message.guild.id, message.id);
  if (!giveaway || giveaway.ended) return;
  if (!reactionMatches(reaction.emoji, giveaway)) return;

  const before = giveaway.entries.length;
  giveaway.entries = giveaway.entries.filter((id) => id !== user.id);
  if (giveaway.entries.length === before) return;

  saveGiveaway(message.guild.id, giveaway);
  await message.edit({ embeds: [buildGiveawayEmbed(message.guild.id, giveaway)] }).catch(() => {});
}

function pickWinners(entries, count) {
  const pool = [...new Set(entries)];
  const winners = [];
  while (winners.length < count && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(i, 1)[0]);
  }
  return winners;
}

async function endGiveaway(client, guildId, messageId, { reroll = false } = {}) {
  const giveaway = getGiveaway(guildId, messageId);
  if (!giveaway) return null;
  if (giveaway.ended && !reroll) return giveaway;

  clearTimer(messageId);

  // Re-validate required-server entries at end
  let valid = [...giveaway.entries];
  if (giveaway.requireGuildId) {
    const checked = [];
    for (const id of valid) {
      const ok = await userMeetsRequirement(client, giveaway, id);
      if (ok.ok) checked.push(id);
    }
    valid = checked;
  }

  const winners = pickWinners(valid, giveaway.winners);
  giveaway.ended = true;
  giveaway.endsAt = Math.min(giveaway.endsAt, Date.now());
  giveaway.winnerIds = winners;
  giveaway.entries = valid;
  saveGiveaway(guildId, giveaway);

  const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
  if (!channel) return giveaway;

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (message) {
    await message
      .edit({ embeds: [buildGiveawayEmbed(guildId, giveaway, { ended: true, winners })] })
      .catch(() => {});
  }

  if (winners.length) {
    await channel.send({
      content: `Congrats ${winners.map((id) => `<@${id}>`).join(', ')}! You won **${giveaway.prize}**!`,
    });
  } else {
    await channel.send({
      embeds: [
        errorEmbed(guildId, 'Giveaway Ended', `No valid entries for **${giveaway.prize}**.`),
      ],
    });
  }

  return giveaway;
}

async function resumeGiveaways(client) {
  for (const [guildId] of client.guilds.cache) {
    const cfg = ensureGiveaways(loadGuild(guildId));
    for (const g of Object.values(cfg.giveaways)) {
      if (g.ended) continue;
      if (g.endsAt <= Date.now()) {
        await endGiveaway(client, guildId, g.messageId).catch(() => {});
      } else {
        scheduleEnd(client, g);
      }
    }
  }
}

/** Parse: prize | duration | [winners] | [max|unlimited] | [server] */
function parseGiveawayArgs(raw) {
  const parts = raw.split('|').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) {
    return {
      error:
        'Usage: `giveaway <prize> | <duration> | [winners] | [max|unlimited] | [server invite/id]`\n' +
        'Example: `giveaway nitro | 1h | 2 | unlimited | discord.gg/abc`',
    };
  }

  const prize = parts[0];
  const durationMs = parseDuration(parts[1]);
  let winners = 1;
  let maxEntries = null;
  let requireServer = null;

  if (parts[2]) {
    const n = parseInt(parts[2], 10);
    if (!Number.isNaN(n)) winners = n;
  }
  if (parts[3]) {
    const m = parts[3].toLowerCase();
    if (m === 'unlimited' || m === 'inf' || m === 'none' || m === '0') maxEntries = null;
    else {
      const n = parseInt(parts[3], 10);
      if (!Number.isNaN(n)) maxEntries = n;
    }
  }
  if (parts[4]) requireServer = parts[4];

  return { prize, durationMs, winners, maxEntries, requireServer };
}

module.exports = {
  DEFAULT_EMOJI,
  startGiveaway,
  endGiveaway,
  handleReactionAdd,
  handleReactionRemove,
  resumeGiveaways,
  parseGiveawayArgs,
  getGiveaway,
  buildGiveawayEmbed,
  ensureGiveaways,
};
