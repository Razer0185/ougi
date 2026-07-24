'use strict';

const { PermissionFlagsBits } = require('discord.js');

const inviteRegex = /(discord\.gg\/|discord\.com\/invite\/)/i;
const linkRegex = /https?:\/\/|www\./i;
const emojiRegex = /<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

const spamMap = new Map();

function ensureAutomod(cfg) {
  if (!cfg.automod || typeof cfg.automod !== 'object') {
    cfg.automod = {
      enabled: false,
      antiSpam: true,
      antiInvite: true,
      antiLinks: false,
      antiCaps: false,
      antiEmoji: false,
      badWords: [],
      maxMentions: 5,
      capsPercent: 70,
      maxEmoji: 10,
      punish: 'none',
      punishDuration: '10m',
      exemptChannelIds: [],
      exemptRoleIds: [],
    };
  }
  if (cfg.automod.antiCaps == null) cfg.automod.antiCaps = false;
  if (cfg.automod.antiEmoji == null) cfg.automod.antiEmoji = false;
  if (cfg.automod.capsPercent == null) cfg.automod.capsPercent = 70;
  if (cfg.automod.maxEmoji == null) cfg.automod.maxEmoji = 10;
  if (!cfg.automod.punish) cfg.automod.punish = 'none';
  if (!cfg.automod.punishDuration) cfg.automod.punishDuration = '10m';
  if (!Array.isArray(cfg.automod.exemptChannelIds)) cfg.automod.exemptChannelIds = [];
  if (!Array.isArray(cfg.automod.exemptRoleIds)) cfg.automod.exemptRoleIds = [];
  return cfg.automod;
}

function isExempt(message, cfg) {
  const am = ensureAutomod(cfg);
  if (message.member?.permissions?.has?.(PermissionFlagsBits.ManageMessages)) return true;
  if (am.exemptChannelIds.includes(message.channel.id)) return true;
  if (message.member?.roles?.cache) {
    for (const id of am.exemptRoleIds) {
      if (message.member.roles.cache.has(id)) return true;
    }
  }
  return false;
}

function capsRatio(text) {
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 8) return 0;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length;
}

function emojiCount(text) {
  const matches = text.match(emojiRegex);
  return matches ? matches.length : 0;
}

function checkAutomod(message, cfg) {
  if (!cfg.automod?.enabled) return null;
  ensureAutomod(cfg);
  if (isExempt(message, cfg)) return null;

  const content = message.content || '';
  const am = cfg.automod;

  if (am.antiInvite && inviteRegex.test(content)) {
    return { reason: 'Invite links are not allowed.', punish: true };
  }
  if (am.antiLinks && linkRegex.test(content)) {
    return { reason: 'Links are not allowed.', punish: true };
  }
  if (am.badWords?.length) {
    const lower = content.toLowerCase();
    const hit = am.badWords.find((w) => lower.includes(w));
    if (hit) return { reason: 'That message contains a blocked word.', punish: true };
  }
  if (am.antiSpam) {
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const arr = (spamMap.get(key) || []).filter((t) => now - t < 7000);
    arr.push(now);
    spamMap.set(key, arr);
    if (arr.length >= 6) {
      return { reason: 'Slow down — spam detected.', punish: true };
    }
  }
  if (am.maxMentions && message.mentions.users.size > am.maxMentions) {
    return { reason: 'Too many mentions.', punish: true };
  }
  if (am.antiCaps && capsRatio(content) >= (am.capsPercent || 70) / 100) {
    return { reason: 'Too many capital letters.', punish: true };
  }
  if (am.antiEmoji && emojiCount(content) > (am.maxEmoji || 10)) {
    return { reason: 'Too many emojis.', punish: true };
  }
  return null;
}

module.exports = { checkAutomod, ensureAutomod, isExempt };
