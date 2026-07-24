'use strict';

/**
 * Free-bot runtime: trial tracking, promo Discord events, leave-all (except main HQ).
 */

const {
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventEntityType,
  GuildScheduledEventStatus,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const {
  isFreeEdition,
  loadConfig,
  loadGuilds,
  saveGuilds,
  loadControl,
  saveControl,
  isProtectedGuild,
  mainGuildId,
  FREE_DISPLAY_NAME,
} = require('../utils/edition');
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');

/** Last username lock attempt (Discord rate-limits global renames). */
let lastUsernameLockAt = 0;

/** Prevent recreate spam if someone mass-deletes events */
const recreateCooldown = new Map(); // guildId -> timestamp
const RECREATE_MS = 4000;

/** In-process promo guard (survives flaky disk; resets only on process restart). */
const promoMemoryCooldown = new Map(); // guildId -> lastSentAt
/** After boot, skip channel reminders so redeploys don't blast every server. */
let freeBotBootedAt = 0;
const PROMO_BOOT_GRACE_MS = 45 * 60 * 1000;
/** At most one quiet reminder across all guilds per sweep tick. */
let lastGlobalPromoAt = 0;

function trialMs() {
  const days = loadConfig().trialDays || 3;
  return days * 24 * 60 * 60 * 1000;
}

function promoIntervalMs() {
  const hours = loadConfig().promoIntervalHours || 72;
  return Math.max(24, hours) * 60 * 60 * 1000;
}

function trackGuild(guild) {
  if (!isFreeEdition() || !guild?.id) return null;
  if (isProtectedGuild(guild.id)) return null;
  const data = loadGuilds();
  const now = Date.now();
  const existing = data.byGuild[guild.id];
  // Fresh trial when first joined, or when they re-invite after we left
  if (existing?.joinedAt && !existing.left) {
    existing.name = guild.name;
    // Missing timestamp usually means ephemeral disk / redeploy — don't treat as "due now"
    if (!existing.lastDailyPromoAt) {
      existing.lastDailyPromoAt = now;
    }
    data.byGuild[guild.id] = existing;
    saveGuilds(data);
    return existing;
  }
  const row = {
    guildId: guild.id,
    name: guild.name,
    joinedAt: now,
    leaveAt: now + trialMs(),
    eventId: null,
    left: false,
    // Seed so maybeDailyPromo won't fire until a full interval (join welcome covers day 0)
    lastDailyPromoAt: now,
    rejoinCount: (existing?.rejoinCount || 0) + (existing?.left ? 1 : 0),
  };
  data.byGuild[guild.id] = row;
  saveGuilds(data);
  return row;
}

function markLeft(guildId) {
  const data = loadGuilds();
  if (data.byGuild[guildId]) {
    data.byGuild[guildId].left = true;
    data.byGuild[guildId].leftAt = Date.now();
    saveGuilds(data);
  }
}

function findLeaveNoticeChannel(guild) {
  const me = guild.members.me;
  const canSend = (c) =>
    c &&
    (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) &&
    c.viewable &&
    c.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages);

  if (canSend(guild.systemChannel)) return guild.systemChannel;
  const preferred = guild.channels.cache.find(
    (c) =>
      canSend(c) &&
      /general|chat|lounge|main|welcome|announcements?|info/i.test(c.name || '')
  );
  if (preferred) return preferred;
  return guild.channels.cache.find((c) => canSend(c)) || null;
}

/**
 * Post re-invite link right before leaving so active servers can add the bot back.
 */
async function sendTrialLeaveNotice(guild, reason = 'trial expired') {
  if (!guild || isProtectedGuild(guild.id)) return false;
  const cfg = loadConfig();
  const invite =
    cfg.promo?.botInvite ||
    cfg.promo?.productUrl ||
    (guild.client?.user?.id
      ? `https://discord.com/oauth2/authorize?client_id=${guild.client.user.id}&permissions=8&scope=bot`
      : null);
  const discord = cfg.promo?.discordInvite || null;
  const channel = findLeaveNoticeChannel(guild);
  if (!channel || !invite) {
    console.warn(`Free leave notice skipped in ${guild.name}: no channel or invite`);
    return false;
  }

  const trialDays = cfg.trialDays || 3;
  try {
    await channel.send({
      embeds: [
        baseEmbed(guild.id, {
          title: 'Ougi Free trial ended',
          description:
            `This free trial is over — **Ougi Free** is leaving so idle servers stay clean.\n\n` +
            `Still using this server? Add the bot back anytime (starts a new ${trialDays}-day trial):\n` +
            `→ **Add Ougi Free:** ${invite}\n` +
            (discord ? `→ **Our Discord / Pro:** ${discord}\n` : '') +
            `\n_If you only added the bot to try it once, you can ignore this._`,
          footer: reason === 'trial expired' ? 'Trial expired' : 'Ougi Free leaving',
        }),
      ],
    });
    return true;
  } catch (err) {
    console.warn(`Free leave notice failed in ${guild.name}:`, err.message);
    return false;
  }
}

async function leaveGuildSafe(guild, reason, { notice = false } = {}) {
  if (!guild || isProtectedGuild(guild.id)) {
    console.warn(`Free bot: refused leave protected guild ${guild?.id}`);
    return false;
  }
  try {
    if (notice) {
      await sendTrialLeaveNotice(guild, reason);
      // Brief pause so Discord delivers the message before we disconnect
      await new Promise((r) => setTimeout(r, 1500));
    }
    console.warn(`Free bot leaving ${guild.name} (${guild.id}): ${reason}`);
    await guild.leave();
    markLeft(guild.id);
    return true;
  } catch (err) {
    console.error(`Free leave failed ${guild.id}:`, err.message);
    return false;
  }
}

function promoEventName() {
  const cfg = loadConfig();
  return String(cfg.promo?.eventName || 'Upgrade to Ougi Pro').slice(0, 100);
}

function isOurPromoEvent(event) {
  if (!event) return false;
  const name = promoEventName();
  if (event.name === name) return true;
  const data = loadGuilds();
  const row = data.byGuild[event.guild?.id || event.guildId];
  return !!(row?.eventId && row.eventId === event.id);
}

/**
 * Create promo event starting ASAP (Discord requires a short future start).
 * Runs for up to the remaining trial window (or 7 days max).
 */
async function createPromoEvent(guild) {
  if (!isFreeEdition() || !guild || isProtectedGuild(guild.id)) return null;
  const cfg = loadConfig();
  const promo = cfg.promo || {};
  const data = loadGuilds();
  const row = data.byGuild[guild.id];
  const leaveAt = row?.leaveAt || Date.now() + trialMs();

  // ASAP — Discord only requires "in the future" (clock skew → try 5s, then 12s)
  let start = new Date(Date.now() + 5 * 1000);
  let endMs = Math.max(start.getTime() + 60 * 60 * 1000, leaveAt);
  // Discord external events: end must be after start; cap length ~7 days
  const maxEnd = start.getTime() + 7 * 24 * 60 * 60 * 1000;
  if (endMs > maxEnd) endMs = maxEnd;
  let end = new Date(endMs);

  const location = String(
    promo.discordInvite || promo.botInvite || promo.productUrl || 'https://discord.com'
  ).slice(0, 100);
  const description = [
    promo.eventDescription || 'Upgrade to Ougi Pro for the full bot.',
    '',
    promo.discordInvite ? `Our Discord: ${promo.discordInvite}` : '',
    promo.botInvite ? `Add free bot: ${promo.botInvite}` : '',
    promo.productUrl && promo.productUrl !== promo.botInvite ? `Buy / site: ${promo.productUrl}` : '',
    '',
    `Free trial — this bot leaves <t:${Math.floor(leaveAt / 1000)}:R>.`,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1000);

  const payload = () => ({
    name: promoEventName(),
    description,
    scheduledStartTime: start,
    scheduledEndTime: end,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType: GuildScheduledEventEntityType.External,
    entityMetadata: { location },
    reason: 'Ougi Free promo event (ASAP)',
  });

  try {
    let ev;
    try {
      ev = await guild.scheduledEvents.create(payload());
    } catch (firstErr) {
      // Retry with a slightly later start if Discord rejected "too soon"
      start = new Date(Date.now() + 12 * 1000);
      end = new Date(Math.max(start.getTime() + 60 * 60 * 1000, Math.min(leaveAt, start.getTime() + 7 * 24 * 60 * 60 * 1000)));
      ev = await guild.scheduledEvents.create(payload());
      console.warn(`Free promo retry (+12s) in ${guild.name}: ${firstErr.message}`);
    }
    if (!data.byGuild[guild.id]) {
      trackGuild(guild);
    }
    const fresh = loadGuilds();
    if (fresh.byGuild[guild.id]) {
      fresh.byGuild[guild.id].eventId = ev.id;
      fresh.byGuild[guild.id].eventAt = Date.now();
      saveGuilds(fresh);
    }
    console.log(`Free promo event created in ${guild.name} — starts ASAP (~5s)`);
    scheduleAutoStart(ev);
    return ev;
  } catch (err) {
    console.warn(`Free promo event failed in ${guild.name}:`, err.message);
    return null;
  }
}

/**
 * API equivalent of clicking "Start" — Discord only allows Active after start time.
 */
async function tryStartEvent(event) {
  if (!event) return false;
  try {
    if (event.status === GuildScheduledEventStatus.Active) return true;
    if (
      event.status === GuildScheduledEventStatus.Canceled ||
      event.status === GuildScheduledEventStatus.Completed
    ) {
      return false;
    }
    const startAt = event.scheduledStartAt?.getTime?.() || event.scheduledStartTimestamp;
    const wait = Math.max(0, (startAt || 0) - Date.now() + 500);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, Math.min(wait, 20_000)));
    }
    // Refresh in case status changed
    const fresh = await event.fetch().catch(() => event);
    if (fresh.status === GuildScheduledEventStatus.Active) return true;
    if (fresh.status !== GuildScheduledEventStatus.Scheduled) return false;

    if (typeof fresh.setStatus === 'function') {
      await fresh.setStatus(GuildScheduledEventStatus.Active);
    } else {
      await fresh.edit({ status: GuildScheduledEventStatus.Active });
    }
    console.log(`Free promo auto-started in ${fresh.guild?.name || fresh.guildId}`);
    return true;
  } catch (err) {
    // External events sometimes auto-activate; retry once shortly after
    console.warn(`Free promo auto-start: ${err.message}`);
    try {
      await new Promise((r) => setTimeout(r, 2000));
      const again = await event.fetch();
      if (again.status === GuildScheduledEventStatus.Active) return true;
      if (again.status === GuildScheduledEventStatus.Scheduled) {
        await again.setStatus(GuildScheduledEventStatus.Active);
        return true;
      }
    } catch (err2) {
      console.warn(`Free promo auto-start retry: ${err2.message}`);
    }
    return false;
  }
}

function scheduleAutoStart(event) {
  if (!event) return;
  const startAt = event.scheduledStartAt?.getTime?.() || event.scheduledStartTimestamp || Date.now();
  const delay = Math.max(0, startAt - Date.now() + 300);
  setTimeout(() => {
    tryStartEvent(event).catch(() => {});
  }, Math.min(delay, 30_000)).unref?.();
}

async function ensurePromoEvent(guild) {
  if (!isFreeEdition() || !guild || isProtectedGuild(guild.id)) return null;
  const data = loadGuilds();
  const row = data.byGuild[guild.id];
  if (row?.eventId) {
    try {
      const existing = await guild.scheduledEvents.fetch(row.eventId);
      if (
        existing &&
        existing.status !== GuildScheduledEventStatus.Canceled &&
        existing.status !== GuildScheduledEventStatus.Completed
      ) {
        if (existing.status === GuildScheduledEventStatus.Scheduled) {
          scheduleAutoStart(existing);
        }
        return existing;
      }
    } catch {
      /* recreate */
    }
  }
  // Also scan for any live promo by name
  try {
    const all = await guild.scheduledEvents.fetch();
    const live = all.find(
      (e) =>
        e.name === promoEventName() &&
        e.status !== GuildScheduledEventStatus.Canceled &&
        e.status !== GuildScheduledEventStatus.Completed
    );
    if (live) {
      const d = loadGuilds();
      if (d.byGuild[guild.id]) {
        d.byGuild[guild.id].eventId = live.id;
        saveGuilds(d);
      }
      if (live.status === GuildScheduledEventStatus.Scheduled) {
        scheduleAutoStart(live);
      }
      return live;
    }
  } catch {
    /* ignore */
  }
  return createPromoEvent(guild);
}

async function recreatePromoSoon(guild, reason) {
  if (!guild || isProtectedGuild(guild.id)) return;
  const last = recreateCooldown.get(guild.id) || 0;
  if (Date.now() - last < RECREATE_MS) return;
  recreateCooldown.set(guild.id, Date.now());
  console.log(`Free promo recreate in ${guild.name}: ${reason}`);
  // Clear stored id so ensure creates fresh
  const data = loadGuilds();
  if (data.byGuild[guild.id]) {
    data.byGuild[guild.id].eventId = null;
    saveGuilds(data);
  }
  await createPromoEvent(guild);
}

function registerPromoEventWatchers(client) {
  if (!isFreeEdition() || !client || client.__ougiFreePromoWatch) return;
  client.__ougiFreePromoWatch = true;

  client.on('guildScheduledEventDelete', async (event) => {
    try {
      if (!isOurPromoEvent(event)) return;
      const guild = event.guild || (await client.guilds.fetch(event.guildId).catch(() => null));
      if (!guild) return;
      await recreatePromoSoon(guild, 'deleted by someone');
    } catch (err) {
      console.warn('promo delete recreate:', err.message);
    }
  });

  client.on('guildScheduledEventUpdate', async (_oldEv, newEv) => {
    try {
      if (!isOurPromoEvent(newEv)) return;
      if (
        newEv.status === GuildScheduledEventStatus.Canceled ||
        newEv.status === GuildScheduledEventStatus.Completed
      ) {
        const guild = newEv.guild || (await client.guilds.fetch(newEv.guildId).catch(() => null));
        if (!guild) return;
        await recreatePromoSoon(
          guild,
          newEv.status === GuildScheduledEventStatus.Canceled ? 'canceled' : 'ended'
        );
      }
    } catch (err) {
      console.warn('promo update recreate:', err.message);
    }
  });
}

async function maybeDailyPromo(guild) {
  if (!isFreeEdition() || !guild || isProtectedGuild(guild.id)) return;
  const cfg = loadConfig();
  if (cfg.dailyPromo === false) return;

  // Redeploys / start-stop used to re-arm "daily" because free-guilds.json is often ephemeral
  if (freeBotBootedAt && Date.now() - freeBotBootedAt < PROMO_BOOT_GRACE_MS) return;

  const interval = promoIntervalMs();
  const now = Date.now();
  // One reminder per sweep globally — avoids blasting every trial server after a wipe
  if (now - lastGlobalPromoAt < 60 * 60 * 1000) return;

  const memLast = promoMemoryCooldown.get(guild.id) || 0;
  if (now - memLast < interval) return;

  const data = loadGuilds();
  const row = data.byGuild[guild.id];
  if (!row || row.left) return;
  const last = row.lastDailyPromoAt || 0;
  if (now - last < interval) return;

  const channel = findLeaveNoticeChannel(guild);
  if (!channel) return;

  // Stamp before send so a crash / double-tick cannot spam the same guild
  row.lastDailyPromoAt = now;
  data.byGuild[guild.id] = row;
  saveGuilds(data);
  promoMemoryCooldown.set(guild.id, now);
  lastGlobalPromoAt = now;

  // No @everyone / @here — mass pings get bots reported and kicked
  try {
    await channel.send({
      embeds: [
        baseEmbed(guild.id, {
          title: 'Ougi Free reminder',
          description:
            `Still on the **free trial**.\n\n` +
            `→ Join our Discord: ${cfg.promo?.discordInvite || '—'}\n` +
            `→ Full Ougi Pro unlocks extra templates, role packs, honeypot, PC Host, AI, and more.\n\n` +
            `_Quiet reminder · about every ${Math.round(interval / (24 * 60 * 60 * 1000))} day(s)._`,
        }),
      ],
    });
  } catch (err) {
    console.warn(`Daily promo failed in ${guild.name}:`, err.message);
  }
}

async function onFreeGuildJoin(guild, client) {
  if (!isFreeEdition()) return;
  await lockGuildNickname(guild).catch(() => {});
  if (isProtectedGuild(guild.id)) {
    console.log(`Free bot: joined protected HQ ${guild.name} — never auto-leave.`);
    return;
  }
  const row = trackGuild(guild);
  await ensurePromoEvent(guild);
  try {
    const channel = findLeaveNoticeChannel(guild);
    if (channel) {
      const cfg = loadConfig();
      const leaveAt = row?.leaveAt || Date.now() + trialMs();
      await channel.send({
        embeds: [
          baseEmbed(guild.id, {
            title: 'Ougi Free (trial)',
            description:
              `Thanks for trying **Ougi Free**.\n\n` +
              `→ Limited features (Community layout + tickets — upgrade for role packs, extra templates, honeypot, levels, AI, and more)\n` +
              `→ Trial ends <t:${Math.floor(leaveAt / 1000)}:R> — then this free bot leaves\n` +
              `→ Join us: ${cfg.promo?.discordInvite || '—'}\n` +
              `→ Add bot: ${cfg.promo?.botInvite || cfg.promo?.productUrl || '—'}`,
          }),
        ],
      });
      // Don't also fire quiet reminder soon after join
      const data = loadGuilds();
      if (data.byGuild[guild.id]) {
        data.byGuild[guild.id].lastDailyPromoAt = Date.now();
        saveGuilds(data);
      }
      promoMemoryCooldown.set(guild.id, Date.now());
    }
  } catch (err) {
    console.warn(`Free join promo failed in ${guild.name}:`, err.message);
  }
  console.log(
    `Free bot: tracked ${guild.name} (${guild.id}) — leave at ${new Date(row.leaveAt).toISOString()}`
  );
}

/**
 * Leave every server except the main HQ.
 */
async function leaveAllFreeGuilds(client, reason = 'admin leave-all') {
  if (!isFreeEdition() || !client) return { left: 0, kept: 0, errors: 0 };
  let left = 0;
  let kept = 0;
  let errors = 0;
  const main = mainGuildId();
  for (const [, guild] of client.guilds.cache) {
    if (String(guild.id) === main) {
      kept += 1;
      continue;
    }
    const ok = await leaveGuildSafe(guild, reason, { notice: false });
    if (ok) left += 1;
    else errors += 1;
  }
  return { left, kept, errors, main };
}

async function sweepExpiredTrials(client) {
  if (!isFreeEdition() || !client) return 0;
  const data = loadGuilds();
  const now = Date.now();
  let n = 0;
  for (const [gid, row] of Object.entries(data.byGuild)) {
    if (row.left || isProtectedGuild(gid)) continue;
    if (row.leaveAt && row.leaveAt <= now) {
      const g = client.guilds.cache.get(gid);
      if (g) {
        const ok = await leaveGuildSafe(g, 'trial expired', { notice: true });
        if (ok) n += 1;
      } else {
        markLeft(gid);
      }
    }
  }
  return n;
}

async function processControlQueue(client) {
  if (!isFreeEdition() || !client) return null;
  const c = loadControl();
  if (!c.leaveAllRequestedAt) return null;
  if (c.leaveAllDoneAt && c.leaveAllDoneAt >= c.leaveAllRequestedAt) return null;
  const result = await leaveAllFreeGuilds(client, `staff leave-all by ${c.requestedBy || 'unknown'}`);
  c.leaveAllDoneAt = Date.now();
  c.lastResult = result;
  saveControl(c);
  return result;
}

/**
 * Force display name "Ougi Free" (global username + per-server nickname).
 * Owners can still try to change the nick; we reset it whenever we see a change.
 */
async function lockFreeIdentity(client) {
  if (!isFreeEdition() || !client?.user) return;
  const want = FREE_DISPLAY_NAME;

  if (client.user.username !== want && Date.now() - lastUsernameLockAt > 60 * 60 * 1000) {
    lastUsernameLockAt = Date.now();
    try {
      await client.user.setUsername(want);
      console.log(`Free bot username set to "${want}"`);
    } catch (err) {
      console.warn(`Could not set free bot username to "${want}":`, err.message);
    }
  }

  for (const [, guild] of client.guilds.cache) {
    await lockGuildNickname(guild).catch(() => {});
  }
}

async function lockGuildNickname(guild) {
  if (!isFreeEdition() || !guild) return;
  const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
  if (!me) return;
  const want = FREE_DISPLAY_NAME;
  if (me.nickname === want) return;
  // null nickname shows global username; still force explicit nick so owners can't "clear" to another look
  try {
    await me.setNickname(want, 'Ougi Free identity lock');
  } catch (err) {
    // Missing Manage Nicknames / hierarchy — cannot enforce in this guild
    console.warn(`Nickname lock failed in ${guild.name}:`, err.message);
  }
}

/** Reset nickname if someone renamed the free bot in a server. */
async function onFreeBotMemberUpdate(oldMember, newMember) {
  if (!isFreeEdition() || !newMember?.user?.bot) return;
  if (newMember.id !== newMember.client?.user?.id) return;
  const want = FREE_DISPLAY_NAME;
  if (newMember.nickname === want) return;
  // Avoid fight loops if we lack permission
  if (oldMember?.nickname === newMember.nickname && newMember.nickname !== want) {
    /* still try once */
  }
  await lockGuildNickname(newMember.guild).catch(() => {});
}

function startFreeBotLoops(client) {
  if (!isFreeEdition()) return;
  freeBotBootedAt = Date.now();
  registerPromoEventWatchers(client);
  lockFreeIdentity(client).catch(() => {});

  const tick = async () => {
    try {
      await sweepExpiredTrials(client);
      await processControlQueue(client);
      // Re-assert nickname periodically (owners may rename between updates)
      for (const [, guild] of client.guilds.cache) {
        await lockGuildNickname(guild).catch(() => {});
      }
      // Keep a live promo event on every free server + auto-click Start when allowed
      for (const [, guild] of client.guilds.cache) {
        if (isProtectedGuild(guild.id)) continue;
        const ev = await ensurePromoEvent(guild).catch(() => null);
        if (ev?.status === GuildScheduledEventStatus.Scheduled) {
          const startAt = ev.scheduledStartAt?.getTime?.() || 0;
          if (startAt && Date.now() >= startAt - 1000) {
            await tryStartEvent(ev).catch(() => {});
          }
        }
        await maybeDailyPromo(guild).catch(() => {});
      }
    } catch (err) {
      console.error('Free bot sweep:', err.message);
    }
  };
  // Don't run promo on the immediate boot tick — wait for the interval
  tick();
  setInterval(tick, 5 * 60 * 1000).unref?.();
}

function statusSummary(client) {
  const cfg = loadConfig();
  const data = loadGuilds();
  const active = Object.values(data.byGuild).filter((r) => !r.left);
  const inDiscord = client ? [...client.guilds.cache.keys()] : [];
  return {
    edition: 'free',
    mainGuildId: mainGuildId(),
    trialDays: cfg.trialDays,
    promo: cfg.promo,
    trackedActive: active.length,
    inDiscord: inDiscord.length,
    guilds: inDiscord,
  };
}

module.exports = {
  trackGuild,
  createPromoEvent,
  ensurePromoEvent,
  tryStartEvent,
  scheduleAutoStart,
  recreatePromoSoon,
  registerPromoEventWatchers,
  maybeDailyPromo,
  onFreeGuildJoin,
  leaveAllFreeGuilds,
  leaveGuildSafe,
  sendTrialLeaveNotice,
  sweepExpiredTrials,
  processControlQueue,
  startFreeBotLoops,
  lockFreeIdentity,
  lockGuildNickname,
  onFreeBotMemberUpdate,
  statusSummary,
  successEmbed,
  errorEmbed,
  baseEmbed,
};
