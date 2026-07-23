# Ougi

Private Discord all-in-one bot — moderation, tickets, templates, levels, aesthetic layouts, and an admin control panel.

## Quick start

1. Put your bot token in `token.txt` (one line, no quotes).
2. In the [Discord Developer Portal](https://discord.com/developers/applications):
   - Enable **Message Content Intent**
   - Enable **Server Members Intent**
   - Enable **Presence Intent** (needed so join-to-create can read custom status)
   - Turn **Public Bot OFF** (recommended) so random people cannot freely add Ougi
3. Install & run:

```bash
npm install
npm start
```

4. Website (marketing + access requests):

```bash
npm run site
```

Opens **http://127.0.0.1:5050** — or double-click `Open Website.bat`.

5. Host app (bot control + access approvals):

```bash
npm run host
```

**http://127.0.0.1:7474**

## Private / paid access

Private mode is **ON by default**. Unauthorized servers are left automatically.

- Website visitors **request access** — there is no public “Add bot” button
- Approve from **Ougi Host → Access**, or `.access allow <serverId>`
- Create keys with `.access license` — customer runs `.access redeem KEY`
- Owner invite only via `.invite` / Host (do not post publicly)

On first start, servers you’re already in are auto-whitelisted so you don’t get kicked out.

## Invite (owner only)

Use a real bot invite (`scope=bot`), not Discord’s “Add App”:

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

Then approve the server ID. “Add App” alone often does not add the bot member.

On join / first ready, Ougi creates **✨・ougi** under `╭─── Ougi ✨ ˅` (admins only).

## Prefix commands

Default prefix is `.` — change it from **Settings** on the panel or `.prefix !`

| Command | What it does |
|--------|----------------|
| `help` | Paginated help |
| `access` | Private mode, allow/revoke servers, licenses |
| `invite` | Owner private invite link |
| `ban` / `kick` / `mute` / `unmute` | Moderation |
| `nick` | Change nickname |
| `lock` / `unlock` | Lock current channel |
| `invites on\|off` | Toggle invite creation |
| `setup` | Recreate control panel |
| `theme white\|black\|pink\|blue` | Embed accent |
| `botname <name>` | Rename the bot |
| `announce [#channel] <msg>` | Announcement (+ image attachments) |
| `event Title \| Desc \| hours \| location` | Scheduled event |
| `welcome on\|off` | Join welcomes |
| `jtc` | Join-to-create voice hub |
| `automod` | Protection filters |
| `template` | Server / role templates |
| `ticketpanel quick Label \| prefix \| desc` | Ticket panel |
| `ticketclose` | Close ticket channel |

## Host App

Control the bot from a local dashboard (start / stop / restart / auto-host / themes):

```bash
npm run host
```

Or double-click `Open Ougi Host.bat`.

Opens **http://127.0.0.1:7474**

- **Host Bot / Stop Bot / Restart**
- **Auto Host** — starts the bot when Windows signs in (toggle off anytime)
- **Host App Themes** — 10 looks (red, black, white, pink, blue, purple, green, orange, cyan, gold); saved and applied every time you open the host app

## Privileged intents

Edit `intents.txt`:

- `safe` — starts immediately (panel buttons work)
- `full` — after you enable Message Content, Server Members, and Presence in the Developer Portal

Invite the bot (replace CLIENT_ID) — **must include `bot` scope**:

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

Do not rely on Discord's "Add App" button alone.
