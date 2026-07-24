'use strict';

/**
 * Free-bot owner commands (only when OUGI_EDITION=free).
 * Use in your HQ server: 1521568250473873438
 *
 *   .free status
 *   .free leaveall
 *   .free trial <days>
 *   .free promo <discordInvite> | <productUrl>
 */

const { PermissionFlagsBits } = require('discord.js');
const {
  isFreeEdition,
  loadConfig,
  saveConfig,
  mainGuildId,
  isProtectedGuild,
  requestLeaveAll,
  loadControl,
  saveControl,
} = require('../utils/edition');
const {
  leaveAllFreeGuilds,
  statusSummary,
  successEmbed,
  errorEmbed,
  baseEmbed,
} = require('../features/free-bot');
const { memberHasAdmin } = require('../utils/helpers');

function allowedHere(message) {
  if (!isFreeEdition()) return false;
  if (!message.guild) return false;
  if (isProtectedGuild(message.guild.id)) return true;
  // Also allow bot application owner in DMs? require guild HQ
  return false;
}

function isStaff(member) {
  return memberHasAdmin(member) || member.permissions?.has(PermissionFlagsBits.Administrator);
}

async function execute(message, args) {
  if (!isFreeEdition()) {
    return message.reply({
      embeds: [errorEmbed(message.guild.id, 'Free', 'This command only exists on the free bot.')],
    });
  }
  if (!allowedHere(message)) {
    return message.reply({
      embeds: [
        errorEmbed(
          message.guild.id,
          'Free Admin',
          `Run this in your HQ server only (\`${mainGuildId()}\`).`
        ),
      ],
    });
  }
  if (!isStaff(message.member)) {
    return message.reply({
      embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')],
    });
  }

  const sub = (args[0] || 'status').toLowerCase();

  if (sub === 'status') {
    const s = statusSummary(message.client);
    const cfg = loadConfig();
    return message.reply({
      embeds: [
        baseEmbed(message.guild.id, {
          title: 'Ougi Free — status',
          description:
            `→ __**Servers**__ — **${s.inDiscord}** (tracked active: ${s.trackedActive})\n` +
            `→ __**Trial**__ — **${cfg.trialDays}** day(s)\n` +
            `→ __**HQ (never leave)**__ — \`${s.mainGuildId}\`\n` +
            `→ __**Discord invite**__ — ${cfg.promo?.discordInvite || '—'}\n` +
            `→ __**Bot invite**__ — ${cfg.promo?.botInvite || cfg.promo?.productUrl || '—'}\n\n` +
            `\`.free leaveall\` · \`.free trial 3\` · \`.free promo <invite> | <url>\``,
        }),
      ],
    });
  }

  if (sub === 'leaveall') {
    await message.reply({
      embeds: [
        baseEmbed(message.guild.id, {
          title: 'Leaving free servers…',
          description: `Keeping HQ \`${mainGuildId()}\`. This may take a moment.`,
        }),
      ],
    });
    // Mark request + done so processControlQueue does not leave-all a second time
    requestLeaveAll(message.author.tag);
    const result = await leaveAllFreeGuilds(message.client, `manual by ${message.author.tag}`);
    const control = loadControl();
    control.leaveAllDoneAt = Date.now();
    control.lastResult = result;
    saveControl(control);
    return message.channel.send({
      embeds: [
        successEmbed(
          message.guild.id,
          'Leave-all done',
          `Left **${result.left}** server(s).\nKept HQ: **${result.kept}**\nErrors: **${result.errors}**`
        ),
      ],
    });
  }

  if (sub === 'trial') {
    const days = Number(args[1]);
    if (!Number.isFinite(days) || days < 1 || days > 30) {
      return message.reply({
        embeds: [errorEmbed(message.guild.id, 'Trial', 'Usage: `.free trial <1-30>`')],
      });
    }
    const cfg = loadConfig();
    cfg.trialDays = Math.floor(days);
    saveConfig(cfg);
    return message.reply({
      embeds: [
        successEmbed(
          message.guild.id,
          'Trial updated',
          `New free servers get **${cfg.trialDays}** day(s). Existing timers stay as scheduled.`
        ),
      ],
    });
  }

  if (sub === 'promo') {
    const rest = args.slice(1).join(' ');
    const parts = rest.split('|').map((s) => s.trim());
    if (!parts[0]) {
      return message.reply({
        embeds: [
          errorEmbed(
            message.guild.id,
            'Promo',
            'Usage: `.free promo https://discord.gg/xxx | https://yoursite.com`'
          ),
        ],
      });
    }
    const cfg = loadConfig();
    cfg.promo = cfg.promo || {};
    cfg.promo.discordInvite = parts[0];
    if (parts[1]) cfg.promo.productUrl = parts[1];
    saveConfig(cfg);
    return message.reply({
      embeds: [
        successEmbed(
          message.guild.id,
          'Promo updated',
          `Discord: ${cfg.promo.discordInvite}\nSite: ${cfg.promo.productUrl || '—'}`
        ),
      ],
    });
  }

  return message.reply({
    embeds: [
      errorEmbed(
        message.guild.id,
        'Free Admin',
        'Usage: `.free status` · `.free leaveall` · `.free trial 3` · `.free promo <invite> | <url>`'
      ),
    ],
  });
}

module.exports = { execute };
