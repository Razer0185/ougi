'use strict';

/**
 * Member reports → mod log / report channel.
 */

const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');

function ensureReports(cfg) {
  if (!cfg.reports || typeof cfg.reports !== 'object') {
    cfg.reports = {
      enabled: true,
      channelId: null,
      cooldownMs: 60_000,
    };
  }
  return cfg.reports;
}

const lastReport = new Map(); // guildId:userId -> ts

async function submitReport(guild, { reporter, target, reason, evidenceUrl }) {
  const cfg = loadGuild(guild.id);
  const r = ensureReports(cfg);
  if (!r.enabled) throw new Error('Reports are disabled.');

  const key = `${guild.id}:${reporter.id}`;
  const now = Date.now();
  if (now - (lastReport.get(key) || 0) < (r.cooldownMs || 60_000)) {
    throw new Error('Slow down — you already sent a report recently.');
  }
  lastReport.set(key, now);

  const channelId = r.channelId || cfg.moderation?.modLogChannelId || cfg.logging?.channelId;
  if (!channelId) {
    throw new Error('No report channel set. Admin: `report channel #mod-log`');
  }
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased?.()) throw new Error('Report channel missing.');

  const embed = baseEmbed(guild.id, {
    title: 'Member Report',
    description: [
      `→ __**Reporter:**__ ${reporter} (\`${reporter.id}\`)`,
      `→ __**Target:**__ ${target} (\`${target.id}\`)`,
      `→ __**Reason:**__ ${reason.slice(0, 1000)}`,
      evidenceUrl ? `→ __**Evidence:**__ ${evidenceUrl}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    thumbnail: target.user?.displayAvatarURL?.({ size: 128 }) || target.displayAvatarURL?.({ size: 128 }),
    footer: 'Report',
  });

  await channel.send({
    content: cfg.roles?.modPingRoleId ? `<@&${cfg.roles.modPingRoleId}>` : undefined,
    embeds: [embed],
  });
  return true;
}

function setReportChannel(guildId, channelId) {
  const cfg = loadGuild(guildId);
  const r = ensureReports(cfg);
  r.channelId = channelId;
  r.enabled = true;
  saveGuild(guildId, cfg);
  return r;
}

module.exports = {
  ensureReports,
  submitReport,
  setReportChannel,
  successEmbed,
  errorEmbed,
  baseEmbed,
};
