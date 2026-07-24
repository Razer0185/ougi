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
      let extra = '';
      if (row.ladder?.action) {
        extra = `\n→ Auto-punish: **${row.ladder.action}** (${row.ladder.warns} warns)`;
      }
      return message.reply({
        embeds: [
          successEmbed(
            message.guild.id,
            'Warned',
            `→ **${target.user.tag}** · Case #${row.id}\n→ ${reason}${extra}`
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

  tempban: {
    description: 'Temporarily ban a member',
    mod: true,
    async execute(message, args) {
      if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Ban permission required.')] });
      }
      const { tempbanMember } = require('../features/moderation');
      const prefix = require('../utils/store').getGuildPrefix(message.guild.id);
      const target = await resolveMember(message.guild, args[0]);
      const durationRaw = args.find((a, i) => i > 0 && /^\d+[smhd]?$/i.test(a));
      if (!target || !durationRaw) {
        return message.reply({
          embeds: [
            errorEmbed(
              message.guild.id,
              'Tempban',
              `Usage: \`${prefix}tempban @user 7d [reason]\`\nDuration: \`30m\` \`12h\` \`7d\``
            ),
          ],
        });
      }
      const reason = args
        .slice(1)
        .filter((a) => a !== durationRaw)
        .join(' ') || 'No reason provided';
      const ms = parseDuration(durationRaw);
      if (!ms || ms < 60_000) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Tempban', 'Duration must be at least 1 minute.')],
        });
      }
      const row = await tempbanMember(message.guild, {
        target,
        moderator: message.author,
        reason,
        durationMs: ms,
      });
      return message.reply({
        embeds: [
          successEmbed(
            message.guild.id,
            'Tempbanned',
            `→ **${target.user.tag}** until <t:${Math.floor(row.unbanAt / 1000)}:R>\n→ ${reason}`
          ),
        ],
      });
    },
  },

  purge: {
    description: 'Bulk delete messages (filters: bots|embeds|links|files|contains:text)',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod required.')] });
      }
      let amount = 10;
      let channel = message.channel;
      let userId = message.mentions.users.first()?.id || null;
      let filter = null;
      let contains = null;
      const tokens = args.filter((a) => !a.startsWith('<@'));
      for (const t of tokens) {
        const low = t.toLowerCase();
        if (/^\d+$/.test(t)) amount = parseInt(t, 10);
        else if (['bots', 'humans', 'embeds', 'links', 'attachments', 'files'].includes(low)) filter = low;
        else if (low.startsWith('contains:')) contains = t.slice('contains:'.length);
        else {
          const maybeCh = await resolveChannel(message.guild, t);
          if (maybeCh) channel = maybeCh;
        }
      }
      const deleted = await purgeMessages(channel, { amount, userId, filter, contains });
      await sendModLog(message.guild, {
        action: 'Purge',
        userId: message.author.id,
        userTag: message.author.tag,
        modId: message.author.id,
        reason: `Purged ${deleted} in #${channel.name}${filter ? ` (${filter})` : ''}`,
      });
      const reply = await message.channel.send({
        embeds: [
          successEmbed(
            message.guild.id,
            'Purged',
            `Deleted **${deleted}** message(s) in ${channel}.` +
              (filter || contains
                ? `\nFilter: ${filter || ''}${contains ? ` contains:${contains}` : ''}`
                : '')
          ),
        ],
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
      const { buildRankCard } = require('../features/rank-card');
      const card = await buildRankCard({
        guild: message.guild,
        user: target.user,
        stats,
        position: pos || null,
      }).catch(() => null);
      if (card) {
        return message.reply({
          embeds: [rankEmbed(message.guild.id, target.user, stats, pos || null)],
          files: [card],
        });
      }
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
      if (sub === 'voice') {
        if (!memberHasAdmin(message.member)) {
          return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
        }
        const mode = (args[1] || '').toLowerCase();
        const cfg = ensureLevels(loadGuild(message.guild.id));
        if (mode === 'on' || mode === 'off') {
          cfg.levels.voiceXpEnabled = mode === 'on';
          saveGuild(message.guild.id, cfg);
          return message.reply({
            embeds: [
              successEmbed(message.guild.id, 'Leveling', `Voice XP is **${mode.toUpperCase()}**.`),
            ],
          });
        }
        return message.reply({
          embeds: [
            baseEmbed(message.guild.id, {
              title: 'Voice XP',
              description:
                `Status: **${cfg.levels.voiceXpEnabled ? 'ON' : 'OFF'}** · ` +
                `**${cfg.levels.voiceXpPerMinute || 10}** XP / minute in voice\n` +
                '`levels voice on|off`',
            }),
          ],
        });
      }
      if (sub === 'blacklist' || sub === 'ignore') {
        if (!memberHasAdmin(message.member)) {
          return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
        }
        const ch =
          message.mentions.channels.first() ||
          (await resolveChannel(message.guild, args[1])) ||
          message.channel;
        const cfg = ensureLevels(loadGuild(message.guild.id));
        if (!cfg.levels.blacklistChannels.includes(ch.id)) {
          cfg.levels.blacklistChannels.push(ch.id);
          saveGuild(message.guild.id, cfg);
        }
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Leveling', `${ch} ignored for XP.`)],
        });
      }
      if (sub === 'unblacklist' || sub === 'unignore') {
        if (!memberHasAdmin(message.member)) {
          return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
        }
        const ch =
          message.mentions.channels.first() ||
          (await resolveChannel(message.guild, args[1])) ||
          message.channel;
        const cfg = ensureLevels(loadGuild(message.guild.id));
        cfg.levels.blacklistChannels = cfg.levels.blacklistChannels.filter((id) => id !== ch.id);
        saveGuild(message.guild.id, cfg);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Leveling', `${ch} earns XP again.`)],
        });
      }
      if (sub === 'setxp' || sub === 'set') {
        if (!memberHasAdmin(message.member)) {
          return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
        }
        const member =
          message.mentions.members.first() || (await resolveMember(message.guild, args[1]));
        const amount = parseInt(args[2] ?? args[1], 10);
        if (!member || Number.isNaN(amount) || amount < 0) {
          return message.reply({
            embeds: [errorEmbed(message.guild.id, 'Leveling', 'Usage: `levels setxp @user <amount>`')],
          });
        }
        const { setUserXp } = require('../features/levels');
        const stats = setUserXp(message.guild.id, member.id, amount);
        return message.reply({
          embeds: [
            successEmbed(
              message.guild.id,
              'XP Set',
              `${member} → **${stats.totalXp}** XP (level **${stats.level}**)`
            ),
          ],
        });
      }
      if (sub === 'reset') {
        if (!memberHasAdmin(message.member)) {
          return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
        }
        const member =
          message.mentions.members.first() || (await resolveMember(message.guild, args[1]));
        if (!member) {
          return message.reply({
            embeds: [errorEmbed(message.guild.id, 'Leveling', 'Usage: `levels reset @user`')],
          });
        }
        const { setUserXp } = require('../features/levels');
        setUserXp(message.guild.id, member.id, 0);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'XP Reset', `Cleared XP for ${member}.`)],
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
                `Tell me the name and what the bot should say.\n\n` +
                  `Example:\n\`${prefix}cc add hello Hi {user}!\`\n` +
                  `Embed:\n\`${prefix}cc add rules embed: Rules | Be nice | https://...\`\n` +
                  `Vars: \`{user}\` \`{server}\` \`{channel}\` \`{avatar}\` \`{nickname}\` \`{membercount}\``
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
                `Embed: \`${prefix}cc add name embed: Title | Desc | [image]\`\n` +
                `Remove: \`${prefix}cc remove name\``
              : `You have none yet.\n\nAdd one like this:\n\`${prefix}cc add hello Hi {user}!\``,
          }),
        ],
      });
    },
  },

  antiraid: {
    description: 'Anti-raid join flood protection',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const {
        ensureRaid,
        setRaidEnabled,
        unlockRaid,
      } = require('../features/antiraid');
      const cfg = loadGuild(message.guild.id);
      const raid = ensureRaid(cfg);
      const sub = (args[0] || '').toLowerCase();
      const prefix = require('../utils/store').getGuildPrefix(message.guild.id);

      if (sub === 'on' || sub === 'off') {
        await setRaidEnabled(message.guild.id, sub === 'on');
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Anti-Raid', `Protection is **${sub.toUpperCase()}**.`)],
        });
      }
      if (sub === 'unlock') {
        await unlockRaid(message.guild);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Anti-Raid', 'Lockdown lifted. Channels unlocked.')],
        });
      }
      if (sub === 'joins' || sub === 'limit') {
        const n = parseInt(args[1], 10);
        if (!n || n < 2) {
          return message.reply({
            embeds: [
              errorEmbed(
                message.guild.id,
                'Anti-Raid',
                `Current limit: **${raid.joinsPerMinute}** joins / 60s\nUsage: \`antiraid joins <number>\``
              ),
            ],
          });
        }
        raid.joinsPerMinute = Math.min(50, n);
        saveGuild(message.guild.id, cfg);
        return message.reply({
          embeds: [
            successEmbed(message.guild.id, 'Anti-Raid', `Trigger at **${raid.joinsPerMinute}** joins in 60 seconds.`),
          ],
        });
      }
      if (sub === 'action') {
        const a = (args[1] || '').toLowerCase();
        if (!['lock', 'kick', 'none'].includes(a)) {
          return message.reply({
            embeds: [
              errorEmbed(message.guild.id, 'Anti-Raid', 'Usage: `antiraid action lock|kick|none`'),
            ],
          });
        }
        raid.action = a;
        saveGuild(message.guild.id, cfg);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Anti-Raid', `Action set to **${a}**.`)],
        });
      }
      if (sub === 'exempt') {
        const role = message.mentions.roles.first();
        if (!role) {
          return message.reply({
            embeds: [errorEmbed(message.guild.id, 'Anti-Raid', 'Usage: `antiraid exempt @Role`')],
          });
        }
        if (!raid.exemptRoleIds.includes(role.id)) raid.exemptRoleIds.push(role.id);
        saveGuild(message.guild.id, cfg);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Anti-Raid', `${role} joins are exempt.`)],
        });
      }
      if (sub === 'unexempt') {
        const role = message.mentions.roles.first();
        if (!role) {
          return message.reply({
            embeds: [errorEmbed(message.guild.id, 'Anti-Raid', 'Usage: `antiraid unexempt @Role`')],
          });
        }
        raid.exemptRoleIds = raid.exemptRoleIds.filter((id) => id !== role.id);
        saveGuild(message.guild.id, cfg);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Anti-Raid', `${role} no longer exempt.`)],
        });
      }

      return message.reply({
        embeds: [
          baseEmbed(message.guild.id, {
            title: 'Anti-Raid',
            description:
              `Status: **${raid.enabled ? 'ON' : 'OFF'}**\n` +
              `Lockdown: **${raid.lockdown ? 'ACTIVE' : 'off'}**\n` +
              `Joins/min: **${raid.joinsPerMinute}**\n` +
              `Action: **${raid.action}**\n` +
              `Exempt roles: ${(raid.exemptRoleIds || []).map((id) => `<@&${id}>`).join(' ') || 'none'}\n\n` +
              `\`${prefix}antiraid on|off\`\n` +
              `\`${prefix}antiraid joins <n>\`\n` +
              `\`${prefix}antiraid action lock|kick|none\`\n` +
              `\`${prefix}antiraid exempt|unexempt @Role\`\n` +
              `\`${prefix}antiraid unlock\``,
          }),
        ],
      });
    },
  },

  suggest: {
    description: 'Post a suggestion or set up the board',
    async execute(message, args) {
      const { ensureSuggestions, postSuggestion } = require('../features/suggestions');
      const sub = (args[0] || '').toLowerCase();
      const prefix = require('../utils/store').getGuildPrefix(message.guild.id);

      if (sub === 'setup' || sub === 'channel') {
        if (!memberHasAdmin(message.member)) {
          return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
        }
        const ch =
          message.mentions.channels.first() ||
          (await resolveChannel(message.guild, args[1])) ||
          message.channel;
        const cfg = loadGuild(message.guild.id);
        const s = ensureSuggestions(cfg);
        s.enabled = true;
        s.channelId = ch.id;
        saveGuild(message.guild.id, cfg);
        return message.reply({
          embeds: [
            successEmbed(
              message.guild.id,
              'Suggestions',
              `Board enabled in ${ch}.\nMembers: \`${prefix}suggest your idea here\``
            ),
          ],
        });
      }
      if (sub === 'off') {
        if (!memberHasAdmin(message.member)) {
          return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
        }
        const cfg = loadGuild(message.guild.id);
        const s = ensureSuggestions(cfg);
        s.enabled = false;
        saveGuild(message.guild.id, cfg);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Suggestions', 'Suggestions disabled.')],
        });
      }

      const text = args.join(' ').trim();
      if (!text) {
        return message.reply({
          embeds: [
            baseEmbed(message.guild.id, {
              title: 'Suggestions',
              description:
                `\`${prefix}suggest <idea>\` — post an idea\n` +
                `\`${prefix}suggest setup #channel\` — enable board (admin)\n` +
                `\`${prefix}suggest off\` — disable`,
            }),
          ],
        });
      }
      try {
        const { id } = await postSuggestion(message.guild, message.author, text);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Suggestion', `Posted as **#${id}**.`)],
        });
      } catch (err) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Suggestions', err.message || 'Failed to post.')],
        });
      }
    },
  },

  schedule: {
    description: 'Repeating channel announcements',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const {
        parseEvery,
        addSchedule,
        removeSchedule,
        listSchedules,
        armSchedule,
      } = require('../features/schedule');
      const prefix = require('../utils/store').getGuildPrefix(message.guild.id);
      const sub = (args[0] || 'list').toLowerCase();

      if (sub === 'add') {
        const everyRaw = args[1];
        const everyMs = parseEvery(everyRaw);
        if (!everyMs) {
          return message.reply({
            embeds: [
              errorEmbed(
                message.guild.id,
                'Schedule',
                'Usage: `schedule add 1h [#channel] Title | message`\nInterval: `30m` `1h` `1d`'
              ),
            ],
          });
        }
        let rest = args.slice(2);
        let channel =
          message.mentions.channels.first() || (await resolveChannel(message.guild, rest[0]));
        if (channel) {
          rest = rest.slice(1).filter((a) => !a.includes(channel.id));
        } else {
          channel = message.channel;
        }
        const joined = rest.join(' ');
        const parts = joined.split('|').map((p) => p.trim());
        const title = parts[0] || 'Announcement';
        const body = parts.slice(1).join('|').trim() || parts[0];
        if (!body) {
          return message.reply({
            embeds: [errorEmbed(message.guild.id, 'Schedule', 'Provide a message after `|`.')],
          });
        }
        const job = addSchedule(message.guild.id, {
          channelId: channel.id,
          everyMs,
          title,
          message: body,
        });
        armSchedule(message.client, message.guild.id, job);
        return message.reply({
          embeds: [
            successEmbed(
              message.guild.id,
              'Schedule',
              `Job **${job.id}** → ${channel} every **${everyRaw}**.\nFirst post <t:${Math.floor(job.nextAt / 1000)}:R>`
            ),
          ],
        });
      }
      if (sub === 'remove' || sub === 'delete') {
        const id = args[1];
        if (!id || !removeSchedule(message.guild.id, id)) {
          return message.reply({
            embeds: [errorEmbed(message.guild.id, 'Schedule', 'Usage: `schedule remove <id>`')],
          });
        }
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Schedule', `Removed job **${id}**.`)],
        });
      }

      const jobs = listSchedules(message.guild.id);
      const body = jobs.length
        ? jobs
            .map(
              (j) =>
                `→ **${j.id}** <#${j.channelId}> every ${Math.round((j.everyMs || 0) / 60000)}m — ${j.title || 'Announcement'}`
            )
            .join('\n')
        : '_No schedules._';
      return message.reply({
        embeds: [
          baseEmbed(message.guild.id, {
            title: 'Schedules',
            description:
              body +
              `\n\n\`${prefix}schedule add 1h #channel Title | message\`\n\`${prefix}schedule remove <id>\``,
          }),
        ],
      });
    },
  },

  temprole: {
    description: 'Give a role that expires automatically',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod required.')] });
      }
      const { grantTempRole } = require('../features/temproles');
      const prefix = require('../utils/store').getGuildPrefix(message.guild.id);
      const member =
        message.mentions.members.first() || (await resolveMember(message.guild, args[0]));
      const role = message.mentions.roles.first();
      const durationRaw = args.find((a) => /^\d+[smhd]?$/i.test(a) && !a.startsWith('<@'));
      if (!member || !role || !durationRaw) {
        return message.reply({
          embeds: [
            errorEmbed(
              message.guild.id,
              'Temp Role',
              `Usage: \`${prefix}temprole @user @Role 1h\`\nDuration: \`30m\` \`2h\` \`1d\``
            ),
          ],
        });
      }
      const ms = parseDuration(durationRaw);
      try {
        await grantTempRole(message.guild, member, role, ms);
        return message.reply({
          embeds: [
            successEmbed(
              message.guild.id,
              'Temp Role',
              `${role} → ${member} for **${durationRaw}** (ends <t:${Math.floor((Date.now() + ms) / 1000)}:R>).`
            ),
          ],
        });
      } catch (err) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Temp Role', err.message || 'Could not add role.')],
        });
      }
    },
  },

  cases: {
    description: 'View or edit moderation cases',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod required.')] });
      }
      const { getCasesForUser, getCase, countWarns, updateCase, deleteCase } = require('../features/moderation');
      const prefix = require('../utils/store').getGuildPrefix(message.guild.id);
      const sub = (args[0] || '').toLowerCase();

      if (sub === 'note' || sub === 'reason') {
        const id = args[1];
        const text = args.slice(2).join(' ');
        if (!id || !text) {
          return message.reply({
            embeds: [
              errorEmbed(
                message.guild.id,
                'Cases',
                `Usage: \`${prefix}cases note <id> text\` · \`${prefix}cases reason <id> text\``
              ),
            ],
          });
        }
        const patch = sub === 'note' ? { note: text } : { reason: text };
        const row = updateCase(message.guild.id, id, patch);
        if (!row) {
          return message.reply({ embeds: [errorEmbed(message.guild.id, 'Cases', `No case #${id}.`)] });
        }
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Case Updated', `Case #${row.id} ${sub} set.`)],
        });
      }

      if (sub === 'delete' || sub === 'del' || sub === 'remove') {
        const id = args[1];
        if (!id || !deleteCase(message.guild.id, id)) {
          return message.reply({
            embeds: [errorEmbed(message.guild.id, 'Cases', `Usage: \`${prefix}cases delete <id>\``)],
          });
        }
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Case Deleted', `Removed case #${id}.`)],
        });
      }

      if (args[0] && /^\d+$/.test(args[0]) && !args[0].startsWith('<@')) {
        const row = getCase(message.guild.id, args[0]);
        if (!row) {
          return message.reply({
            embeds: [errorEmbed(message.guild.id, 'Cases', `No case #${args[0]}.`)],
          });
        }
        return message.reply({
          embeds: [
            baseEmbed(message.guild.id, {
              title: `Case #${row.id}`,
              description:
                `→ **Type:** ${row.type}\n` +
                `→ **User:** <@${row.userId}>\n` +
                `→ **Mod:** <@${row.modId}>\n` +
                `→ **Reason:** ${row.reason}\n` +
                (row.note ? `→ **Note:** ${row.note}\n` : '') +
                `→ **When:** <t:${Math.floor(row.at / 1000)}:R>`,
            }),
          ],
        });
      }
      const target =
        message.mentions.members.first() ||
        (await resolveMember(message.guild, args[0])) ||
        message.member;
      const list = getCasesForUser(message.guild.id, target.id).slice(-15).reverse();
      const warns = countWarns(message.guild.id, target.id);
      const body = list.length
        ? list
            .map(
              (c) =>
                `→ **#${c.id}** \`${c.type}\` <t:${Math.floor(c.at / 1000)}:R> — ${c.reason.slice(0, 80)}`
            )
            .join('\n')
        : '_No cases._';
      return message.reply({
        embeds: [
          baseEmbed(message.guild.id, {
            title: `Cases · ${target.user.tag}`,
            description:
              `Active warns: **${warns}**\n\n${body}\n\n` +
              `\`${prefix}cases note <id> …\` · \`${prefix}cases reason <id> …\` · \`${prefix}cases delete <id>\``,
          }),
        ],
      });
    },
  },

  warnladder: {
    description: 'Configure auto-punish after warnings',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const { ensureMod, setWarnLadder } = require('../features/moderation');
      const cfg = ensureMod(loadGuild(message.guild.id));
      const ladder = cfg.moderation.warnLadder;
      const sub = (args[0] || '').toLowerCase();
      const prefix = require('../utils/store').getGuildPrefix(message.guild.id);

      if (sub === 'on' || sub === 'off') {
        setWarnLadder(message.guild.id, { enabled: sub === 'on' });
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Warn Ladder', `Auto-punish **${sub.toUpperCase()}**.`)],
        });
      }
      if (sub === 'mute' || sub === 'kick' || sub === 'ban') {
        const n = parseInt(args[1], 10);
        if (!n || n < 0) {
          return message.reply({
            embeds: [
              errorEmbed(
                message.guild.id,
                'Warn Ladder',
                `Usage: \`${prefix}warnladder ${sub} <count>\` (0 = disabled)`
              ),
            ],
          });
        }
        const key = `${sub}At`;
        const patch = { [key]: n };
        if (sub === 'mute' && args[2]) patch.muteDuration = args[2];
        setWarnLadder(message.guild.id, patch);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Warn Ladder', `**${sub}** at **${n}** warns.`)],
        });
      }

      return message.reply({
        embeds: [
          baseEmbed(message.guild.id, {
            title: 'Warn Ladder',
            description:
              `Status: **${ladder.enabled ? 'ON' : 'OFF'}**\n` +
              `Mute at: **${ladder.muteAt || 0}** (${ladder.muteDuration || '1h'})\n` +
              `Kick at: **${ladder.kickAt || 0}**\n` +
              `Ban at: **${ladder.banAt || 0}** (0 = off)\n\n` +
              `\`${prefix}warnladder on|off\`\n` +
              `\`${prefix}warnladder mute 3 1h\`\n` +
              `\`${prefix}warnladder kick 5\`\n` +
              `\`${prefix}warnladder ban 7\``,
          }),
        ],
      });
    },
  },

  snipe: {
    description: 'Show the last deleted message in this channel',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod required.')] });
      }
      const { getSnipe } = require('../features/snipe');
      const idx = Math.max(0, (parseInt(args[0], 10) || 1) - 1);
      const hit = getSnipe(message.channel.id, idx);
      if (!hit) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Snipe', 'Nothing to snipe here.')],
        });
      }
      const embed = baseEmbed(message.guild.id, {
        title: 'Snipe',
        description: hit.content || '_No text_',
        footer: `${hit.authorTag} · deleted`,
        thumbnail: hit.avatar || undefined,
      });
      if (hit.attachments?.length) {
        embed.addFields({ name: 'Attachments', value: hit.attachments.join('\n').slice(0, 1000) });
      }
      return message.reply({ embeds: [embed] });
    },
  },

  editsnipe: {
    description: 'Show the last edited message in this channel',
    mod: true,
    async execute(message, args) {
      if (!memberHasMod(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Mod required.')] });
      }
      const { getEditSnipe } = require('../features/snipe');
      const idx = Math.max(0, (parseInt(args[0], 10) || 1) - 1);
      const hit = getEditSnipe(message.channel.id, idx);
      if (!hit) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Edit Snipe', 'Nothing to snipe here.')],
        });
      }
      return message.reply({
        embeds: [
          baseEmbed(message.guild.id, {
            title: 'Edit Snipe',
            description: `**Before:**\n${hit.before}\n\n**After:**\n${hit.after}`,
            footer: `${hit.authorTag} · edited`,
            thumbnail: hit.avatar || undefined,
          }),
        ],
      });
    },
  },

  report: {
    description: 'Report a member to staff',
    async execute(message, args) {
      const { submitReport, setReportChannel, ensureReports } = require('../features/report');
      const sub = (args[0] || '').toLowerCase();
      const prefix = require('../utils/store').getGuildPrefix(message.guild.id);

      if (sub === 'channel') {
        if (!memberHasAdmin(message.member)) {
          return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
        }
        const ch =
          message.mentions.channels.first() ||
          (await resolveChannel(message.guild, args[1])) ||
          message.channel;
        setReportChannel(message.guild.id, ch.id);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Reports', `Reports go to ${ch}.`)],
        });
      }
      if (sub === 'off' || sub === 'on') {
        if (!memberHasAdmin(message.member)) {
          return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
        }
        const cfg = loadGuild(message.guild.id);
        const r = ensureReports(cfg);
        r.enabled = sub === 'on';
        saveGuild(message.guild.id, cfg);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Reports', `Reports **${sub.toUpperCase()}**.`)],
        });
      }

      const target =
        message.mentions.members.first() || (await resolveMember(message.guild, args[0]));
      const reason = args.slice(1).join(' ').replace(/<@!?\d+>/g, '').trim();
      if (!target || !reason) {
        return message.reply({
          embeds: [
            errorEmbed(
              message.guild.id,
              'Report',
              `Usage: \`${prefix}report @user reason\`\nAdmin: \`${prefix}report channel #mods\``
            ),
          ],
        });
      }
      if (target.id === message.author.id) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Report', 'You cannot report yourself.')],
        });
      }
      try {
        await submitReport(message.guild, {
          reporter: message.author,
          target,
          reason,
          evidenceUrl: message.attachments.first()?.url || null,
        });
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Report', 'Staff have been notified.')],
        });
      } catch (err) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Report', err.message || 'Failed.')],
        });
      }
    },
  },

  lockdown: {
    description: 'Manually lock or unlock the server (anti-raid style)',
    mod: true,
    async execute(message, args) {
      if (!memberHasAdmin(message.member)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Admin required.')] });
      }
      const { unlockRaid, applyLockdown, ensureRaid } = require('../features/antiraid');
      const sub = (args[0] || '').toLowerCase();
      if (sub === 'off' || sub === 'unlock') {
        await unlockRaid(message.guild);
        return message.reply({
          embeds: [successEmbed(message.guild.id, 'Lockdown', 'Server unlocked.')],
        });
      }
      if (sub === 'on' || sub === 'lock' || !sub) {
        const cfg = loadGuild(message.guild.id);
        const raid = ensureRaid(cfg);
        raid.lockdown = true;
        raid.lockedAt = Date.now();
        saveGuild(message.guild.id, cfg);
        await applyLockdown(message.guild, true);
        return message.reply({
          embeds: [
            successEmbed(
              message.guild.id,
              'Lockdown',
              'Server locked (@everyone cannot send in text channels).\nUnlock: `lockdown off`'
            ),
          ],
        });
      }
      return message.reply({
        embeds: [errorEmbed(message.guild.id, 'Lockdown', 'Usage: `lockdown on|off`')],
      });
    },
  },

  unban: {
    description: 'Unban a user by ID',
    mod: true,
    async execute(message, args) {
      if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return message.reply({ embeds: [errorEmbed(message.guild.id, 'Denied', 'Ban permission required.')] });
      }
      const id = (args[0] || '').replace(/[<@!>]/g, '');
      if (!/^\d{17,20}$/.test(id)) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'Unban', 'Usage: `unban <userId> [reason]`')],
        });
      }
      const reason = args.slice(1).join(' ') || 'Unbanned';
      await message.guild.members.unban(id, `${message.author.tag}: ${reason}`);
      const { addCase, sendModLog } = require('../features/moderation');
      const row = addCase(message.guild.id, {
        type: 'unban',
        userId: id,
        modId: message.author.id,
        reason,
      });
      await sendModLog(message.guild, {
        action: 'Unban',
        userId: id,
        modId: message.author.id,
        reason,
        caseId: row.id,
      });
      return message.reply({
        embeds: [successEmbed(message.guild.id, 'Unbanned', `→ \`${id}\` · Case #${row.id}`)],
      });
    },
  },
};

// Aliases
extraCommands.rr = extraCommands.reactionrole;
extraCommands.ar = extraCommands.autorespond;
extraCommands.suggestion = extraCommands.suggest;
extraCommands.suggestions = extraCommands.suggest;
extraCommands.temproles = extraCommands.temprole;
extraCommands.esnipe = extraCommands.editsnipe;
extraCommands.case = extraCommands.cases;

module.exports = { extraCommands };
