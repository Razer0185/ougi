const HELP_PAGES = [
  {
    title: 'Moderation',
    body:
      '→ __**ban**__ `@user [0-7] [reason]` — optional wipe days\n' +
      '→ __**tempban**__ `@user 7d [reason]` · __**kick**__ / __**mute**__ / __**unmute**__ / __**unban**__ / __**nick**__\n' +
      '→ __**warn**__ `@user [reason]` · __**warnings**__ · __**clearwarns**__\n' +
      '→ __**cases**__ `@user` · `cases <id>` · `cases note|reason|delete <id>`\n' +
      '→ __**warnladder**__ — auto mute/kick/ban after warns\n' +
      '→ __**softban**__ `@user [reason]` — wipe messages via ban+unban\n' +
      '→ __**purge**__ `<count> [bots|embeds|links|files|contains:text] [@user]`\n' +
      '→ __**slowmode**__ · __**modlog**__ · __**lockdown on|off**__\n' +
      '→ __**snipe**__ / __**editsnipe**__ — recover deleted/edited msgs\n' +
      '→ __**report**__ `@user reason` · `report channel #mods`\n' +
      '→ __**lock**__ / __**unlock**__ / __**nuke**__ — channel tools',
  },
  {
    title: 'Roles',
    body:
      '→ __**autorole**__ `@Role` · `autorole clear`\n' +
      '→ __**addrole**__ / __**removerole**__ `@user @role`\n' +
      '→ __**reactionrole**__ `👍 @Role | 🔥 @Other`\n' +
      '→ __**selfrole add**__ `@Role` · __**selfrole post**__ · __**selfrole clear**__\n' +
      '→ __**temprole**__ `@user @Role 1h`',
  },
  {
    title: 'Levels',
    body:
      '→ __**rank**__ `[user]` — image rank card\n' +
      '→ __**levels**__ — XP leaderboard\n' +
      '→ __**levels on|off**__ — toggle XP\n' +
      '→ __**levels voice on|off**__ — voice XP\n' +
      '→ __**levels announce**__ `#channel`\n' +
      '→ __**levels reward**__ `<level> @Role`\n' +
      '→ __**levels blacklist**__ `#channel` · `unblacklist`\n' +
      '→ __**levels setxp**__ `@user <amount>` · `levels reset @user`',
  },
  {
    title: 'Logging & Autos',
    body:
      '→ __**serverlog**__ `#channel` — delete/edit/join/leave logs\n' +
      '→ __**autorespond add**__ `trigger | reply`\n' +
      '→ __**sticky**__ `<text>` · __**sticky clear**__\n' +
      '→ __**starboard**__ `#channel [threshold]` · `starboard off`\n' +
      '→ __**honeypot**__ — panel → Logging · decoy channel (kick/softban/ban/mute)\n' +
      '→ __**antiraid**__ `on|off|joins|action|exempt|unlock` — join flood\n' +
      '→ __**automod**__ — spam/invites/links/caps/emoji/mentions\n' +
      '→ __**automod punish**__ `none|mute|warn` · `exempt channel|role`\n' +
      '→ Logs also: nicknames · channel create/delete/update',
  },
  {
    title: 'Utility',
    body:
      '→ __**poll**__ `Q | A | B`\n' +
      '→ __**remind**__ `1h text`\n' +
      '→ __**embed**__ `Title | Desc | [image]`\n' +
      '→ __**afk**__ `[reason]` · `afk clear`\n' +
      '→ __**cc add|remove|list**__ — custom commands (vars + embeds)\n' +
      '→ __**suggest**__ `<idea>` · `suggest setup #channel`\n' +
      '→ __**schedule add**__ `1h #ch Title | msg`\n' +
      '→ __**giveaway**__ `prize | time | winners | max | server`',
  },
  {
    title: 'Server Tools',
    body:
      '→ __**setup**__ / __**panel**__ — control panel in ✨・ougi\n' +
      '→ __**announce**__ · __**event**__ · __**welcome**__ · __**goodbye**__\n' +
      '→ __**verify**__ · __**jtc**__ · __**invites**__ · __**template**__\n' +
      '→ __**ticketpanel**__ · __**ticketbuyer**__ · __**ticketclose**__ (saves transcript)\n' +
      '→ Web: **Dashboard** on the Ougi site to configure without Discord',
  },
  {
    title: 'Settings & Panel',
    body:
      '→ __**prefix**__ · __**theme**__ / __**interfaces**__\n' +
      '→ __**ask**__ · __**askbuild**__ (AI custom channels)\n' +
      '→ __**botname**__ · __**avatar**__\n' +
      '→ __**help**__ · __**ping**__ · __**serverinfo**__ · __**userinfo**__\n' +
      '→ **✨・ougi** has major actions as buttons (Administrator only)',
  },
];

module.exports = { HELP_PAGES };
