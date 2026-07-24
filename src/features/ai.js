'use strict';

/**
 * You.com Express Agent — chat + custom channel layout builder.
 * Builds follow the guild's active server template style unless the user opts out.
 * Key: you-api-key.txt or YDC_API_KEY / YOU_API_KEY env.
 */

const fs = require('fs');
const path = require('path');
const {
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { successEmbed, errorEmbed, baseEmbed } = require('../utils/embeds');
const { loadGuild } = require('../utils/store');
const { getServerTemplate, styleFromTemplateId, applyChannelPermissions, applyCategoryPermissions, inferPerm, findStaffRoles, findVipRoles } = require('./templates');

const ROOT = path.join(__dirname, '..', '..');
const KEY_FILES = ['you-api-key.txt', 'YDC_API_KEY.txt', 'ydc-api-key.txt'];

const RATE = new Map();
const RATE_MS = 4000;
const MAX_CATEGORIES = 8;
const MAX_CHANNELS_PER_CAT = 12;
/** @type {Map<string, object>} */
const pendingBuilds = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;

const FREEFORM_RE =
  /\b(don'?t|do not|dont)\s+(follow|use|match|copy)\b.*\btemplate\b|\b(ignore|without|no|skip)\s+(the\s+)?template\b|\bfreeform\b|\bnotemplate\b|\bcustom\s+style\b|\bnot\s+based\s+on\s+(the\s+)?template\b/i;

const BUILD_INTENT_RE =
  /\b(make|create|build|add|set\s*up|setup)\b.+\b(channel|channels|categor(?:y|ies)|layout|section|server)\b|\b(channel|channels)\b.+\b(for|called|named|to)\b/i;

function pendingKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getPendingBuild(guildId, userId) {
  const key = pendingKey(guildId, userId);
  const p = pendingBuilds.get(key);
  if (!p) return null;
  if (Date.now() - p.updatedAt > PENDING_TTL_MS) {
    pendingBuilds.delete(key);
    return null;
  }
  return p;
}

function setPendingBuild(guildId, userId, data) {
  pendingBuilds.set(pendingKey(guildId, userId), { ...data, updatedAt: Date.now() });
}

function clearPendingBuild(guildId, userId) {
  pendingBuilds.delete(pendingKey(guildId, userId));
}

/** True when the request is too thin to build safely. */
function isVagueChannelRequest(q) {
  const text = String(q || '').trim();
  if (!text) return true;
  if (/\b(text|voice|read-?only|staff\s*only|everyone|public|private|permission|perms)\b/i.test(text)) {
    return false;
  }
  if (/https?:\/\//i.test(text) || /\b[\w-]+\.(com|net|org|io|gg|dev|shop|store)\b/i.test(text)) {
    return false;
  }
  if (/\b(for|about|to\s+(buy|sell|post|talk|chat|share|announce))\b/i.test(text) && text.length >= 36) {
    return false;
  }
  if (text.split(/\s+/).filter(Boolean).length >= 14) return false;
  // "make a channel named good" / "make channel test"
  if (/\bnamed\b|\bcalled\b/i.test(text) && text.split(/\s+/).length <= 10) return true;
  return text.split(/\s+/).filter(Boolean).length < 9;
}

function clarifyEmbed(guildId, session) {
  const lines = [
    `You said: **${session.prompt}**`,
    '',
    'I need a couple details before I build it:',
    '',
    `**1. Type:** ${session.type ? `\`${session.type}\`` : '_pick below_'}`,
    `**2. Permissions:** ${session.perm ? `\`${session.perm}\`` : '_pick below_'}`,
    `**3. What is it for?** ${session.purpose ? session.purpose : '_reply in chat with a short description_'}`,
    '',
    session.waitingFor === 'purpose'
      ? '➡️ Reply here with what the channel is for (e.g. “selling my website example.com”).'
      : 'Pick the buttons, then I’ll ask what it’s for (if needed).',
    '',
    '_Cancel anytime with the Cancel button._',
  ];
  return baseEmbed(guildId, {
    title: 'AI Channels · Quick questions',
    description: lines.join('\n'),
  });
}

function clarifyComponents(session) {
  const typeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('aibuild:type:text')
      .setLabel('Text')
      .setStyle(session.type === 'text' ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('aibuild:type:voice')
      .setLabel('Voice')
      .setStyle(session.type === 'voice' ? ButtonStyle.Success : ButtonStyle.Primary)
  );
  const permRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('aibuild:perm:open')
      .setLabel('Everyone')
      .setStyle(session.perm === 'open' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('aibuild:perm:readonly')
      .setLabel('Read-only')
      .setStyle(session.perm === 'readonly' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('aibuild:perm:staff')
      .setLabel('Staff only')
      .setStyle(session.perm === 'staff' ? ButtonStyle.Success : ButtonStyle.Secondary)
  );
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('aibuild:go')
      .setLabel(session.type && session.perm && session.purpose ? 'Create now' : 'Create with defaults')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('aibuild:cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
  );
  return [typeRow, permRow, actionRow];
}

function sessionReadyEnough(session) {
  return !!(session.type && session.perm);
}

function composePromptFromSession(session) {
  const bits = [session.prompt];
  if (session.type) bits.push(`Channel type: ${session.type}.`);
  if (session.perm === 'readonly') bits.push('Permissions: read-only for @everyone.');
  else if (session.perm === 'staff') bits.push('Permissions: staff-only (hidden from @everyone).');
  else if (session.perm === 'open') bits.push('Permissions: everyone can view and send.');
  if (session.purpose) bits.push(`Purpose: ${session.purpose}`);
  return bits.join(' ');
}

function readYouApiKey() {
  const fromEnv = String(
    process.env.YDC_API_KEY || process.env.YOU_API_KEY || process.env.YOUCOM_API_KEY || ''
  ).trim();
  if (fromEnv) return fromEnv;
  for (const name of KEY_FILES) {
    const p = path.join(ROOT, name);
    if (fs.existsSync(p)) {
      const v = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/)[0].trim();
      if (v) return v;
    }
  }
  return null;
}

function rateOk(userId) {
  const now = Date.now();
  const last = RATE.get(userId) || 0;
  if (now - last < RATE_MS) return false;
  RATE.set(userId, now);
  return true;
}

function wantsFreeform(text) {
  return FREEFORM_RE.test(String(text || ''));
}

function looksLikeChannelBuild(text) {
  return BUILD_INTENT_RE.test(String(text || ''));
}

function inferStyleFromGuild(guild) {
  const names = [...(guild?.channels?.cache?.values?.() || [])].map((c) => c.name).join('\n');
  if (/★/.test(names)) return 'star';
  if (/｜/.test(names)) return 'pipe';
  if (/・/.test(names)) return 'dot';
  if (/(?:^|[\s])\w+-\w+/.test(names) && /╭|╰|│───/.test(names)) return 'dash';
  if (/╭|╰|│───/.test(names)) return 'dot';
  return 'plain';
}

/**
 * Resolve active template + style for this guild.
 */
function resolveTemplateContext(guild, { freeform = false, styleOverride = null } = {}) {
  if (freeform) {
    return {
      followTemplate: false,
      style: styleOverride || 'plain',
      template: null,
      source: 'freeform',
    };
  }

  const cfg = loadGuild(guild.id);
  let template = null;
  let style = styleOverride || null;
  let source = 'default';

  if (cfg.activeTemplate?.id) {
    template = getServerTemplate(cfg.activeTemplate.id) || null;
    style = styleOverride || cfg.activeTemplate.style || styleFromTemplateId(cfg.activeTemplate.id);
    source = 'active';
  }

  if (!template && !styleOverride) {
    // Guess from existing channel names if they already applied a look
    const inferred = inferStyleFromGuild(guild);
    style = style || inferred;
    source = template ? source : inferred !== 'plain' ? 'inferred' : 'default';
    // Prefer matching aesthetic template for examples
    if (!template && inferred === 'star') template = getServerTemplate('aesthetic-star');
    if (!template && inferred === 'dot') template = getServerTemplate('aesthetic-dot');
    if (!template && inferred === 'pipe') template = getServerTemplate('aesthetic-pipe');
    if (!template && inferred === 'dash') template = getServerTemplate('aesthetic-dash');
  }

  if (!style) style = 'star';

  return {
    followTemplate: true,
    style,
    template,
    activeMeta: cfg.activeTemplate || null,
    source,
  };
}

function templateExamples(template) {
  if (!template?.categories?.length) return '';
  const lines = [];
  for (const cat of template.categories.slice(0, 4)) {
    lines.push(`Category example: "${cat.name}"`);
    for (const ch of (cat.channels || []).slice(0, 3)) {
      lines.push(`  Channel example (${ch.type || 'text'}): "${ch.name}"`);
    }
  }
  return lines.join('\n');
}

async function youExpress(prompt, { webSearch = false } = {}) {
  const key = readYouApiKey();
  if (!key) {
    throw new Error('Missing you.com API key (you-api-key.txt)');
  }

  const body = {
    agent: 'express',
    input: prompt,
    stream: false,
  };
  if (webSearch) body.tools = [{ type: 'web_search' }];

  const res = await fetch('https://api.you.com/v1/agents/runs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`You.com bad response (${res.status}): ${raw.slice(0, 200)}`);
  }

  if (!res.ok) {
    const detail = data?.detail || data?.message || raw.slice(0, 200);
    throw new Error(`You.com ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }

  const outputs = Array.isArray(data.output) ? data.output : [];
  const answers = outputs
    .filter((o) => o?.type === 'message.answer' && o.text)
    .map((o) => o.text);
  if (answers.length) return answers.join('\n\n').trim();

  for (const o of outputs) {
    if (o?.text) return String(o.text).trim();
  }
  throw new Error('You.com returned no answer text');
}

function extractJsonObject(text) {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* find first { ... } */
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(cleaned.slice(start, end + 1));
  }
  throw new Error('AI did not return valid JSON');
}

function formatStyledName(rawName, type, style) {
  let raw = String(rawName || (type === 'voice' ? 'Voice' : 'channel')).trim().slice(0, 100);
  if (!raw) raw = type === 'voice' ? 'Voice' : 'channel';

  const emojiMatch = raw.match(/^([\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+)\s*/u);
  const em = emojiMatch ? emojiMatch[1] : type === 'voice' ? '🔊' : '💬';
  let rest = emojiMatch
    ? raw.slice(emojiMatch[0].length)
    : raw;
  rest = rest
    .replace(/^★\s*/u, '')
    .replace(/^[・｜|\-]+/u, '')
    .trim() || (type === 'voice' ? 'voice' : 'chat');

  if (style === 'star') {
    if (type === 'voice') return `${em} ★ ${rest}`.slice(0, 100);
    return `${em}★${rest}`.replace(/\s+/g, '-').toLowerCase().slice(0, 100);
  }
  if (style === 'pipe') {
    if (type === 'voice') return `${em}｜${rest}`.slice(0, 100);
    return `${em}｜${rest}`.replace(/\s+/g, '-').toLowerCase().slice(0, 100);
  }
  if (style === 'dash') {
    if (type === 'voice') return `${em}-${rest}`.slice(0, 100);
    return `${em}-${rest}`.replace(/\s+/g, '-').toLowerCase().slice(0, 100);
  }
  if (style === 'dot') {
    if (type === 'voice') return `${em}・${rest}`.slice(0, 100);
    return `${em}・${rest}`.replace(/\s+/g, '-').toLowerCase().slice(0, 100);
  }

  // plain
  if (type === 'voice') return rest.slice(0, 100);
  return rest
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '')
    .slice(0, 100) || 'channel';
}

function formatCategoryName(rawName, style) {
  let raw = String(rawName || 'Category').trim().slice(0, 100);
  if (!raw) raw = 'Category';

  // Keep aesthetic frame if AI already used it
  if (/[╭│╰]/.test(raw)) return raw.slice(0, 100);

  const emojiMatch = raw.match(/([\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+)/u);
  const em = emojiMatch ? emojiMatch[1] : '📁';
  const label = raw
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/[╭╰│─˅★・｜|\-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Section';

  if (style === 'star' || style === 'dot' || style === 'pipe' || style === 'dash') {
    return `│─── ${label} ${em} ˅`.slice(0, 100);
  }
  return label.slice(0, 100);
}

function sanitizeChannelName(name, type, style) {
  return formatStyledName(name, type, style);
}

function sanitizeCategoryName(name, style) {
  return formatCategoryName(name, style);
}

function normalizeLayout(parsed, style, defaults = {}) {
  const cats = Array.isArray(parsed?.categories) ? parsed.categories : [];
  if (!cats.length) throw new Error('Layout has no categories');

  return cats.slice(0, MAX_CATEGORIES).map((cat) => {
    const channels = Array.isArray(cat.channels) ? cat.channels : [];
    const staffOnly = !!cat.staffOnly || defaults.perm === 'staff';
    return {
      name: sanitizeCategoryName(cat.name, style),
      staffOnly,
      channels: channels.slice(0, MAX_CHANNELS_PER_CAT).map((ch) => {
        const type =
          String(ch.type || defaults.type || 'text').toLowerCase() === 'voice' ? 'voice' : 'text';
        let perm = ch.perm || defaults.perm || null;
        if (perm === 'open') perm = null;
        if (staffOnly && !perm) perm = 'staff';
        return {
          name: sanitizeChannelName(ch.name, type, style),
          type,
          perm,
        };
      }),
    };
  });
}

async function planChannelLayout(userPrompt, ctx, defaults = {}) {
  const style = ctx.style || 'star';
  const follow = ctx.followTemplate !== false;
  const examples = follow && ctx.template ? templateExamples(ctx.template) : '';

  const system = [
    'You design Discord server channel layouts for the Ougi bot.',
    'Reply with ONLY valid JSON (no markdown fences, no commentary).',
    'Schema:',
    '{"categories":[{"name":"string","staffOnly":false,"channels":[{"name":"string","type":"text|voice","perm":"readonly|staff|null"}]}]}',
    `Limits: max ${MAX_CATEGORIES} categories, max ${MAX_CHANNELS_PER_CAT} channels each.`,
    'Only create what the user asked for — do not rebuild a whole server unless they ask for a full layout.',
    'perm: use "readonly" for announcements-style, "staff" for staff-only, omit/null for normal chat.',
  ];

  if (defaults.type) system.push(`Forced channel type for new channels: ${defaults.type}.`);
  if (defaults.perm === 'readonly') system.push('Forced permissions: read-only.');
  if (defaults.perm === 'staff') system.push('Forced permissions: staff-only category/channels.');
  if (defaults.perm === 'open') system.push('Forced permissions: everyone can chat.');
  if (defaults.purpose) system.push(`Purpose / topic: ${defaults.purpose}`);

  if (follow && ctx.template) {
    system.push(
      `ACTIVE TEMPLATE: "${ctx.template.name}" (id: ${ctx.template.id}).`,
      `You MUST match this template's naming style and category framing.`,
      `Style code: ${style}.`,
      'Examples from the active template (copy this look exactly):',
      examples || '(no examples)',
      'If the user wants one shop/buy/website channel, add a small matching category + channel(s) in that same style.'
    );
  } else if (follow) {
    system.push(
      `No saved template ID, but match style "${style}" to blend with the server.`,
      style === 'star'
        ? 'Use emoji ★ names and categories like │─── Label 🎮 ˅'
        : style === 'dot'
          ? 'Use emoji・names and categories like │─── Label 💬 ˅'
          : style === 'pipe'
            ? 'Use emoji｜names'
            : 'Use clean simple names'
    );
  } else {
    system.push(
      'FREEFORM MODE: the user opted out of the active template.',
      'Do NOT copy aesthetic ★ / ・ / ╭ frames unless they ask for that look.',
      'Use simple clear channel names.'
    );
  }

  system.push(`User request: ${userPrompt}`);

  const text = await youExpress(system.join('\n'), { webSearch: false });
  const parsed = extractJsonObject(text);
  return normalizeLayout(parsed, follow ? style : style === 'plain' ? 'plain' : style, defaults);
}

async function createChannelsFromLayout(guild, layout, { reason = 'Ougi AI channels' } = {}) {
  const created = [];
  const categoryRefs = [];
  const staffRoles = findStaffRoles(guild, null);
  const vipRoles = [...findVipRoles(guild).values()];

  for (const cat of layout) {
    const category = await guild.channels.create({
      name: cat.name,
      type: ChannelType.GuildCategory,
      reason,
    });
    created.push(category.name);
    categoryRefs.push(category);

    await applyCategoryPermissions(
      category,
      { staffOnly: !!cat.staffOnly, vipOnly: !!cat.vipOnly },
      guild,
      staffRoles,
      vipRoles
    ).catch(() => {});

    for (const ch of cat.channels) {
      const channel = await guild.channels.create({
        name: ch.name,
        type: ch.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
        parent: category.id,
        reason,
        permissionOverwrites: [],
      });
      const perm = inferPerm(ch.name, ch.perm, cat.staffOnly, cat.vipOnly);
      await applyChannelPermissions(channel, perm, guild, staffRoles, vipRoles).catch(() => {});
      const tag =
        perm === 'readonly'
          ? ' [read-only]'
          : perm === 'staff' || perm === 'logs'
            ? ' [staff]'
            : perm === 'vip'
              ? ' [vip]'
              : '';
      created.push(`  ${ch.type === 'voice' ? '🔊' : '#'}${channel.name}${tag}`);
    }
  }

  for (let i = 0; i < categoryRefs.length; i++) {
    await categoryRefs[i].setPosition(i, { reason }).catch(() => {});
  }

  return created;
}

function layoutPreview(layout) {
  return layout
    .map((cat) => {
      const lines = [`**${cat.name}**${cat.staffOnly ? ' _(staff)_' : ''}`];
      for (const ch of cat.channels) {
        lines.push(`  ${ch.type === 'voice' ? '🔊' : '#'} \`${ch.name}\``);
      }
      return lines.join('\n');
    })
    .join('\n');
}

function contextFooter(ctx) {
  if (!ctx.followTemplate) return '_Freeform (not using active template)._';
  if (ctx.template) {
    return `_Matching active template: **${ctx.template.name}** (${ctx.style})._`;
  }
  if (ctx.source === 'inferred') {
    return `_Matching server look (${ctx.style}) — apply a template once to lock it in._`;
  }
  return `_Style: ${ctx.style}._`;
}

async function executeBuildFromSession(messageOrInteraction, session, { previewOnly = false } = {}) {
  const guild = messageOrInteraction.guild;
  const client = messageOrInteraction.client;
  const guildId = guild.id;
  const freeform = session.freeform || wantsFreeform(session.prompt);
  const ctx = resolveTemplateContext(guild, {
    freeform,
    styleOverride: session.styleOverride || null,
  });
  const defaults = {
    type: session.type || null,
    perm: session.perm || null,
    purpose: session.purpose || null,
  };
  const fullPrompt = composePromptFromSession(session);
  const footer = contextFooter(ctx);

  const layout = await planChannelLayout(fullPrompt, ctx, defaults);
  const preview = layoutPreview(layout);

  if (previewOnly || session.previewOnly) {
    return {
      embeds: [
        baseEmbed(guildId, {
          title: 'AI Channels · Preview',
          description: `${preview}\n\n${footer}\nRun without \`preview\` to create these.`,
        }),
      ],
      components: [],
    };
  }

  const created = await createChannelsFromLayout(guild, layout);
  return {
    embeds: [
      successEmbed(
        guildId,
        'Channels Created',
        `${created.map((l) => `• ${l}`).join('\n')}\n\n${footer}`.slice(0, 3900)
      ),
    ],
    components: [],
  };
}

async function runAskBuild(message, args) {
  let previewOnly = false;
  let styleOverride = null;
  let forceFreeform = false;
  const parts = [...args];

  while (parts[0]) {
    const a = parts[0].toLowerCase();
    if (a === 'preview' || a === 'plan') {
      previewOnly = true;
      parts.shift();
      continue;
    }
    if (a === 'freeform' || a === 'notemplate') {
      forceFreeform = true;
      parts.shift();
      continue;
    }
    if (a === 'star' || a === 'dot' || a === 'pipe' || a === 'dash' || a === 'plain') {
      styleOverride = a;
      parts.shift();
      continue;
    }
    break;
  }

  const q = parts.join(' ').trim();
  if (!q) {
    return message.reply({
      embeds: [
        errorEmbed(
          message.guild.id,
          'AI Channels',
          'Usage: `askbuild <description>`\n' +
            'Preview: `askbuild preview buy channel for example.com`\n' +
            'Ignore template: `askbuild freeform ...` or say “don’t follow the template”'
        ),
      ],
    });
  }

  if (!rateOk(message.author.id)) {
    return message.reply({
      embeds: [errorEmbed(message.guild.id, 'AI Channels', 'Slow down — wait a few seconds.')],
    });
  }

  const freeform = forceFreeform || wantsFreeform(q);

  // Vague? Ask follow-ups with buttons instead of guessing
  if (isVagueChannelRequest(q) && !previewOnly) {
    const session = {
      prompt: q,
      type: null,
      perm: null,
      purpose: null,
      previewOnly: false,
      styleOverride,
      freeform,
      channelId: message.channel.id,
      waitingFor: 'details',
    };
    setPendingBuild(message.guild.id, message.author.id, session);
    return message.reply({
      embeds: [clarifyEmbed(message.guild.id, session)],
      components: clarifyComponents(session),
    });
  }

  const ctx = resolveTemplateContext(message.guild, { freeform, styleOverride });

  const thinking = await message.reply({
    embeds: [
      baseEmbed(message.guild.id, {
        title: 'AI Channels',
        description: `Designing layout…\n${contextFooter(ctx)}`,
      }),
    ],
  });

  try {
    if (!previewOnly) {
      await thinking.edit({
        embeds: [
          baseEmbed(message.guild.id, {
            title: 'AI Channels',
            description: `Creating…\n\n${contextFooter(ctx)}`,
          }),
        ],
      });
    }
    const payload = await executeBuildFromSession(message, {
      prompt: q,
      type: null,
      perm: null,
      purpose: null,
      previewOnly,
      styleOverride,
      freeform,
    });
    return thinking.edit(payload);
  } catch (err) {
    console.error('AI askbuild failed:', err.message);
    return thinking.edit({
      embeds: [errorEmbed(message.guild.id, 'AI Channels', err.message || 'Failed.')],
    });
  }
}

async function handleAiBuildButton(interaction) {
  const { memberHasAdmin } = require('../utils/helpers');
  if (!memberHasAdmin(interaction.member)) {
    return interaction.reply({
      embeds: [errorEmbed(interaction.guild.id, 'Denied', 'Admin required.')],
      ephemeral: true,
    });
  }

  const id = interaction.customId;
  let session = getPendingBuild(interaction.guild.id, interaction.user.id);
  if (!session && id !== 'aibuild:cancel') {
    return interaction.reply({
      embeds: [errorEmbed(interaction.guild.id, 'AI Channels', 'No active build — run `askbuild` again.')],
      ephemeral: true,
    });
  }

  if (id === 'aibuild:cancel') {
    clearPendingBuild(interaction.guild.id, interaction.user.id);
    return interaction.update({
      embeds: [errorEmbed(interaction.guild.id, 'AI Channels', 'Cancelled.')],
      components: [],
    });
  }

  if (id.startsWith('aibuild:type:')) {
    session.type = id.split(':')[2];
    session.waitingFor = session.perm ? (session.purpose ? 'ready' : 'purpose') : 'details';
    setPendingBuild(interaction.guild.id, interaction.user.id, session);
    return interaction.update({
      embeds: [clarifyEmbed(interaction.guild.id, session)],
      components: clarifyComponents(session),
    });
  }

  if (id.startsWith('aibuild:perm:')) {
    session.perm = id.split(':')[2];
    session.waitingFor = session.type ? (session.purpose ? 'ready' : 'purpose') : 'details';
    setPendingBuild(interaction.guild.id, interaction.user.id, session);
    return interaction.update({
      embeds: [clarifyEmbed(interaction.guild.id, session)],
      components: clarifyComponents(session),
    });
  }

  if (id === 'aibuild:go') {
    // Defaults if they skip
    if (!session.type) session.type = 'text';
    if (!session.perm) session.perm = 'open';
    if (!session.purpose) session.purpose = session.prompt;

    await interaction.update({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'AI Channels',
          description: 'Designing + creating…',
        }),
      ],
      components: [],
    });

    try {
      const payload = await executeBuildFromSession(interaction, session);
      clearPendingBuild(interaction.guild.id, interaction.user.id);
      return interaction.editReply(payload);
    } catch (err) {
      console.error('AI build button failed:', err.message);
      return interaction.editReply({
        embeds: [errorEmbed(interaction.guild.id, 'AI Channels', err.message || 'Failed.')],
        components: [],
      });
    }
  }
}

/**
 * Continue clarify flow when user replies in chat with purpose / extra detail.
 * @returns {boolean} true if handled
 */
async function handlePendingBuildReply(message) {
  if (!message.guild || message.author.bot || !message.content) return false;
  const session = getPendingBuild(message.guild.id, message.author.id);
  if (!session) return false;
  if (session.channelId && message.channel.id !== session.channelId) return false;

  // Don't steal real commands
  const { getCommandPrefixes } = require('../utils/store');
  const prefixes = getCommandPrefixes(message.guild.id);
  const content = message.content.trim();
  if (prefixes.some((p) => content.startsWith(p))) return false;

  const { memberHasAdmin } = require('../utils/helpers');
  if (!memberHasAdmin(message.member)) {
    clearPendingBuild(message.guild.id, message.author.id);
    return false;
  }

  // Treat reply as purpose / more detail
  session.purpose = content.slice(0, 300);
  if (!session.type) session.type = 'text';
  if (!session.perm) session.perm = 'open';
  session.waitingFor = 'ready';
  setPendingBuild(message.guild.id, message.author.id, session);

  const thinking = await message.reply({
    embeds: [
      baseEmbed(message.guild.id, {
        title: 'AI Channels',
        description: `Got it — creating with:\n• Type: **${session.type}**\n• Perms: **${session.perm}**\n• Purpose: ${session.purpose}`,
      }),
    ],
  });

  try {
    const payload = await executeBuildFromSession(message, session);
    clearPendingBuild(message.guild.id, message.author.id);
    return thinking.edit(payload);
  } catch (err) {
    console.error('AI pending reply failed:', err.message);
    return thinking.edit({
      embeds: [errorEmbed(message.guild.id, 'AI Channels', err.message || 'Failed.')],
    });
  }
}

async function handleAsk(message, args) {
  const q = args.join(' ').trim();
  if (!q) {
    return message.reply({
      embeds: [errorEmbed(message.guild.id, 'Ask', 'Usage: `ask <question>`')],
    });
  }

  // Smart route: channel-build requests → askbuild (admins)
  if (looksLikeChannelBuild(q)) {
    const { memberHasAdmin } = require('../utils/helpers');
    if (memberHasAdmin(message.member)) {
      return runAskBuild(message, args);
    }
    return message.reply({
      embeds: [
        errorEmbed(
          message.guild.id,
          'Ask',
          'Channel building needs Administrator. Ask an admin, or use `askbuild`.'
        ),
      ],
    });
  }

  if (!rateOk(message.author.id)) {
    return message.reply({
      embeds: [errorEmbed(message.guild.id, 'Ask', 'Slow down — wait a few seconds.')],
    });
  }
  if (!readYouApiKey()) {
    return message.reply({
      embeds: [errorEmbed(message.guild.id, 'Ask', 'AI key missing (`you-api-key.txt`).')],
    });
  }

  const thinking = await message.reply({
    embeds: [baseEmbed(message.guild.id, { title: 'Ougi AI', description: 'Thinking…' })],
  });

  try {
    const cfg = loadGuild(message.guild.id);
    const tplNote = cfg.activeTemplate?.name
      ? `Active server template: ${cfg.activeTemplate.name} (${cfg.activeTemplate.style}).`
      : 'No active server template saved yet.';
    const prompt =
      `You are Ougi, a Discord server bot assistant. Be concise and helpful.\n` +
      `${tplNote}\n` +
      `If they want channels built, tell them an admin can use ask / askbuild.\n` +
      `User (${message.author.username}) asks: ${q}`;
    const answer = await youExpress(prompt, { webSearch: false });
    const clipped = answer.length > 3900 ? `${answer.slice(0, 3900)}…` : answer;
    return thinking.edit({
      embeds: [
        baseEmbed(message.guild.id, {
          title: 'Ougi AI',
          description: clipped,
        }),
      ],
    });
  } catch (err) {
    console.error('AI ask failed:', err.message);
    return thinking.edit({
      embeds: [errorEmbed(message.guild.id, 'Ask', err.message || 'AI request failed.')],
    });
  }
}

async function handleAskBuild(message, args) {
  return runAskBuild(message, args);
}

module.exports = {
  readYouApiKey,
  youExpress,
  planChannelLayout,
  createChannelsFromLayout,
  layoutPreview,
  handleAsk,
  handleAskBuild,
  handleAiBuildButton,
  handlePendingBuildReply,
  resolveTemplateContext,
  wantsFreeform,
  looksLikeChannelBuild,
  isVagueChannelRequest,
};
