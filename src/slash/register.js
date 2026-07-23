const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

function buildSlashCommands() {
  return [
    new SlashCommandBuilder().setName('help').setDescription('Show Ougi help pages'),
    new SlashCommandBuilder().setName('ping').setDescription('Check bot latency'),
    new SlashCommandBuilder()
      .setName('invite')
      .setDescription('Get the link to add Ougi to another server'),
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Create / refresh the Ougi control panel')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('panel')
      .setDescription('Show / refresh the control panel')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('lock')
      .setDescription('Lock a channel')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to lock (or pick from menu)')
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.GuildVoice,
            ChannelType.GuildForum
          )
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('Unlock a channel')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to unlock')
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.GuildVoice,
            ChannelType.GuildForum
          )
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder()
      .setName('nuke')
      .setDescription('Wipe all messages in this channel (or pick one from the panel)')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Only needed when running from the panel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a member')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason'))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a member')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason'))
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    new SlashCommandBuilder()
      .setName('mute')
      .setDescription('Timeout / mute a member')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 1h, 1d'))
      .addStringOption((o) => o.setName('reason').setDescription('Reason'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder()
      .setName('unmute')
      .setDescription('Remove timeout / mute')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder()
      .setName('nick')
      .setDescription('Change a member nickname')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('nickname').setDescription('New nickname').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),
    new SlashCommandBuilder()
      .setName('event')
      .setDescription('Create a server event')
      .addStringOption((o) => o.setName('title').setDescription('Event title').setRequired(true))
      .addStringOption((o) => o.setName('description').setDescription('Description').setRequired(true))
      .addStringOption((o) =>
        o.setName('when').setDescription('now  OR  hours from now (e.g. 24)')
      )
      .addStringOption((o) => o.setName('location').setDescription('Location / type'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
    new SlashCommandBuilder()
      .setName('prefix')
      .setDescription('Set the text command prefix')
      .addStringOption((o) => o.setName('symbol').setDescription('e.g. . / ! ,').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('theme')
      .setDescription('Set interface theme color')
      .addStringOption((o) =>
        o
          .setName('color')
          .setDescription('Theme color')
          .setRequired(true)
          .addChoices(
            { name: 'Red', value: 'red' },
            { name: 'Black', value: 'black' },
            { name: 'White', value: 'white' },
            { name: 'Pink', value: 'pink' },
            { name: 'Blue', value: 'blue' },
            { name: 'Purple', value: 'purple' },
            { name: 'Green', value: 'green' },
            { name: 'Orange', value: 'orange' },
            { name: 'Cyan', value: 'cyan' },
            { name: 'Gold', value: 'gold' }
          )
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('invites')
      .setDescription('Invite tracker')
      .addUserOption((o) => o.setName('user').setDescription('Check this user'))
      .addStringOption((o) =>
        o
          .setName('action')
          .setDescription('top / on / off')
          .addChoices(
            { name: 'Leaderboard', value: 'top' },
            { name: 'Enable', value: 'on' },
            { name: 'Disable', value: 'off' }
          )
      ),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Show server info'),
    new SlashCommandBuilder()
      .setName('userinfo')
      .setDescription('Show user info')
      .addUserOption((o) => o.setName('user').setDescription('User to inspect')),
    new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Start a reaction giveaway')
      .addStringOption((o) => o.setName('prize').setDescription('What people win').setRequired(true))
      .addStringOption((o) =>
        o.setName('duration').setDescription('e.g. 10m, 1h, 1d').setRequired(true)
      )
      .addIntegerOption((o) =>
        o.setName('winners').setDescription('Number of winners (default 1)').setMinValue(1).setMaxValue(20)
      )
      .addIntegerOption((o) =>
        o
          .setName('max_entries')
          .setDescription('Max people who can join (omit = unlimited)')
          .setMinValue(1)
      )
      .addStringOption((o) =>
        o
          .setName('require_server')
          .setDescription('Must be in this server (invite link or server ID)')
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder()
      .setName('gend')
      .setDescription('End a giveaway early')
      .addStringOption((o) => o.setName('message_id').setDescription('Giveaway message ID'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder()
      .setName('greroll')
      .setDescription('Reroll an ended giveaway')
      .addStringOption((o) => o.setName('message_id').setDescription('Giveaway message ID'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Warn a member')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    new SlashCommandBuilder()
      .setName('warnings')
      .setDescription('View warnings for a member')
      .addUserOption((o) => o.setName('user').setDescription('Member')),
    new SlashCommandBuilder()
      .setName('softban')
      .setDescription('Softban a member (wipe messages)')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason'))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    new SlashCommandBuilder()
      .setName('purge')
      .setDescription('Bulk delete messages')
      .addIntegerOption((o) =>
        o.setName('amount').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100)
      )
      .addUserOption((o) => o.setName('user').setDescription('Only delete from this user'))
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to purge')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder()
      .setName('slowmode')
      .setDescription('Set channel slowmode')
      .addIntegerOption((o) =>
        o.setName('seconds').setDescription('0-21600').setRequired(true).setMinValue(0).setMaxValue(21600)
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    new SlashCommandBuilder()
      .setName('modlog')
      .setDescription('Set moderation log channel')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Log channel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('rank')
      .setDescription('Show level rank')
      .addUserOption((o) => o.setName('user').setDescription('User')),
    new SlashCommandBuilder().setName('levels').setDescription('XP leaderboard'),
    new SlashCommandBuilder()
      .setName('leveling')
      .setDescription('Toggle or configure leveling')
      .addStringOption((o) =>
        o
          .setName('action')
          .setDescription('on / off')
          .addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })
      )
      .addChannelOption((o) =>
        o
          .setName('announce_channel')
          .setDescription('Level-up channel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
      .setName('poll')
      .setDescription('Create a poll')
      .addStringOption((o) => o.setName('question').setDescription('Question').setRequired(true))
      .addStringOption((o) => o.setName('options').setDescription('A | B | C').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    new SlashCommandBuilder()
      .setName('remind')
      .setDescription('Set a reminder')
      .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 1h').setRequired(true))
      .addStringOption((o) => o.setName('text').setDescription('Reminder text').setRequired(true)),
    new SlashCommandBuilder()
      .setName('afk')
      .setDescription('Set AFK status')
      .addStringOption((o) => o.setName('reason').setDescription('AFK reason')),
    new SlashCommandBuilder()
      .setName('serverlog')
      .setDescription('Set server audit log channel')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Log channel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ].map((c) => c.toJSON());
}

async function registerSlashCommands(client) {
  const rest = new REST({ version: '10' }).setToken(client.token);
  const body = buildSlashCommands();

  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body });
    console.log('Global slash commands submitted.');
  } catch (err) {
    console.error('Global slash register failed:', err.message);
  }

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body });
      console.log(`Slash commands ready in ${guild.name}`);
    } catch (err) {
      console.error(`Slash register failed for ${guild.name}:`, err.message);
    }
  }
}

module.exports = { buildSlashCommands, registerSlashCommands };
