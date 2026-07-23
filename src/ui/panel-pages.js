const PANEL_PAGES = [
  {
    id: 'moderation',
    title: 'Moderation',
    blurb: 'Ban, kick, mute, or warn someone.',
    buttons: [
      { id: 'ban', label: 'Ban', hint: 'remove from server' },
      { id: 'kick', label: 'Kick', hint: 'kick from server' },
      { id: 'mute', label: 'Mute', hint: 'timeout a member' },
      { id: 'warn', label: 'Warn', hint: 'give a warning' },
      { id: 'softban', label: 'Softban', hint: 'kick and wipe messages' },
    ],
  },
  {
    id: 'modtools',
    title: 'Mod Tools',
    blurb: 'Clean chat, slowmode, nicknames, and mod logs.',
    buttons: [
      { id: 'purge', label: 'Purge', hint: 'delete messages' },
      { id: 'slowmode', label: 'Slowmode', hint: 'limit how fast people chat' },
      { id: 'unmute', label: 'Unmute', hint: 'remove timeout' },
      { id: 'nick', label: 'Nickname', hint: 'change a nickname' },
      { id: 'modlog', label: 'Mod Log', hint: 'pick a log channel' },
    ],
  },
  {
    id: 'roles',
    title: 'Roles',
    blurb: 'Give roles automatically or let members pick them.',
    buttons: [
      { id: 'autorole', label: 'Autorole', hint: 'role on join' },
      { id: 'reactrole', label: 'React Roles', hint: 'react to get a role' },
      { id: 'selfrole', label: 'Self Roles', hint: 'role menu' },
      { id: 'addrole', label: 'Add Role', hint: 'give someone a role' },
      { id: 'removerole', label: 'Remove Role', hint: 'take a role away' },
    ],
  },
  {
    id: 'levels',
    title: 'Levels',
    blurb: 'XP, ranks, and level rewards.',
    buttons: [
      { id: 'leveltoggle', label: 'Toggle XP', hint: 'turn leveling on/off' },
      { id: 'rank', label: 'My Rank', hint: 'show your level' },
      { id: 'leaderboard', label: 'Leaderboard', hint: 'top members' },
      { id: 'levelannounce', label: 'Announce', hint: 'level-up channel' },
      { id: 'levelreward', label: 'Rewards', hint: 'role at a level' },
    ],
  },
  {
    id: 'tools',
    title: 'Server Tools',
    blurb: 'Lock channels, tickets, giveaways, and more.',
    buttons: [
      { id: 'lock', label: 'Lock', hint: 'lock a channel' },
      { id: 'unlock', label: 'Unlock', hint: 'unlock a channel' },
      { id: 'tickets', label: 'Tickets', hint: 'support tickets' },
      { id: 'giveaway', label: 'Giveaway', hint: 'start a giveaway' },
      { id: 'nuke', label: 'Nuke', hint: 'wipe a channel' },
    ],
  },
  {
    id: 'logging',
    title: 'Logging & Autos',
    blurb: 'Logs, auto-replies, sticky messages, starboard.',
    buttons: [
      { id: 'serverlog', label: 'Server Log', hint: 'pick a log channel' },
      { id: 'autoresponder', label: 'Autorespond', hint: 'auto reply to words' },
      { id: 'sticky', label: 'Sticky', hint: 'message that stays at bottom' },
      { id: 'starboard', label: 'Starboard', hint: 'starred messages' },
      { id: 'announce', label: 'Announce', hint: 'post an announcement' },
    ],
  },
  {
    id: 'setup',
    title: 'Setup',
    blurb: 'Templates, channels, events, welcomes, voice hubs.',
    buttons: [
      { id: 'templates', label: 'Templates', hint: 'build channels/roles' },
      { id: 'channels', label: 'Channels', hint: 'edit a channel' },
      { id: 'event', label: 'Event', hint: 'schedule an event' },
      { id: 'welcome', label: 'Welcome', hint: 'welcome new members' },
      { id: 'jtc', label: 'Join Create', hint: 'temp voice rooms' },
    ],
  },
  {
    id: 'utility',
    title: 'Utility',
    blurb: 'Polls, reminders, embeds, AFK, and help.',
    buttons: [
      { id: 'poll', label: 'Poll', hint: 'make a poll' },
      { id: 'remind', label: 'Remind', hint: 'set a reminder' },
      { id: 'embed', label: 'Embed', hint: 'build an embed' },
      { id: 'afk', label: 'AFK', hint: 'set AFK status' },
      { id: 'help', label: 'Help', hint: 'command list' },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    blurb: 'Prefix, theme, automod, invites, and custom commands.',
    buttons: [
      { id: 'settings', label: 'Prefix', hint: 'change . to ! etc' },
      { id: 'interfaces', label: 'Theme', hint: 'change colors' },
      { id: 'automod', label: 'AutoMod', hint: 'spam/link filters' },
      { id: 'invites', label: 'Invite Perms', hint: 'who can invite' },
      { id: 'customcmd', label: 'Custom Cmd', hint: 'make your own commands' },
    ],
  },
];

module.exports = { PANEL_PAGES };
