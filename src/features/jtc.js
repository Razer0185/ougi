const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { loadGuild, saveGuild } = require('../utils/store');

async function setupJtc(guild, categoryName = 'JOIN TO CREATE') {
  const cfg = loadGuild(guild.id);
  let category = cfg.jtc.categoryId && guild.channels.cache.get(cfg.jtc.categoryId);
  if (!category) {
    category = await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
      reason: 'Ougi join-to-create',
    });
  }
  let hub = cfg.jtc.hubChannelId && guild.channels.cache.get(cfg.jtc.hubChannelId);
  if (!hub) {
    hub = await guild.channels.create({
      name: '➕ Join to Create',
      type: ChannelType.GuildVoice,
      parent: category.id,
      reason: 'Ougi join-to-create hub',
    });
  }
  cfg.jtc.enabled = true;
  cfg.jtc.categoryId = category.id;
  cfg.jtc.hubChannelId = hub.id;
  cfg.jtc.tempChannels = cfg.jtc.tempChannels || {};
  saveGuild(guild.id, cfg);
  return { category, hub };
}

function statusToName(member) {
  const custom = member.presence?.activities?.find((a) => a.type === 4);
  const name = custom?.state?.trim();
  if (name && name.length > 0) {
    return name.slice(0, 100);
  }
  return `${member.displayName}'s Call`.slice(0, 100);
}

async function handleVoiceState(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;
  const cfg = loadGuild(guild.id);
  if (!cfg.jtc?.enabled || !cfg.jtc.hubChannelId) return;

  // Joined hub → create temp channel
  if (newState.channelId === cfg.jtc.hubChannelId) {
    const member = newState.member;
    const channelName = statusToName(member);
    const temp = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      parent: cfg.jtc.categoryId || undefined,
      permissionOverwrites: [
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.MuteMembers,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
          ],
        },
      ],
      reason: 'Ougi temp voice',
    });
    cfg.jtc.tempChannels[temp.id] = { ownerId: member.id };
    saveGuild(guild.id, cfg);
    await member.voice.setChannel(temp).catch(() => {});
  }

  // Left a temp channel → delete if empty
  const leftId = oldState.channelId;
  if (leftId && cfg.jtc.tempChannels?.[leftId] && leftId !== cfg.jtc.hubChannelId) {
    const channel = guild.channels.cache.get(leftId);
    if (channel && channel.members.size === 0) {
      delete cfg.jtc.tempChannels[leftId];
      saveGuild(guild.id, cfg);
      await channel.delete('Empty temp voice').catch(() => {});
    }
  }
}

module.exports = { setupJtc, handleVoiceState, statusToName };
