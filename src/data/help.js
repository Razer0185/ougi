const HELP_PAGES = [
  {
    title: 'Moderation',
    body:
      '→ __**ban**__ / __**kick**__ / __**mute**__ / __**unmute**__ / __**nick**__\n' +
      '→ __**warn**__ `@user [reason]` · __**warnings**__ · __**clearwarns**__\n' +
      '→ __**softban**__ `@user [reason]` — wipe messages via ban+unban\n' +
      '→ __**purge**__ / __**clear**__ `[#channel] <count> [@user]`\n' +
      '→ __**slowmode**__ `[#channel] <seconds>`\n' +
      '→ __**modlog**__ `#channel` — moderation case logs\n' +
      '→ __**lock**__ / __**unlock**__ / __**nuke**__ — channel tools',
  },
  {
    title: 'Roles',
    body:
      '→ __**autorole**__ `@Role` · `autorole clear`\n' +
      '→ __**addrole**__ / __**removerole**__ `@user @role`\n' +
      '→ __**reactionrole**__ `👍 @Role | 🔥 @Other`\n' +
      '→ __**selfrole add**__ `@Role` · __**selfrole post**__ · __**selfrole clear**__',
  },
  {
    title: 'Levels',
    body:
      '→ __**rank**__ `[user]` — your level card\n' +
      '→ __**levels**__ — XP leaderboard\n' +
      '→ __**levels on|off**__ — toggle XP\n' +
      '→ __**levels announce**__ `#channel`\n' +
      '→ __**levels reward**__ `<level> @Role`',
  },
  {
    title: 'Logging & Autos',
    body:
      '→ __**serverlog**__ `#channel` — delete/edit/join/leave logs\n' +
      '→ __**autorespond add**__ `trigger | reply`\n' +
      '→ __**sticky**__ `<text>` · __**sticky clear**__\n' +
      '→ __**starboard**__ `#channel [threshold]` · `starboard off`',
  },
  {
    title: 'Utility',
    body:
      '→ __**poll**__ `Q | A | B`\n' +
      '→ __**remind**__ `1h text`\n' +
      '→ __**embed**__ `Title | Desc | [image]`\n' +
      '→ __**afk**__ `[reason]` · `afk clear`\n' +
      '→ __**cc add|remove|list**__ — custom commands\n' +
      '→ __**giveaway**__ `prize | time | winners | max | server`',
  },
  {
    title: 'Server Tools',
    body:
      '→ __**setup**__ / __**panel**__ — create or refresh the control panel\n' +
      '→ Panel lives in `╭─── Ougi ✨ ˅` → `✨・ougi` (admins only)\n' +
      '→ __**announce**__ `[#channel] message`\n' +
      '→ __**event**__ · __**welcome**__ · __**jtc**__\n' +
      '→ __**invites**__ · __**template**__ · __**channels**__ · __**automod**__\n' +
      '→ __**ticketpanel**__ · __**ticketclose**__',
  },
  {
    title: 'Settings & Panel',
    body:
      '→ __**prefix**__ · __**theme**__ / __**interfaces**__\n' +
      '→ __**botname**__ · __**avatar**__\n' +
      '→ __**help**__ · __**ping**__ · __**serverinfo**__ · __**userinfo**__\n' +
      '→ Use `#channel` / `@user` / names on commands\n' +
      '→ **✨・ougi** has every major action as buttons (Administrator only)',
  },
];

module.exports = { HELP_PAGES };
