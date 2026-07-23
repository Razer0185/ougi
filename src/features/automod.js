const { PermissionFlagsBits } = require('discord.js');

const inviteRegex = /(discord\.gg\/|discord\.com\/invite\/)/i;
const linkRegex = /https?:\/\/|www\./i;

const spamMap = new Map();

function checkAutomod(message, cfg) {
  if (!cfg.automod?.enabled) return null;
  if (message.member?.permissions?.has?.(PermissionFlagsBits.ManageMessages)) return null;

  const content = message.content || '';

  if (cfg.automod.antiInvite && inviteRegex.test(content)) {
    return 'Invite links are not allowed.';
  }
  if (cfg.automod.antiLinks && linkRegex.test(content)) {
    return 'Links are not allowed.';
  }
  if (cfg.automod.badWords?.length) {
    const lower = content.toLowerCase();
    const hit = cfg.automod.badWords.find((w) => lower.includes(w));
    if (hit) return 'That message contains a blocked word.';
  }
  if (cfg.automod.antiSpam) {
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const arr = (spamMap.get(key) || []).filter((t) => now - t < 7000);
    arr.push(now);
    spamMap.set(key, arr);
    if (arr.length >= 6) {
      return 'Slow down — spam detected.';
    }
  }
  if (cfg.automod.maxMentions && message.mentions.users.size > cfg.automod.maxMentions) {
    return 'Too many mentions.';
  }
  return null;
}

module.exports = { checkAutomod };
