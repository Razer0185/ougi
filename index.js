const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
} = require('discord.js');
const { loadGuild, ensureDirs, getGuildPrefix } = require('./src/utils/store');
const { commands, createPanel } = require('./src/commands');
const { handleInteraction } = require('./src/handlers/interactions');
const { registerSlashCommands } = require('./src/slash/register');
const { handleSlash } = require('./src/slash/handler');
const { handleVoiceState } = require('./src/features/jtc');
const { checkAutomod } = require('./src/features/automod');
const { baseEmbed, errorEmbed, successEmbed } = require('./src/utils/embeds');
const {
  peekPendingUpload,
  clearPendingUpload,
  setAvatarFromAttachment,
  setBannerFromAttachment,
} = require('./src/features/profile');
const { memberHasAdmin } = require('./src/utils/helpers');
const {
  cacheGuildInvites,
  syncInviteToCache,
  removeInviteFromCache,
  handleMemberJoin,
  handleMemberLeave,
  sendJoinLog,
  sendLeaveLog,
} = require('./src/features/invites');
const {
  handleReactionAdd,
  handleReactionRemove,
  resumeGiveaways,
} = require('./src/features/giveaways');
const { resumeReminders } = require('./src/features/reminders');
const { handleMessageXp } = require('./src/features/levels');
const { handleAfkMessage } = require('./src/features/afk');
const { maybeAutorespond } = require('./src/features/autoresponder');
const { refreshSticky } = require('./src/features/sticky');
const { tryCustomCommand } = require('./src/features/customcommands');
const {
  handleRoleReactionAdd,
  handleRoleReactionRemove,
  applyAutoroles,
} = require('./src/features/roles');
const { handleStarReaction } = require('./src/features/starboard');
const {
  logMessageDelete,
  logMessageUpdate,
  logMemberJoinDetail,
  logMemberLeaveDetail,
} = require('./src/features/logging');

function readToken() {
  const fromEnv = String(
    process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || ''
  ).trim();
  if (fromEnv && fromEnv !== 'PASTE_YOUR_DISCORD_BOT_TOKEN_HERE') {
    return fromEnv;
  }
  const tokenPath = path.join(__dirname, 'token.txt');
  if (!fs.existsSync(tokenPath)) {
    console.error(
      'Missing Discord token. Set DISCORD_TOKEN env var (on Render) or put it in token.txt locally.'
    );
    process.exit(1);
  }
  const token = fs.readFileSync(tokenPath, 'utf8').trim();
  if (!token || token === 'PASTE_YOUR_DISCORD_BOT_TOKEN_HERE') {
    console.error('token.txt is empty. Paste your bot token into token.txt and restart.');
    process.exit(1);
  }
  return token;
}

function readIntentMode() {
  if (process.env.NEXUS_INTENT_MODE === 'safe' || process.env.NEXUS_INTENT_MODE === 'full') {
    return process.env.NEXUS_INTENT_MODE;
  }
  const file = path.join(__dirname, 'intents.txt');
  if (fs.existsSync(file)) {
    const mode = fs.readFileSync(file, 'utf8').trim().toLowerCase();
    if (mode === 'full' || mode === 'safe' || mode === 'auto') return mode;
  }
  return 'auto';
}

function buildIntents(mode) {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.GuildInvites,
  ];
  // auto + full try privileged intents (needed for .prefix commands)
  if (mode === 'full' || mode === 'auto') {
    intents.push(
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildPresences
    );
  }
  return intents;
}

/** Pull command body from guild prefix OR @bot mention. */
function extractCommandBody(message, prefix) {
  const content = (message.content || '').trim();
  if (!content) return null;

  const id = message.client.user.id;
  const mentions = [`<@${id}>`, `<@!${id}>`];

  for (const m of mentions) {
    if (content === m) return 'help';
    if (content.startsWith(m)) {
      return content.slice(m.length).trim() || 'help';
    }
  }

  if (!prefix) return null;

  // Exact prefix at start (supports "!help" and "! help")
  if (content.startsWith(prefix)) {
    const rest = content.slice(prefix.length).replace(/^\s+/, '');
    return rest || null;
  }

  return null;
}

ensureDirs();

const requestedMode = readIntentMode();
const mode = requestedMode === 'auto' ? 'full' : requestedMode;
const tryingPrivileged = mode === 'full' || requestedMode === 'auto';

// If privileged intents aren't enabled in the portal, fall back to safe once.
if (tryingPrivileged && process.env.NEXUS_INTENT_MODE !== 'safe') {
  process.on('uncaughtException', (err) => {
    const msg = String(err && err.message ? err.message : err);
    if (/disallowed intents/i.test(msg)) {
      console.warn(
        '\nPrivileged intents are OFF in the Developer Portal.\n' +
          'Restarting in SAFE mode — use /slash commands or @mention the bot.\n' +
          'To enable .prefix commands: turn on Message Content Intent, set intents.txt to full, restart.\n'
      );
      const child = spawn(process.execPath, [__filename], {
        cwd: __dirname,
        env: { ...process.env, NEXUS_INTENT_MODE: 'safe' },
        stdio: 'inherit',
        windowsHide: true,
      });
      child.on('exit', (code) => process.exit(code ?? 1));
      return;
    }
    console.error(err);
    process.exit(1);
  });
}

const client = new Client({
  intents: buildIntents(mode),
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.Reaction, Partials.User],
});

client.once('clientReady', async () => {
  console.log(`Ougi online as ${client.user.tag}`);
  console.log(`Intent mode: ${process.env.NEXUS_INTENT_MODE || requestedMode}`);

  const { buildBotInviteUrl, writeInviteFile } = require('./src/utils/invite');
  const {
    seedAllowedGuilds,
    isGuildAllowed,
    isPrivateMode,
    loadAccess,
  } = require('./src/utils/access');

  // Whitelist servers you're already in so private mode doesn't kick you out
  seedAllowedGuilds([...client.guilds.cache.keys()]);

  if (isPrivateMode()) {
    for (const [, guild] of client.guilds.cache) {
      if (!isGuildAllowed(guild.id)) {
        console.warn(`Leaving unauthorized server: ${guild.name} (${guild.id})`);
        await guild.leave().catch(() => {});
      }
    }
    console.log(
      `Private mode ON — ${loadAccess().allowedGuildIds.length} allowed server(s). Public invite disabled.`
    );
  }

  const inviteInfo = writeInviteFile(__dirname, client.user.id);
  if (inviteInfo?.url && !isPrivateMode()) {
    console.log(`\nAdd Ougi to a server:\n${inviteInfo.url}\n`);
  } else if (isPrivateMode()) {
    console.log('\nPrivate mode: use Host → Access, or `.access allow <serverId>`, then `.invite`.\n');
    console.log(`Owner invite file (do not share publicly): ${inviteInfo?.file || 'invite-url.txt'}\n`);
  }

  // Keep Discord username as Ougi when possible
  if (client.user.username !== 'Ougi') {
    await client.user.setUsername('Ougi').catch((err) => {
      console.warn('Could not rename bot to Ougi:', err.message);
    });
  }

  if (process.env.NEXUS_INTENT_MODE === 'safe' || requestedMode === 'safe') {
    console.log(`
Commands available NOW:
  • Slash:  /help  /ping  /ban  /kick  /lock  /setup  ...
  • Mention: @${client.user.username} help
  • Panel buttons in ✨・ougi (admins only)

To enable "." prefix commands:
  Developer Portal → Bot → Message Content Intent ON
  Then put "full" in intents.txt and restart.
`);
  } else {
    console.log('Prefix commands enabled (Message Content intent OK).');
  }

  client.user.setActivity('/help · @bot help', { type: ActivityType.Listening });

  try {
    await registerSlashCommands(client);
  } catch (err) {
    console.error('Slash registration failed:', err.message);
  }

  try {
    await resumeGiveaways(client);
  } catch (err) {
    console.error('Giveaway resume failed:', err.message);
  }

  try {
    await resumeReminders(client);
  } catch (err) {
    console.error('Reminder resume failed:', err.message);
  }

  for (const [, guild] of client.guilds.cache) {
    try {
      await cacheGuildInvites(guild);
      const cfg = loadGuild(guild.id);
      if (!cfg.panelChannelId || !guild.channels.cache.get(cfg.panelChannelId)) {
        await createPanel(guild, client);
        console.log(`Control panel ready in ${guild.name}`);
      } else {
        const { panelEmbed } = require('./src/utils/embeds');
        const { panelComponents } = require('./src/ui/components');
        const ch = guild.channels.cache.get(cfg.panelChannelId);
        if (ch && ch.name !== '✨・ougi') {
          await ch.setName('✨・ougi').catch(() => {});
        }
        if (ch?.parent && ch.parent.name !== '╭─── Ougi ✨ ˅') {
          if (/nexus|example|ougi/i.test(ch.parent.name) || ch.parent.name.includes('╭')) {
            await ch.parent.setName('╭─── Ougi ✨ ˅').catch(() => {});
          }
        }
        if (ch) {
          const everyone = guild.roles.everyone.id;
          await ch.permissionOverwrites
            .edit(everyone, { ViewChannel: false, SendMessages: false })
            .catch(() => {});
          if (ch.parent) {
            await ch.parent.permissionOverwrites
              .edit(everyone, { ViewChannel: false })
              .catch(() => {});
          }
          await ch
            .setTopic('Ougi control panel — admins only')
            .catch(() => {});
        }
        const msg = cfg.panelMessageId && (await ch.messages.fetch(cfg.panelMessageId).catch(() => null));
        if (msg) {
          await msg.edit({
            embeds: [panelEmbed(guild.id, client, 0)],
            components: panelComponents(guild.id, 0),
          });
          console.log(`Control panel refreshed in ${guild.name}`);
        } else {
          await createPanel(guild, client);
          console.log(`Control panel recreated in ${guild.name}`);
        }
      }
    } catch (err) {
      console.error(`Setup failed for ${guild.name}:`, err.message);
    }
  }
});

client.on('guildCreate', async (guild) => {
  try {
    const { isGuildAllowed, isPrivateMode } = require('./src/utils/access');
    if (isPrivateMode() && !isGuildAllowed(guild.id)) {
      console.warn(`Blocked join (not whitelisted): ${guild.name} (${guild.id})`);
      const owner = await guild.fetchOwner().catch(() => null);
      if (owner) {
        await owner
          .send(
            `**Ougi** is private / paid-access only.\n` +
              `Server **${guild.name}** (\`${guild.id}\`) is not approved, so I left.\n` +
              `Request access on the Ougi website, or ask the owner to approve this server ID.`
          )
          .catch(() => {});
      }
      await guild.leave().catch(() => {});
      return;
    }

    await cacheGuildInvites(guild);
    await createPanel(guild, client);
    try {
      await registerSlashCommands(client);
    } catch {
      /* ignore */
    }
    console.log(`Joined & set up: ${guild.name}`);
  } catch (err) {
    console.error('guildCreate setup error:', err.message);
  }
});

client.on('inviteCreate', (invite) => {
  if (invite.guild) syncInviteToCache(invite.guild.id, invite);
});

client.on('inviteDelete', (invite) => {
  if (invite.guild) removeInviteFromCache(invite.guild.id, invite.code);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlash(interaction);
      return;
    }
    await handleInteraction(interaction);
  } catch (err) {
    console.error('Interaction error:', err);
  }
});

client.on('messageReactionAdd', (reaction, user) => {
  handleReactionAdd(reaction, user, client).catch((err) =>
    console.error('Giveaway reaction add:', err.message)
  );
  handleRoleReactionAdd(reaction, user, client).catch((err) =>
    console.error('Role reaction add:', err.message)
  );
  handleStarReaction(reaction, user, client).catch((err) =>
    console.error('Starboard:', err.message)
  );
});

client.on('messageReactionRemove', (reaction, user) => {
  handleReactionRemove(reaction, user).catch((err) =>
    console.error('Giveaway reaction remove:', err.message)
  );
  handleRoleReactionRemove(reaction, user).catch((err) =>
    console.error('Role reaction remove:', err.message)
  );
});

client.on('messageDelete', (message) => {
  logMessageDelete(message).catch(() => {});
});

client.on('messageUpdate', (oldMessage, newMessage) => {
  logMessageUpdate(oldMessage, newMessage).catch(() => {});
});

client.on('voiceStateUpdate', (oldState, newState) => {
  handleVoiceState(oldState, newState).catch((err) => console.error('JTC error:', err.message));
});

client.on('guildMemberAdd', async (member) => {
  try {
    const result = await handleMemberJoin(member);
    await sendJoinLog(member.guild, member, result);
  } catch (err) {
    console.error('Invite track join:', err.message);
  }

  try {
    await applyAutoroles(member);
  } catch (err) {
    console.error('Autorole:', err.message);
  }

  try {
    await logMemberJoinDetail(member);
  } catch {
    /* ignore */
  }

  const cfg = loadGuild(member.guild.id);
  if (!cfg.welcome?.enabled || !cfg.welcome.channelId) return;
  const channel = member.guild.channels.cache.get(cfg.welcome.channelId);
  if (!channel) return;
  const text = (cfg.welcome.message || 'Welcome {user}!')
    .replaceAll('{user}', `${member}`)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{count}', String(member.guild.memberCount));
  await channel
    .send({
      embeds: [
        baseEmbed(member.guild.id, {
          title: 'Welcome',
          description: text,
          thumbnail: member.user.displayAvatarURL({ size: 256 }),
        }),
      ],
    })
    .catch(() => {});
});

client.on('guildMemberRemove', async (member) => {
  try {
    const record = await handleMemberLeave(member);
    await sendLeaveLog(member.guild, member, record);
  } catch (err) {
    console.error('Invite track leave:', err.message);
  }
  try {
    await logMemberLeaveDetail(member);
  } catch {
    /* ignore */
  }
});

client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;

  const pending = peekPendingUpload(message.author.id);
  if (pending && pending.channelId === message.channel.id) {
    if (!memberHasAdmin(message.member)) return;
    const attachment = message.attachments.find(
      (a) => a.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.name || '')
    );
    if (!attachment) {
      await message.reply({
        embeds: [errorEmbed(message.guild.id, 'Upload', 'Send an image file (png/jpg/webp/gif). Still waiting...')],
      });
      return;
    }
    clearPendingUpload(message.author.id);
    try {
      if (pending.type === 'banner') await setBannerFromAttachment(message.client, attachment);
      else await setAvatarFromAttachment(message.client, attachment);
      await message.reply({
        embeds: [
          successEmbed(
            message.guild.id,
            pending.type === 'banner' ? 'Banner Updated' : 'Avatar Updated',
            'Bot profile image changed from your upload.'
          ),
        ],
      });
    } catch (err) {
      await message.reply({
        embeds: [errorEmbed(message.guild.id, 'Upload', String(err.message || err))],
      });
    }
    return;
  }

  const cfg = loadGuild(message.guild.id);

  // Automod only when we can read content
  if (message.content) {
    const automodHit = checkAutomod(message, cfg);
    if (automodHit) {
      await message.delete().catch(() => {});
      const warn = await message.channel
        .send({
          content: `${message.author}`,
          embeds: [errorEmbed(message.guild.id, 'AutoMod', automodHit)],
        })
        .catch(() => null);
      if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);
      return;
    }
  }

  await handleAfkMessage(message).catch(() => {});
  await handleMessageXp(message).catch(() => {});
  await maybeAutorespond(message).catch(() => {});
  await refreshSticky(message).catch(() => {});

  // Always read prefix fresh from disk so `.prefix !` applies immediately
  const prefix = getGuildPrefix(message.guild.id);
  const body = extractCommandBody(message, prefix);
  if (!body) return;

  const args = body.split(/\s+/).filter(Boolean);
  const name = (args.shift() || '').toLowerCase();
  if (!name) return;
  const command = commands[name];
  if (!command || command.skip) {
    const ranCc = await tryCustomCommand(message, name, prefix).catch(() => false);
    if (ranCc) return;
    if (message.mentions.has(message.client.user)) {
      await message
        .reply({
          embeds: [
            errorEmbed(
              message.guild.id,
              'Unknown Command',
              `Try \`/help\` or \`@${message.client.user.username} help\` or \`${prefix}help\``
            ),
          ],
        })
        .catch(() => {});
    }
    return;
  }

  try {
    await command.execute(message, args);
  } catch (err) {
    console.error(`Command ${name} error:`, err);
    await message
      .reply({
        embeds: [errorEmbed(message.guild.id, 'Command Error', String(err.message || err))],
      })
      .catch(() => {});
  }
});

client.login(readToken());
