const {
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ChannelSelectMenuBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { baseEmbed, successEmbed, errorEmbed, rulesStyleList } = require('../utils/embeds');
const { modal, accentStyle } = require('../ui/components');

function channelPickRow() {
  return new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('channedit:pick')
      .setPlaceholder('Select a channel · or use #name in commands')
      .addChannelTypes(
        ChannelType.GuildText,
        ChannelType.GuildVoice,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildForum,
        ChannelType.GuildStageVoice,
        ChannelType.GuildCategory
      )
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function typeLabel(channel) {
  const map = {
    [ChannelType.GuildText]: 'Text',
    [ChannelType.GuildVoice]: 'Voice',
    [ChannelType.GuildAnnouncement]: 'Announcement',
    [ChannelType.GuildForum]: 'Forum',
    [ChannelType.GuildStageVoice]: 'Stage',
    [ChannelType.GuildCategory]: 'Category',
  };
  return map[channel.type] || 'Channel';
}

function settingsEmbed(guildId, channel) {
  const lines = [
    { label: 'Name', text: channel.name },
    { label: 'Type', text: typeLabel(channel) },
    { label: 'ID', text: channel.id },
    { label: 'Category', text: channel.parent ? channel.parent.name : 'None' },
  ];

  if (channel.topic !== undefined && channel.topic !== null) {
    lines.push({ label: 'Topic', text: channel.topic || '_empty_' });
  }
  if (typeof channel.nsfw === 'boolean') {
    lines.push({ label: 'NSFW', text: channel.nsfw ? 'Yes' : 'No' });
  }
  if (typeof channel.rateLimitPerUser === 'number') {
    lines.push({ label: 'Slowmode', text: `${channel.rateLimitPerUser}s` });
  }
  if (typeof channel.bitrate === 'number') {
    lines.push({ label: 'Bitrate', text: `${Math.round(channel.bitrate / 1000)}kbps` });
  }
  if (typeof channel.userLimit === 'number') {
    lines.push({ label: 'User limit', text: channel.userLimit === 0 ? 'Unlimited' : String(channel.userLimit) });
  }
  if (channel.rtcRegion !== undefined) {
    lines.push({ label: 'Region', text: channel.rtcRegion || 'Automatic' });
  }

  const everyone = channel.permissionOverwrites?.cache?.get(channel.guild.roles.everyone.id);
  if (everyone) {
    const send = everyone.deny.has(PermissionFlagsBits.SendMessages);
    const view = everyone.deny.has(PermissionFlagsBits.ViewChannel);
    const connect = everyone.deny.has(PermissionFlagsBits.Connect);
    lines.push({
      label: '@everyone',
      text: [
        view ? 'hidden' : 'visible',
        send ? 'locked' : 'can send',
        connect ? 'no connect' : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }

  return baseEmbed(guildId, {
    title: `Channel Settings · #${channel.name}`,
    description: rulesStyleList(lines) + '\n\nUse the buttons below to change settings.',
    footer: `${typeLabel(channel)} · click a control to edit`,
  });
}

function settingsButtons(channelId, channel, guildId) {
  const style = accentStyle(guildId);
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`channedit:rename:${channelId}`)
        .setLabel('Rename')
        .setStyle(style),
      new ButtonBuilder()
        .setCustomId(`channedit:topic:${channelId}`)
        .setLabel('Topic')
        .setStyle(style)
        .setDisabled(
          ![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(
            channel.type
          )
        ),
      new ButtonBuilder()
        .setCustomId(`channedit:slowmode:${channelId}`)
        .setLabel('Slowmode')
        .setStyle(style)
        .setDisabled(
          ![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(
            channel.type
          )
        ),
      new ButtonBuilder()
        .setCustomId(`channedit:nsfw:${channelId}`)
        .setLabel('NSFW')
        .setStyle(style)
        .setDisabled(
          ![
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.GuildForum,
            ChannelType.GuildVoice,
          ].includes(channel.type)
        )
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`channedit:limit:${channelId}`)
        .setLabel('User Limit')
        .setStyle(style)
        .setDisabled(![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)),
      new ButtonBuilder()
        .setCustomId(`channedit:bitrate:${channelId}`)
        .setLabel('Bitrate')
        .setStyle(style)
        .setDisabled(channel.type !== ChannelType.GuildVoice),
      new ButtonBuilder()
        .setCustomId(`channedit:lock:${channelId}`)
        .setLabel('Lock')
        .setStyle(style),
      new ButtonBuilder()
        .setCustomId(`channedit:unlock:${channelId}`)
        .setLabel('Unlock')
        .setStyle(style),
      new ButtonBuilder()
        .setCustomId(`channedit:refresh:${channelId}`)
        .setLabel('Refresh')
        .setStyle(style)
    ),
  ];
  return rows;
}

function channelSettingsPayload(guildId, channel) {
  return {
    embeds: [settingsEmbed(guildId, channel)],
    components: settingsButtons(channel.id, channel, guildId),
  };
}

async function handleChannelEditButton(interaction, requireMod) {
  const parts = interaction.customId.split(':');
  if (parts[0] !== 'channedit') return false;
  const action = parts[1];
  const channelId = parts[2];

  if (action === 'pick') return false; // select menu

  if (!(await requireMod(interaction))) return true;

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    await interaction.reply({
      embeds: [errorEmbed(interaction.guild.id, 'Channels', 'Channel not found.')],
      ephemeral: true,
    });
    return true;
  }

  if (action === 'refresh') {
    return interaction.update(channelSettingsPayload(interaction.guild.id, channel));
  }

  if (action === 'nsfw') {
    if (typeof channel.setNSFW === 'function') {
      await channel.setNSFW(!channel.nsfw, `Toggled by ${interaction.user.tag}`);
      const fresh = await interaction.guild.channels.fetch(channelId);
      await interaction.update(channelSettingsPayload(interaction.guild.id, fresh));
      return true;
    }
  }

  if (action === 'lock') {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      SendMessages: false,
      AddReactions: false,
      Connect: false,
      Speak: false,
    });
    const fresh = await interaction.guild.channels.fetch(channelId);
    await interaction.update(channelSettingsPayload(interaction.guild.id, fresh));
    return true;
  }

  if (action === 'unlock') {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      SendMessages: null,
      AddReactions: null,
      Connect: null,
      Speak: null,
    });
    const fresh = await interaction.guild.channels.fetch(channelId);
    await interaction.update(channelSettingsPayload(interaction.guild.id, fresh));
    return true;
  }

  if (action === 'rename') {
    await interaction.showModal(
      modal(`channedit:modal:rename:${channelId}`, 'Rename Channel', [
        { id: 'value', label: 'New channel name', value: channel.name, max: 100 },
      ])
    );
    return true;
  }
  if (action === 'topic') {
    await interaction.showModal(
      modal(`channedit:modal:topic:${channelId}`, 'Edit Topic', [
        {
          id: 'value',
          label: 'Channel topic',
          style: 'long',
          value: (channel.topic || '').slice(0, 1024),
          required: false,
          max: 1024,
        },
      ])
    );
    return true;
  }
  if (action === 'slowmode') {
    await interaction.showModal(
      modal(`channedit:modal:slowmode:${channelId}`, 'Slowmode (seconds)', [
        {
          id: 'value',
          label: 'Seconds (0–21600)',
          value: String(channel.rateLimitPerUser || 0),
          max: 5,
        },
      ])
    );
    return true;
  }
  if (action === 'limit') {
    await interaction.showModal(
      modal(`channedit:modal:limit:${channelId}`, 'Voice User Limit', [
        {
          id: 'value',
          label: 'Limit (0 = unlimited)',
          value: String(channel.userLimit || 0),
          max: 3,
        },
      ])
    );
    return true;
  }
  if (action === 'bitrate') {
    await interaction.showModal(
      modal(`channedit:modal:bitrate:${channelId}`, 'Bitrate (kbps)', [
        {
          id: 'value',
          label: 'Bitrate kbps (8–384)',
          value: String(Math.round((channel.bitrate || 64000) / 1000)),
          max: 3,
        },
      ])
    );
    return true;
  }

  return true;
}

async function handleChannelEditModal(interaction, requireMod) {
  if (!interaction.customId.startsWith('channedit:modal:')) return false;
  if (!(await requireMod(interaction))) return true;

  const parts = interaction.customId.split(':');
  // channedit:modal:rename:channelId
  const action = parts[2];
  const channelId = parts[3];
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    await interaction.reply({
      embeds: [errorEmbed(interaction.guild.id, 'Channels', 'Channel not found.')],
      ephemeral: true,
    });
    return true;
  }

  const value = interaction.fields.getTextInputValue('value');

  try {
    if (action === 'rename') {
      await channel.setName(value.slice(0, 100), `Renamed by ${interaction.user.tag}`);
    } else if (action === 'topic') {
      await channel.setTopic(value.slice(0, 1024), `Topic by ${interaction.user.tag}`);
    } else if (action === 'slowmode') {
      const secs = Math.max(0, Math.min(21600, Number(value) || 0));
      await channel.setRateLimitPerUser(secs, `Slowmode by ${interaction.user.tag}`);
    } else if (action === 'limit') {
      const limit = Math.max(0, Math.min(99, Number(value) || 0));
      await channel.setUserLimit(limit, `Limit by ${interaction.user.tag}`);
    } else if (action === 'bitrate') {
      const kbps = Math.max(8, Math.min(384, Number(value) || 64));
      await channel.setBitrate(kbps * 1000, `Bitrate by ${interaction.user.tag}`);
    }

    const fresh = await interaction.guild.channels.fetch(channelId);
    const payload = channelSettingsPayload(interaction.guild.id, fresh);
    await interaction.reply({
      content: '✅ Channel settings updated.',
      embeds: payload.embeds,
      components: payload.components,
      ephemeral: true,
    });
  } catch (err) {
    await interaction.reply({
      embeds: [errorEmbed(interaction.guild.id, 'Channel Edit', String(err.message || err))],
      ephemeral: true,
    });
  }
  return true;
}

module.exports = {
  channelPickRow,
  channelSettingsPayload,
  settingsEmbed,
  handleChannelEditButton,
  handleChannelEditModal,
};
