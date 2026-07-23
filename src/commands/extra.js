/**
 * Extra commands for Dyno/MEE6/Carl parity — merged into commands object.
 */
const { PermissionFlagsBits } = require('discord.js');
const { loadGuild, saveGuild } = require('../utils/store');
const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');
const {
  memberHasMod,
  memberHasAdmin,
  resolveMember,
  resolveChannel,
  parseDuration,
} = require('../utils/helpers');
const {
  warnMember,
  softbanMember,
  purgeMessages,
  setSlowmode,
  setModLogChannel,
  getCasesForUser,
  clearWarns,
  sendModLog,
  addCase,
} = require('../features/moderation');
const {
  setAutoroles,
  addRoleToMember,
  removeRoleFromMember,
  postReactionRolePanel,
  setSelfRoles,
  postSelfRolePanel,
  autorolePickRow,
  ensureRoles,
} = require('../features/roles');
const {
  ensureLevels,
  getUserLevel,
  leaderboard,
  rankEmbed,
} = require('../features/levels');
const { setLogChannel, ensureLogging } = require('../features/logging');
const { addRule, removeRule, listRules } = require('../features/autoresponder');
const { setSticky, clearSticky } = require('../features/sticky');
const { configureStarboard, ensureStarboard } = require('../features/starboard');
const { createPoll } = require('../features/polls');
const { addReminder } = require('../features/reminders');
const { setAfk, clearAfk } = require('../features/afk');
const {
  addCustomCommand,
  removeCustomCommand,
  listCustomCommands,
  buildEmbedFromParts,
} = require('../features/customcommands');
const { channelPick } = require('../ui/components');
const { ChannelType } = require('discord.js');

const extraCommands = {
  warn: {
    description: 'Warn a member',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod required.')] });
      }
      const target = await resolveMember(message.guild, args[0]);
      if (!target) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Warn', 'Usage: `warn @user [reason]`')],
        });
      }
      const reason = args.slice(1).join(' ') || 'No reason provided';
      const row = await warnMember(message.guild, {
        target,
        moderator: message.author,
        reason,
      });
      return message.reply({
        embeds: [
          successEmbed(
            message.guild.id,
            'Warned',
            `→ **${target.user.tag}** · Case #${row.id}\n→ ${reason}`
          ),
        ],
      });
    },
  },

  warnings: {
    description: 'View warnings for a member',
    mod: true,
    async execute(message, args) {
      const target =
        (await resolveMember(message.guild, args[0])) ||
        message.mentions.members.first() ||
        message.member;
      const cases = getCasesForUser(message.guild.id, target.id).filter((c) => c.type === 'warn');
      const body =
        cases.length === 0
          ? '_No warnings._'
          : cases
              .slice(-15)
              .map(
                (c) =>
                  `→ **#${c.id}** <t:${Math.floor(c.at / 1000)}:R> — ${c.reason} (by <@${c.modId}>)`
              )
              .join('\n');
      return message.reply({
        embeds: [baseEmbed(message.guild.id, { title: `Warnings · ${target.user.tag}`, description: body })],
      });
    },
  },

  clearwarns: {
    description: 'Clear warnings for a member',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod required.')] });
      }
      const target = await resolveMember(message.guild, args[0]);
      if (!target) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Clearwarns', 'Usage: `clearwarns @user`')],
        });
      }
      const n = clearWarns(message.guild.id, target.id);
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Cleared', `Removed **${n}** warning(s) from ${target}.`)],
      });
    },
  },

  softban: {
    description: 'Softban a member (ban + unban to wipe messages)',
    mod: true,
    async execute(message, args) {
      if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Ban permission required.')] });
      }
      const target = await resolveMember(message.guild, args[0]);
      if (!target) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Softban', 'Usage: `softban @user [reason]`')],
        });
      }
      const reason = args.slice(1).join(' ') || 'No reason provided';
      await softbanMember(message.guild, {
        target,
        moderator: message.author,
        reason,
      });
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Softbanned', `→ **${target.user.tag}** · ${reason}`)],
      });
    },
  },

  purge: {
    description: 'Bulk delete messages',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod required.')] });
      }
      let amount = parseInt(args[0], 10);
      let channel = message.channel;
      let userId = message.mentions.users.first()?.id || null;
      if (Number.isNaN(amount)) {
        const maybeCh = await resolveChannel(message.guild, args[0]);
        if (maybeCh) {
          channel = maybeCh;
          amount = parseInt(args[1], 10);
        }
      }
      if (Number.isNaN(amount)) amount = 10;
      const deleted = await purgeMessages(channel, { amount, userId });
      await sendModLog(message.guild, {
        action: 'Purge',
        userId: message.author.id,
        userTag: message.author.tag,
        modId: message.author.id,
        reason: `Purged ${deleted} in #${channel.name}`,
      });
      const reply = await message.channel.send({
        embeds: [successEmbed(message.guild.id, 'Purged', `Deleted **${deleted}** message(s) in ${channel}.`)],
      });
      setTimeout(() => reply.delete().catch(() => {}), 4000);
    },
  },

  clear: {
    description: 'Alias for purge',
    mod: true,
    async execute(message, args) {
      return extraCommands.purge.execute(message, args);
    },
  },

  slowmode: {
    description: 'Set channel slowmode',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod required.')] });
      }
      let seconds = parseInt(args[0], 10);
      let channel = message.channel;
      if (Number.isNaN(seconds) && args[0]) {
        const ch = await resolveChannel(message.guild, args[0]);
        if (ch) {
          channel = ch;
          seconds = parseInt(args[1], 10);
        }
      }
      if (Number.isNaN(seconds)) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Slowmode', 'Usage: `slowmode [seconds] [#channel]`')],
        });
      }
      const s = await setSlowmode(channel, seconds);
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Slowmode', `${channel} slowmode set to **${s}s**.`)],
      });
    },
  },

  modlog: {
    description: 'Set moderation log channel',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const ch =
        message.mentions.channels.first() ||
        (await resolveChannel(message.guild, args[0])) ||
        message.channel;
      await setModLogChannel(message.guild.id, ch.id);
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Mod Log', `Logs will go to ${ch}.`)],
      });
    },
  },

  autorole: {
    description: 'Set roles given on join',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'clear' || sub === 'off') {
        setAutoroles(message.guild.id, []);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Autorole', 'Cleared autoroles.')],
        });
      }
      const roles = [...message.mentions.roles.values()];
      if (!roles.length) {
        const cfg = ensureRoles(loadGuild(message.guild.id));
        const list =
          cfg.roles.autoroleIds.map((id) => `<@&${id}>`).join(', ') || '_none_';
        return message.reply({
          embeds: [
            baseEmbed(message.guild.id, {
              title: 'Autorole',
              description: `Current: ${list}\n\nUsage: \`autorole @Role [@Role2]\` · \`autorole clear\``,
            }),
          ],
          components: [autorolePickRow()],
        });
      }
      setAutoroles(
        message.guild.id,
        roles.map((r) => r.id)
      );
      return message.reply({
        embeds: [
          successEmbed(
            message.guild.id,
            'Autorole',
            `On join: ${roles.map((r) => `${r}`).join(', ')}`
          ),
        ],
      });
    },
  },

  addrole: {
    description: 'Add a role to a member',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod required.')] });
      }
      const target = await resolveMember(message.guild, args[0]);
      const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1]);
      if (!target || !role) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Add Role', 'Usage: `addrole @user @role`')],
        });
      }
      await addRoleToMember(target, role);
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Role Added', `Gave ${role} to ${target}.`)],
      });
    },
  },

  removerole: {
    description: 'Remove a role from a member',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod required.')] });
      }
      const target = await resolveMember(message.guild, args[0]);
      const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1]);
      if (!target || !role) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Remove Role', 'Usage: `removerole @user @role`')],
        });
      }
      await removeRoleFromMember(target, role);
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Role Removed', `Removed ${role} from ${target}.`)],
      });
    },
  },

  reactionrole: {
    description: 'Create a reaction role message',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      // reactionrole 👍 @Role | 🔥 @Role2
      const raw = args.join(' ');
      const parts = raw.split('|').map((p) => p.trim()).filter(Boolean);
      const pairs = [];
      for (const part of parts.length ? parts : [raw]) {
        const role =
          part.match(/<@&(\d+)>/) ||
          null;
        const roleId = role?.[1] || message.mentions.roles.first()?.id;
        const emoji = part.replace(/<@&\d+>/g, '').trim().split(/\s+/)[0];
        if (emoji && roleId) pairs.push({ emoji, roleId });
      }
      // also from mentions in order with leftover tokens
      if (!pairs.length) {
        return message.reply({
          embeds: [
            errorEmbed(
              message.guild.id,
              'Reaction Role',
              'Usage: `reactionrole 👍 @Role | 🔥 @OtherRole`'
            ),
          ],
        });
      }
      const msg = await postReactionRolePanel(message.channel, message.guild.id, 'Reaction Roles', pairs);
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Reaction Roles', `Posted → [jump](${msg.url})`)],
      });
    },
  },

  selfrole: {
    description: 'Manage self-role menu',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'add') {
        const roles = [...message.mentions.roles.values()];
        if (!roles.length) {
          return message.reply({
            embeds: [errorEmbed(message.guild.id, 'Self Role', 'Usage: `selfrole add @Role`')],
          });
        }
        const cfg = ensureRoles(loadGuild(message.guild.id));
        setSelfRoles(message.guild.id, [
          ...cfg.roles.selfRoles,
          ...roles.map((r) => r.id),
        ]);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Self Role', `Added ${roles.map((r) => `${r}`).join(', ')}`)],
        });
      }
      if (sub === 'post' || sub === 'panel') {
        const msg = await postSelfRolePanel(message.channel, message.guild.id);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Self Role', `Panel posted → [jump](${msg.url})`)],
        });
      }
      if (sub === 'clear') {
        setSelfRoles(message.guild.id, []);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Self Role', 'Cleared self-roles.')],
        });
      }
      return message.reply({
        embeds: [
          baseEmbed(message.guild.id, {
            title: 'Self Roles',
            description:
              '→ `selfrole add @Role` — add to menu\n' +
              '→ `selfrole post` — post select menu\n' +
              '→ `selfrole clear` — reset list',
          }),
        ],
      });
    },
  },

  rank: {
    description: 'Show your level rank',
    async execute(message, args) {
      const target =
        (await resolveMember(message.guild, args[0])) ||
        message.mentions.members.first() ||
        message.member;
      const stats = getUserLevel(message.guild.id, target.id);
      const board = leaderboard(message.guild.id, 100);
      const pos = board.findIndex((r) => r.id === target.id) + 1 || null;
      return message.reply({
        embeds: [rankEmbed(message.guild.id, target.user, stats, pos || null)],
      });
    },
  },

  levels: {
    description: 'XP leaderboard or leveling settings',
    async execute(message, args) {
      const sub = (args[0] || 'top').toLowerCase();
      if (sub === 'on' || sub === 'off') {
        if (!memberHasAdmin(message.member)) {
          return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
        }
        const cfg = ensureLevels(loadGuild(message.guild.id));
        cfg.levels.enabled = sub === 'on';
        saveGuild(message.guild.id, cfg);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Leveling', `XP is now **${sub.toUpperCase()}**.`)],
        });
      }
      if (sub === 'announce') {
        if (!memberHasAdmin(message.member)) {
          return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
        }
        const ch =
          message.mentions.channels.first() ||
          (await resolveChannel(message.guild, args[1])) ||
          message.channel;
        const cfg = ensureLevels(loadGuild(message.guild.id));
        cfg.levels.announceChannelId = ch.id;
        saveGuild(message.guild.id, cfg);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Leveling', `Level-ups announce in ${ch}.`)],
        });
      }
      if (sub === 'reward') {
        if (!memberHasAdmin(message.member)) {
          return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
        }
        const level = parseInt(args[1], 10);
        const role = message.mentions.roles.first();
        if (!level || !role) {
          return message.reply({
            embeds: [errorEmbed(message.guild.id, 'Reward', 'Usage: `levels reward <level> @Role`')],
          });
        }
        const cfg = ensureLevels(loadGuild(message.guild.id));
        cfg.levels.rewards[String(level)] = role.id;
        saveGuild(message.guild.id, cfg);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Reward', `Level **${level}** → ${role}`)],
        });
      }
      const top = leaderboard(message.guild.id, 10);
      const body =
        top.length === 0
          ? '_No XP yet._'
          : top
              .map((r, i) => `→ **#${i + 1}** <@${r.id}> — lvl **${r.level}** (${r.xp} xp)`)
              .join('\n');
      return message.reply({
        embeds: [baseEmbed(message.guild.id, { title: 'XP Leaderboard', description: body })],
      });
    },
  },

  leveling: {
    description: 'Alias for levels',
    async execute(message, args) {
      return extraCommands.levels.execute(message, args);
    },
  },

  serverlog: {
    description: 'Set server audit log channel',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const ch =
        message.mentions.channels.first() ||
        (await resolveChannel(message.guild, args[0])) ||
        message.channel;
      setLogChannel(message.guild.id, ch.id);
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Server Log', `Audit logs → ${ch}`)],
      });
    },
  },

  autorespond: {
    description: 'Add/list/remove autoresponder rules',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const sub = (args[0] || 'list').toLowerCase();
      if (sub === 'add') {
        const raw = args.slice(1).join(' ');
        const [trigger, ...rest] = raw.split('|').map((s) => s.trim());
        const response = rest.join('|').trim();
        if (!trigger || !response) {
          return message.reply({
            embeds: [
              errorEmbed(
                message.guild.id,
                'Autorespond',
                'Usage: `autorespond add trigger | response`'
              ),
            ],
          });
        }
        addRule(message.guild.id, trigger, response);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Autorespond', `Added trigger \`${trigger}\``)],
        });
      }
      if (sub === 'remove') {
        const n = removeRule(message.guild.id, args.slice(1).join(' '));
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Autorespond', `Removed **${n}** rule(s).`)],
        });
      }
      const rules = listRules(message.guild.id);
      const body =
        rules.length === 0
          ? '_No rules._'
          : rules.map((r) => `→ \`${r.trigger}\` → ${r.response.slice(0, 80)}`).join('\n');
      return message.reply({
        embeds: [baseEmbed(message.guild.id, { title: 'Autoresponder', description: body })],
      });
    },
  },

  sticky: {
    description: 'Set or clear a sticky message',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod required.')] });
      }
      if ((args[0] || '').toLowerCase() === 'clear') {
        await clearSticky(message.channel);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Sticky', 'Cleared sticky in this channel.')],
        });
      }
      const content = args.join(' ');
      if (!content) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Sticky', 'Usage: `sticky <text>` · `sticky clear`')],
        });
      }
      await setSticky(message.channel, content);
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Sticky', 'Sticky message set.')],
      });
    },
  },

  starboard: {
    description: 'Configure starboard',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'off') {
        configureStarboard(message.guild.id, { enabled: false });
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Starboard', 'Disabled.')],
        });
      }
      const ch =
        message.mentions.channels.first() ||
        (await resolveChannel(message.guild, args[0])) ||
        message.channel;
      const threshold = parseInt(args[1], 10) || 3;
      configureStarboard(message.guild.id, {
        channelId: ch.id,
        threshold,
        enabled: true,
      });
      return message.reply({
        embeds: [
          successEmbed(
            message.guild.id,
            'Starboard',
            `Enabled in ${ch} · threshold **${threshold}** ⭐`
          ),
        ],
      });
    },
  },

  poll: {
    description: 'Create a poll',
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod required.')] });
      }
      const raw = args.join(' ');
      const parts = raw.split('|').map((p) => p.trim()).filter(Boolean);
      if (parts.length < 3) {
        return message.reply({
          embeds: [
            errorEmbed(
              message.guild.id,
              'Poll',
              'Usage: `poll Question | Option A | Option B | ...`'
            ),
          ],
        });
      }
      const [question, ...options] = parts;
      await createPoll(message.channel, message.guild.id, question, options);
    },
  },

  remind: {
    description: 'Set a reminder',
    async execute(message, args) {
      const durationRaw = args[0];
      const text = args.slice(1).join(' ');
      if (!durationRaw || !text) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Remind', 'Usage: `remind 1h take out trash`')],
        });
      }
      const durationMs = parseDuration(durationRaw);
      const r = addReminder(message.client, {
        guildId: message.guild.id,
        channelId: message.channel.id,
        userId: message.author.id,
        text,
        durationMs,
      });
      return message.reply({
        embeds: [
          successEmbed(
            message.guild.id,
            'Reminder Set',
            `I'll remind you <t:${Math.floor(r.endsAt / 1000)}:R>:\n${text}`
          ),
        ],
      });
    },
  },

  afk: {
    description: 'Set AFK status',
    async execute(message, args) {
      if ((args[0] || '').toLowerCase() === 'clear') {
        clearAfk(message.guild.id, message.author.id);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'AFK', 'Cleared.')],
        });
      }
      const reason = args.join(' ') || 'AFK';
      setAfk(message.guild.id, message.author.id, reason);
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'AFK', `You're now AFK: **${reason}**`)],
      });
    },
  },

  embed: {
    description: 'Post a simple embed',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod required.')] });
      }
      const raw = args.join(' ');
      const parts = raw.split('|').map((p) => p.trim());
      let channel = message.channel;
      let title = parts[0];
      let description = parts[1] || '';
      let image = parts[2];
      if (message.mentions.channels.first()) {
        channel = message.mentions.channels.first();
      } else {
        const maybe = await resolveChannel(message.guild, parts[0]);
        if (maybe) {
          channel = maybe;
          title = parts[1];
          description = parts[2] || '';
          image = parts[3];
        }
      }
      if (!title) {
        return message.reply({
          embeds: [
            errorEmbed(
              message.guild.id,
              'Embed',
              'Usage: `embed Title | Description | [imageURL]`\nOr: `embed #channel Title | Description`'
            ),
          ],
        });
      }
      await channel.send({
        embeds: [buildEmbedFromParts(message.guild.id, { title, description, image })],
      });
      if (channel.id !== message.channel.id) {
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Embed', `Posted in ${channel}.`)],
        });
      }
    },
  },

  cc: {
    description: 'Custom commands',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const sub = (args[0] || 'list').toLowerCase();
      const prefix = require('../utils/store').getGuildPrefix(message.guild.id);
      if (sub === 'add') {
        const name = args[1];
        const response = args.slice(2).join(' ');
        if (!name || !response) {
          return message.reply({
            embeds: [
              errorEmbed(
                message.guild.id,
                'Custom Commands',
                `Tell me the name and what the bot should say.\n\nExample:\n\`${prefix}cc add hello Hi everyone!\``
              ),
            ],
          });
        }
        const key = addCustomCommand(message.guild.id, name, response);
        return message.reply({
          embeds: [
            successEmbed(
              message.guild.id,
              'Custom Command Added',
              `Type \`${prefix}${key}\` in chat and the bot will reply.`
            ),
          ],
        });
      }
      if (sub === 'remove') {
        const ok = removeCustomCommand(message.guild.id, args[1]);
        return message.reply({
          embeds: [
            ok
              ? successEmbed(message.guild.id, 'Removed', `\`${prefix}${args[1]}\` is gone.`)
              : errorEmbed(message.guild.id, 'Not Found', `No command named \`${args[1]}\`.`),
          ],
        });
      }
      const list = listCustomCommands(message.guild.id);
      return message.reply({
        embeds: [
          baseEmbed(message.guild.id, {
            title: 'Custom Commands',
            description: list.length
              ? `**Your commands**\n${list.map((c) => `• \`${prefix}${c}\``).join('\n')}\n\n` +
                `Add: \`${prefix}cc add name message\`\n` +
                `Remove: \`${prefix}cc remove name\``
              : `You have none yet.\n\nAdd one like this:\n\`${prefix}cc add hello Hi everyone!\``,
          }),
        ],
      });
    },
  },
};

// Aliases
extraCommands.rr = extraCommands.reactionrole;
extraCommands.ar = extraCommands.autorespond;

module.exports = { extraCommands };
