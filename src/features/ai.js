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
const { loadGuild, saveGuild } = require('../utils/store');
const { getServerTemplate, styleFromTemplateId, applyChannelPermissions, applyCategoryPermissions, inferPerm, findStaffRoles, findVipRoles } = require('./templates');
const {
  playbookForPrompt,
  examplesForPrompt,
  detectThemes,
} = require('../data/ai-discord-playbook');

const ROOT = path.join(__dirname, '..', '..');
const KEY_FILES = ['you-api-key.txt', 'YDC_API_KEY.txt', 'ydc-api-key.txt'];
const GEMINI_KEY_FILES = ['gemini-api-key.txt', 'GOOGLE_AI_API_KEY.txt'];

const RATE = new Map();
const RATE_MS = 4000;
/** Interview builds stay small unless the admin explicitly confirms a larger layout. */
const MAX_CATEGORIES = 3;
const MAX_CHANNELS_PER_CAT = 6;
const MAX_CATEGORIES_FULL = 8;
const MAX_CHANNELS_PER_CAT_FULL = 12;
/** @type {Map<string, object>} */
const pendingBuilds = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;
/** Undo window for the last AI create/adjust batch. */
const LAST_AI_BUILD_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_AI_ACTIONS = 12;

const FREEFORM_RE =
  /\b(don'?t|do not|dont)\s+(follow|use|match|copy)\b.*\btemplate\b|\b(ignore|without|no|skip)\s+(the\s+)?template\b|\bfreeform\b|\bnotemplate\b|\bcustom\s+style\b|\bnot\s+based\s+on\s+(the\s+)?template\b/i;

const BUILD_INTENT_RE =
  /\b(make|create|build|add|set\s*up|setup)\b.+\b(channel|channels|categor(?:y|ies)|layout|section|server)\b|\b(channel|channels)\b.+\b(for|called|named|to)\b/i;

/**
 * Rule: illegal → blocked; everything else → fine.
 * Keyword pass for clear crimes only. Not a lawyer — Discord ToS still applies to what users post.
 * Legal-but-edgy themes (game cheats/mods, adult 18+ NSFW, shops, etc.) must NOT be blocked.
 */
const DISALLOWED_BUILD_RE = [
  // Child sexual abuse material / sexualization of minors (illegal)
  /\b(child\s*porn|child\s*pornography|csam|cp\b|pedo(?:phile|philia)?|under[\s-]?age\s*(?:sex|porn|nsfw|content|girl|boy)|loli(?:con)?|shota(?:con)?)\b/i,
  /\b(sexual(?:ize|ising|izing)?|porn|nsfw|hentai).{0,40}\b(kid|kids|child|children|minor|minors|under[\s-]?age|under\s*18)\b/i,
  /\b(kid|kids|child|children|minor|minors|under[\s-]?age|under\s*18).{0,40}\b(porn|nsfw|hentai|sexual)\b/i,
  // Other clear crimes as the server purpose
  /\b(snuff|rape\s*(?:porn|server|channel|community)|real\s*gore\s*(?:porn|snuff))\b/i,
  /\b(doxx?(?:ing)?|swatt?(?:ing)?)\b/i,
  /\b(phish(?:ing|er)?|steal(?:ing)?\s+(?:discord\s+)?tokens?|steal(?:ing)?\s+passwords?|cred(?:ential)?\s*stuff(?:ing)?|carding|ransomware|malware\s*(?:distro|distribution|dropper))\b/i,
  /\b(hit\s*man|murder\s*for\s*hire|bomb\s*mak(?:e|ing)|terror(?:ist|ism)\s*(?:attack|plot|recruit)|human\s*traffick(?:ing|er)?)\b/i,
];

function isDisallowedBuildPrompt(...parts) {
  const text = String(parts.filter(Boolean).join(' '));
  if (!text.trim()) return false;
  return DISALLOWED_BUILD_RE.some((re) => re.test(text));
}

function safetyBlockMessage() {
  return 'Illegal requests are blocked. Anything that is not illegal is fine.';
}

function wantsFullServerLayout(text) {
  return /\b(whole|full|entire|complete)\s+(discord\s+)?server\b|\brebuild\s+(the\s+)?server\b|\bevery\s+channel\b/i.test(
    String(text || '')
  );
}

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

/** @deprecated interview always runs — kept for callers */
function isVagueChannelRequest() {
  return true;
}

function interviewReady(session) {
  return !!(session?.serverAbout && session?.needs);
}

function clarifyEmbed(guildId, session) {
  const step = session.waitingFor || 'about';
  const lines = [
    session.prompt ? `Started from: **${String(session.prompt).slice(0, 180)}**` : null,
    '',
    'I will **not** build a whole server in one shot. Answer these first:',
    '',
    `**1. What is this server about?** ${session.serverAbout ? session.serverAbout : '_reply in chat_'}`,
    `**2. What should it have / change?** ${session.needs ? session.needs : '_new channels, or fix perms / rename existing_'}`,
    session.layoutPreview
      ? `\n**Preview:**\n${session.layoutPreview}`
      : '',
    '',
  ].filter((x) => x !== null);

  if (step === 'about') {
    lines.push('➡️ Reply with what the server is about (community, shop, gaming, support, etc.).');
  } else if (step === 'needs') {
    lines.push(
      '➡️ Reply with what to add **or** change (e.g. “announcements + make rules read-only” — not a full wipe).'
    );
  } else if (step === 'confirm') {
    lines.push('Review the preview, then click **Create these channels** or Cancel.');
  } else {
    lines.push('Use the buttons when you are ready.');
  }

  lines.push('', '_Cancel anytime. Illegal requests are blocked — everything else is fine._');

  return baseEmbed(guildId, {
    title: 'AI Channels · Interview',
    description: lines.join('\n').slice(0, 3900),
  });
}

function clarifyComponents(session) {
  const rows = [];
  if (session.waitingFor === 'confirm' && session.layoutPreview) {
    const btns = [];
    if (!session.previewOnly) {
      btns.push(
        new ButtonBuilder()
          .setCustomId('aibuild:confirm')
          .setLabel('Create these channels')
          .setStyle(ButtonStyle.Success)
      );
    }
    btns.push(
      new ButtonBuilder()
        .setCustomId('aibuild:preview')
        .setLabel('Regenerate preview')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('aibuild:cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
    );
    rows.push(new ActionRowBuilder().addComponents(...btns));
    return rows;
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('aibuild:type:text')
        .setLabel('Prefer text')
        .setStyle(session.type === 'text' ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('aibuild:type:voice')
        .setLabel('Prefer voice')
        .setStyle(session.type === 'voice' ? ButtonStyle.Success : ButtonStyle.Secondary)
    )
  );
  rows.push(
    new ActionRowBuilder().addComponents(
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
        .setStyle(session.perm === 'staff' ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('aibuild:perm:vip')
        .setLabel('VIP')
        .setStyle(session.perm === 'vip' ? ButtonStyle.Success : ButtonStyle.Secondary)
    )
  );
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('aibuild:plan')
        .setLabel(interviewReady(session) ? 'Generate preview' : 'Answer the questions in chat first')
        .setStyle(interviewReady(session) ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(!interviewReady(session)),
      new ButtonBuilder().setCustomId('aibuild:cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
    )
  );
  return rows;
}

function sessionReadyEnough(session) {
  return interviewReady(session);
}

function composePromptFromSession(session) {
  const bits = [];
  if (session.serverAbout) bits.push(`Server is about: ${session.serverAbout}.`);
  if (session.needs) bits.push(`Must include: ${session.needs}.`);
  if (session.prompt) bits.push(`Original request: ${session.prompt}.`);
  if (session.type) bits.push(`Prefer channel type: ${session.type}.`);
  if (session.perm === 'readonly') bits.push('Permissions: read-only for @everyone where it fits.');
  else if (session.perm === 'staff') bits.push('Permissions: staff-only where it fits.');
  else if (session.perm === 'open') bits.push('Permissions: everyone can chat in community channels.');
  if (session.purpose) bits.push(`Extra detail: ${session.purpose}`);
  if (!session.allowFullLayout) {
    bits.push(
      'IMPORTANT: Create only a small focused layout for what they asked — not a full Discord server rebuild. Prefer permission/rename actions on existing channels when they asked to fix those.'
    );
  }
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

function readGeminiApiKey() {
  const fromEnv = String(
    process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_AI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      ''
  ).trim();
  if (fromEnv) return fromEnv;
  for (const name of GEMINI_KEY_FILES) {
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

/**
 * Gemini Flash — strong at JSON layouts. Optional; falls back to You.com.
 */
async function geminiGenerate(prompt, { json = false } = {}) {
  const key = readGeminiApiKey();
  if (!key) throw new Error('Missing Gemini API key');

  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: json ? 0.2 : 0.5,
      maxOutputTokens: 4096,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini bad response (${res.status}): ${raw.slice(0, 200)}`);
  }
  if (!res.ok) {
    const detail = data?.error?.message || raw.slice(0, 200);
    throw new Error(`Gemini ${res.status}: ${detail}`);
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('') || '';
  if (!text.trim()) throw new Error('Gemini returned no text');
  return text.trim();
}

/**
 * Prefer Gemini for structured Discord plans when a key exists; else You.com.
 * Chat (`ask`) stays on You.com unless only Gemini is configured.
 */
async function aiComplete(prompt, { webSearch = false, preferJson = false } = {}) {
  const hasGemini = !!readGeminiApiKey();
  const hasYou = !!readYouApiKey();
  if (!hasGemini && !hasYou) {
    throw new Error('Missing AI key — add you-api-key.txt or gemini-api-key.txt');
  }

  if (preferJson && hasGemini) {
    try {
      return await geminiGenerate(prompt, { json: true });
    } catch (err) {
      console.warn('Gemini plan failed, falling back:', err.message);
      if (!hasYou) throw err;
    }
  }

  if (hasYou) {
    try {
      return await youExpress(prompt, { webSearch });
    } catch (err) {
      if (hasGemini) {
        console.warn('You.com failed, trying Gemini:', err.message);
        return geminiGenerate(prompt, { json: preferJson });
      }
      throw err;
    }
  }

  return geminiGenerate(prompt, { json: preferJson });
}

function stripChannelKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/[★・｜|\-_\s╭╰│─˅]+/gu, '')
    .trim();
}

/** Drop new channels that already exist (by stripped name). */
function filterPlanAgainstGuild(guild, layout, actions) {
  if (!guild) return { layout, actions, skipped: [] };
  const existingKeys = new Set(
    [...guild.channels.cache.values()]
      .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice)
      .map((c) => stripChannelKey(c.name))
      .filter(Boolean)
  );
  const skipped = [];
  const nextLayout = [];
  for (const cat of layout || []) {
    const channels = [];
    for (const ch of cat.channels || []) {
      const key = stripChannelKey(ch.name);
      if (key && existingKeys.has(key)) {
        skipped.push(ch.name);
        continue;
      }
      if (key) existingKeys.add(key);
      channels.push(ch);
    }
    if (channels.length) nextLayout.push({ ...cat, channels });
  }
  return { layout: nextLayout, actions: actions || [], skipped };
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
  const maxCat = defaults.allowFullLayout ? MAX_CATEGORIES_FULL : MAX_CATEGORIES;
  const maxCh = defaults.allowFullLayout ? MAX_CHANNELS_PER_CAT_FULL : MAX_CHANNELS_PER_CAT;

  const layout = cats.slice(0, maxCat).map((cat) => {
    const channels = Array.isArray(cat.channels) ? cat.channels : [];
    const staffOnly = !!cat.staffOnly || defaults.perm === 'staff';
    const vipOnly = !!cat.vipOnly || defaults.perm === 'vip';
    return {
      name: sanitizeCategoryName(cat.name, style),
      staffOnly,
      vipOnly,
      channels: channels.slice(0, maxCh).map((ch) => {
        const type =
          String(ch.type || defaults.type || 'text').toLowerCase() === 'voice' ? 'voice' : 'text';
        let perm = ch.perm || defaults.perm || null;
        if (perm === 'open') perm = null;
        if (vipOnly && !perm) perm = 'vip';
        if (staffOnly && !perm) perm = 'staff';
        return {
          name: sanitizeChannelName(ch.name, type, style),
          type,
          perm,
        };
      }),
    };
  });

  const actions = normalizeActions(parsed?.actions);
  return { layout, actions };
}

function normalizeActions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const a of raw.slice(0, MAX_AI_ACTIONS)) {
    if (!a || typeof a !== 'object') continue;
    const op = String(a.op || a.action || '').toLowerCase();
    const match = String(a.match || a.channel || a.name || '').trim().slice(0, 100);
    if (!match) continue;
    if (op === 'setperm' || op === 'perm' || op === 'permission') {
      let perm = String(a.perm || a.permission || 'readonly').toLowerCase();
      if (perm === 'open' || perm === 'everyone' || perm === 'default') perm = 'default';
      if (!['readonly', 'logs', 'staff', 'vip', 'default'].includes(perm)) continue;
      out.push({ op: 'setPerm', match, perm });
    } else if (op === 'rename') {
      const name = String(a.to || a.newName || a.name || '').trim().slice(0, 100);
      if (!name) continue;
      out.push({ op: 'rename', match, name });
    } else if (op === 'settopic' || op === 'topic') {
      const topic = String(a.topic || a.text || '').trim().slice(0, 1024);
      if (!topic) continue;
      out.push({ op: 'setTopic', match, topic });
    } else if (op === 'lock') {
      out.push({ op: 'setPerm', match, perm: 'readonly' });
    } else if (op === 'unlock') {
      out.push({ op: 'setPerm', match, perm: 'default' });
    }
  }
  return out;
}

function existingChannelsSummary(guild) {
  const cats = [...guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildCategory);
  const lines = [];
  for (const cat of cats.slice(0, 12)) {
    const kids = [...guild.channels.cache.values()]
      .filter((c) => c.parentId === cat.id)
      .slice(0, 10)
      .map((c) => c.name);
    lines.push(`${cat.name}: ${kids.join(', ') || '(empty)'}`);
  }
  const orphans = [...guild.channels.cache.values()]
    .filter(
      (c) =>
        !c.parentId &&
        c.type !== ChannelType.GuildCategory &&
        (c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice)
    )
    .slice(0, 8)
    .map((c) => c.name);
  if (orphans.length) lines.push(`(no category): ${orphans.join(', ')}`);
  return lines.join('\n').slice(0, 1500) || '(no channels yet)';
}

function findChannelByLooseName(guild, match) {
  const needle = String(match || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_/]/gu, '')
    .trim();
  if (!needle) return null;
  const channels = [...guild.channels.cache.values()].filter(
    (c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice
  );
  const exact = channels.find((c) => c.name.toLowerCase() === needle);
  if (exact) return exact;
  const stripped = (n) =>
    n
      .toLowerCase()
      .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
      .replace(/[★・｜|\-_\s]+/gu, '')
      .trim();
  const nNeedle = stripped(needle);
  return (
    channels.find((c) => stripped(c.name) === nNeedle) ||
    channels.find((c) => stripped(c.name).includes(nNeedle) || nNeedle.includes(stripped(c.name))) ||
    null
  );
}

async function planChannelLayout(userPrompt, ctx, defaults = {}, guild = null) {
  const style = ctx.style || 'star';
  const follow = ctx.followTemplate !== false;
  const examples = follow && ctx.template ? templateExamples(ctx.template) : '';
  const maxCat = defaults.allowFullLayout ? MAX_CATEGORIES_FULL : MAX_CATEGORIES;
  const maxCh = defaults.allowFullLayout ? MAX_CHANNELS_PER_CAT_FULL : MAX_CHANNELS_PER_CAT;
  const existing = guild ? existingChannelsSummary(guild) : '';
  const themes = detectThemes(
    userPrompt,
    defaults.serverAbout,
    defaults.needs,
    defaults.purpose
  );
  const themeExamples = examplesForPrompt(themes);

  const system = [
    'You are Ougi’s Discord layout engineer. Design channel layouts and safe adjustments.',
    'Reply with ONLY valid JSON (no markdown fences, no commentary).',
    'Schema:',
    '{"categories":[{"name":"string","staffOnly":false,"vipOnly":false,"channels":[{"name":"string","type":"text|voice","perm":"readonly|staff|vip|logs|null"}]}],"actions":[{"op":"setPerm|rename|setTopic|lock|unlock","match":"existing-channel-name","perm":"readonly|staff|vip|logs|default","to":"new-name","topic":"string"}]}',
    `Limits: max ${maxCat} new categories, max ${maxCh} new channels each, max ${MAX_AI_ACTIONS} actions.`,
    'categories = NEW channels to create. actions = change EXISTING channels (permissions, rename, topic). Prefer actions when the user asks to fix/change perms or rename.',
    'You may return categories:[], actions:[...] only — or categories with empty actions.',
    playbookForPrompt(),
    themeExamples,
    defaults.allowFullLayout
      ? 'User confirmed a larger layout — still stay organized and avoid junk channels.'
      : 'CRITICAL: Do NOT rebuild a whole Discord server. Only add/adjust what they asked for.',
    'Never delete or wipe channels. Never invent malware/phishing channel purposes.',
    'Policy: refuse ONLY clearly illegal server purposes. Allow everything else.',
    'ILLEGAL → return {"categories":[],"actions":[]}: child sexual content, doxxing/swatting, phishing/token-stealing/carding/ransomware, murder-for-hire, terrorism, human trafficking.',
    'LEGAL / ALLOWED: gaming, cheats/mods, shops, support, roleplay, adult NSFW 18+ (not minors), any non-illegal theme.',
    'perm on new channels: readonly (announce/rules), staff, vip, logs, or null/open for normal chat.',
    'For setPerm actions use match = existing channel name (loose). Skip creating anything already listed under Existing channels.',
  ];

  if (existing) {
    system.push('Existing channels (adjust these with actions when asked; do not recreate):', existing);
  }
  if (defaults.type) system.push(`Prefer channel type for new channels: ${defaults.type}.`);
  if (defaults.perm === 'readonly') system.push('Prefer permissions: read-only where it fits.');
  if (defaults.perm === 'staff') system.push('Prefer permissions: staff-only where it fits.');
  if (defaults.perm === 'vip') system.push('Prefer permissions: VIP-only where it fits.');
  if (defaults.perm === 'open') system.push('Prefer permissions: everyone can chat in community channels.');
  if (defaults.purpose) system.push(`Extra detail: ${defaults.purpose}`);
  if (defaults.serverAbout) system.push(`Server theme / about: ${defaults.serverAbout}`);
  if (defaults.needs) system.push(`Must include / do: ${defaults.needs}`);

  if (follow && ctx.template) {
    system.push(
      `ACTIVE TEMPLATE: "${ctx.template.name}" (id: ${ctx.template.id}).`,
      `Match this template's naming style and category framing for NEW channels only.`,
      `Style code: ${style}.`,
      'Examples from the active template (copy this look exactly):',
      examples || '(no examples)'
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

  const text = await aiComplete(system.join('\n'), { preferJson: true });
  const parsed = extractJsonObject(text);
  const normalized = normalizeLayout(
    parsed,
    follow ? style : style === 'plain' ? 'plain' : style,
    defaults
  );
  const filtered = filterPlanAgainstGuild(guild, normalized.layout, normalized.actions);
  if (filtered.skipped.length) {
    console.log(
      `AI plan skipped ${filtered.skipped.length} duplicate channel(s): ${filtered.skipped.join(', ')}`
    );
  }
  return { layout: filtered.layout, actions: filtered.actions, skipped: filtered.skipped };
}

async function createChannelsFromLayout(guild, layout, { reason = 'Ougi AI channels' } = {}) {
  const lines = [];
  const categoryIds = [];
  const channelIds = [];
  const categoryRefs = [];
  const staffRoles = findStaffRoles(guild, null);
  const vipRoles = [...findVipRoles(guild).values()];

  for (const cat of layout) {
    const category = await guild.channels.create({
      name: cat.name,
      type: ChannelType.GuildCategory,
      reason,
    });
    lines.push(category.name);
    categoryIds.push(category.id);
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
      channelIds.push(channel.id);
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
      lines.push(`  ${ch.type === 'voice' ? '🔊' : '#'}${channel.name}${tag}`);
    }
  }

  for (let i = 0; i < categoryRefs.length; i++) {
    await categoryRefs[i].setPosition(i, { reason }).catch(() => {});
  }

  return { lines, categoryIds, channelIds };
}

async function applyAiActions(guild, actions, { reason = 'Ougi AI adjust' } = {}) {
  const staffRoles = findStaffRoles(guild, null);
  const vipRoles = [...findVipRoles(guild).values()];
  const lines = [];
  const touchedIds = [];

  for (const act of actions || []) {
    const ch = findChannelByLooseName(guild, act.match);
    if (!ch) {
      lines.push(`• miss \`${act.match}\` (not found)`);
      continue;
    }
    try {
      if (act.op === 'setPerm') {
        if (act.perm === 'default') {
          await ch.permissionOverwrites.set([], reason);
          lines.push(`• perms #${ch.name} → **open (cleared overs)**`);
        } else {
          await applyChannelPermissions(ch, act.perm, guild, staffRoles, vipRoles);
          lines.push(`• perms #${ch.name} → **${act.perm}**`);
        }
        touchedIds.push(ch.id);
      } else if (act.op === 'rename') {
        const next = String(act.name || '').slice(0, 100);
        if (next && next !== ch.name) {
          await ch.setName(next, reason);
          lines.push(`• renamed → \`${next}\``);
          touchedIds.push(ch.id);
        }
      } else if (act.op === 'setTopic') {
        if (ch.isTextBased?.() && typeof ch.setTopic === 'function') {
          await ch.setTopic(act.topic, reason);
          lines.push(`• topic set on #${ch.name}`);
          touchedIds.push(ch.id);
        }
      }
    } catch (err) {
      lines.push(`• fail ${ch.name}: ${err.message || 'error'}`);
    }
  }
  return { lines, touchedIds };
}

function saveLastAiBuild(guildId, userId, { categoryIds = [], channelIds = [], actionChannelIds = [] } = {}) {
  const cfg = loadGuild(guildId);
  cfg.lastAiBuild = {
    at: Date.now(),
    by: userId,
    categoryIds: [...categoryIds],
    channelIds: [...new Set([...channelIds, ...actionChannelIds])],
    createdCategoryIds: [...categoryIds],
    createdChannelIds: [...channelIds],
  };
  saveGuild(guildId, cfg);
}

async function undoLastAiBuild(guild) {
  const cfg = loadGuild(guild.id);
  const last = cfg.lastAiBuild;
  if (!last || !last.at) throw new Error('Nothing to undo.');
  if (Date.now() - last.at > LAST_AI_BUILD_TTL_MS) {
    cfg.lastAiBuild = null;
    saveGuild(guild.id, cfg);
    throw new Error('Undo expired (2 hour window).');
  }

  const deleted = [];
  const createdChannels = last.createdChannelIds || last.channelIds || [];
  const createdCats = last.createdCategoryIds || last.categoryIds || [];

  for (const id of createdChannels) {
    const ch = guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
    if (!ch) continue;
    const name = ch.name;
    await ch.delete('Ougi AI undo').catch(() => {});
    deleted.push(`#${name}`);
  }
  for (const id of createdCats) {
    const ch = guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
    if (!ch) continue;
    const name = ch.name;
    await ch.delete('Ougi AI undo').catch(() => {});
    deleted.push(name);
  }

  cfg.lastAiBuild = null;
  saveGuild(guild.id, cfg);
  if (!deleted.length) throw new Error('Nothing left to undo (already deleted?).');
  return deleted;
}

function layoutPreview(layout, actions = []) {
  const parts = [];
  if (layout?.length) {
    parts.push(
      layout
        .map((cat) => {
          const flag = cat.vipOnly ? ' _(vip)_' : cat.staffOnly ? ' _(staff)_' : '';
          const lines = [`**${cat.name}**${flag}`];
          for (const ch of cat.channels) {
            const p = ch.perm ? ` 〔${ch.perm}〕` : '';
            lines.push(`  ${ch.type === 'voice' ? '🔊' : '#'} \`${ch.name}\`${p}`);
          }
          return lines.join('\n');
        })
        .join('\n')
    );
  }
  if (actions?.length) {
    parts.push(
      '**Adjust existing:**\n' +
        actions
          .map((a) => {
            if (a.op === 'setPerm') return `• set perm \`${a.match}\` → **${a.perm}**`;
            if (a.op === 'rename') return `• rename \`${a.match}\` → \`${a.name}\``;
            if (a.op === 'setTopic') return `• topic \`${a.match}\``;
            return `• ${a.op} \`${a.match}\``;
          })
          .join('\n')
    );
  }
  return parts.join('\n\n') || '_Nothing planned._';
}

function undoComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('aibuild:undo')
        .setLabel('Undo this build')
        .setStyle(ButtonStyle.Danger)
    ),
  ];
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
  const guildId = guild.id;
  const userId = messageOrInteraction.user?.id || messageOrInteraction.author?.id;
  const composed = composePromptFromSession(session);
  if (isDisallowedBuildPrompt(composed, session.serverAbout, session.needs, session.prompt)) {
    throw new Error(safetyBlockMessage());
  }

  const freeform = session.freeform || wantsFreeform(session.prompt || '');
  const ctx = resolveTemplateContext(guild, {
    freeform,
    styleOverride: session.styleOverride || null,
  });
  const footer = contextFooter(ctx);
  const defaults = {
    type: session.type || null,
    perm: session.perm || null,
    purpose: session.purpose || null,
    serverAbout: session.serverAbout || null,
    needs: session.needs || null,
    allowFullLayout: !!session.allowFullLayout,
  };

  let layout = Array.isArray(session.plannedLayout) ? session.plannedLayout : null;
  let actions = Array.isArray(session.plannedActions) ? session.plannedActions : null;
  let skipped = Array.isArray(session.skippedDuplicates) ? session.skippedDuplicates : [];

  if (!layout || previewOnly || session.forceReplan) {
    const planned = await planChannelLayout(composed, ctx, defaults, guild);
    layout = planned.layout;
    actions = planned.actions;
    skipped = planned.skipped || [];
  }

  if (!layout.length && !(actions && actions.length)) {
    throw new Error(
      'AI returned an empty plan. Try a clearer “about” + what to add/change. Non-illegal themes are fine.'
    );
  }
  let preview = layoutPreview(layout, actions);
  if (skipped.length) {
    preview += `\n\n_Skipped duplicates (already exist): ${skipped.slice(0, 12).join(', ')}_`;
  }

  if (previewOnly || session.previewOnly) {
    return {
      embeds: [
        baseEmbed(guildId, {
          title: 'AI Channels · Preview',
          description: `${preview}\n\n${footer}\nConfirm to apply (create + permission/rename actions).`,
        }),
      ],
      components: [],
      layout,
      actions,
      skipped,
      preview,
    };
  }

  const resultLines = [];
  let categoryIds = [];
  let channelIds = [];
  let actionChannelIds = [];

  if (layout.length) {
    const created = await createChannelsFromLayout(guild, layout);
    resultLines.push(...created.lines.map((l) => (l.startsWith('  ') ? l : `• ${l}`)));
    categoryIds = created.categoryIds;
    channelIds = created.channelIds;
  }
  if (actions?.length) {
    const applied = await applyAiActions(guild, actions);
    resultLines.push(...applied.lines);
    actionChannelIds = applied.touchedIds;
  }

  saveLastAiBuild(guildId, userId, { categoryIds, channelIds, actionChannelIds });

  const canUndo = categoryIds.length > 0 || channelIds.length > 0;
  return {
    embeds: [
      successEmbed(
        guildId,
        'AI applied',
        `${resultLines.join('\n')}\n\n${footer}${
          canUndo ? '\n\nUndo created channels within **2 hours**: button below or `askbuild undo`.' : ''
        }`.slice(0, 3900)
      ),
    ],
    components: canUndo ? undoComponents() : [],
  };
}


async function runAskBuild(message, args) {
  let previewOnly = false;
  let styleOverride = null;
  let forceFreeform = false;
  const parts = [...args];

  while (parts[0]) {
    const a = parts[0].toLowerCase();
    if (a === 'undo') {
      try {
        const deleted = await undoLastAiBuild(message.guild);
        return message.reply({
          embeds: [
            successEmbed(
              message.guild.id,
              'AI Undo',
              `Removed:\n${deleted.map((d) => `• ${d}`).join('\n')}`
            ),
          ],
        });
      } catch (err) {
        return message.reply({
          embeds: [errorEmbed(message.guild.id, 'AI Undo', err.message || 'Undo failed.')],
        });
      }
    }
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
          'Usage: `askbuild <idea>`\n' +
            'Ougi interviews you, previews create + permission/rename fixes, then applies.\n' +
            '`askbuild undo` — remove the last AI-created channels (2h)\n' +
            '`askbuild freeform …` — ignore active template'
        ),
      ],
    });
  }

  if (isDisallowedBuildPrompt(q)) {
    return message.reply({
      embeds: [
        errorEmbed(message.guild.id, 'AI Channels', safetyBlockMessage()),
      ],
    });
  }

  if (!rateOk(message.author.id)) {
    return message.reply({
      embeds: [errorEmbed(message.guild.id, 'AI Channels', 'Slow down — wait a few seconds.')],
    });
  }

  const freeform = forceFreeform || wantsFreeform(q);
  const session = {
    prompt: q,
    type: null,
    perm: null,
    purpose: null,
    serverAbout: null,
    needs: null,
    layoutPreview: null,
    plannedLayout: null,
    plannedActions: null,
    forceReplan: false,
    allowFullLayout: false,
    previewOnly: !!previewOnly,
    styleOverride,
    freeform,
    channelId: message.channel.id,
    waitingFor: 'about',
  };
  setPendingBuild(message.guild.id, message.author.id, session);

  return message.reply({
    embeds: [clarifyEmbed(message.guild.id, session)],
    components: clarifyComponents(session),
  });
}

async function generateInterviewPreview(messageOrInteraction, session) {
  session.forceReplan = true;
  const payload = await executeBuildFromSession(messageOrInteraction, session, { previewOnly: true });
  session.plannedLayout = payload.layout || [];
  session.plannedActions = payload.actions || [];
  session.skippedDuplicates = payload.skipped || [];
  session.layoutPreview = payload.preview || layoutPreview(session.plannedLayout, session.plannedActions);
  session.forceReplan = false;
  session.waitingFor = 'confirm';
  const uid = messageOrInteraction.user?.id || messageOrInteraction.author?.id;
  setPendingBuild(messageOrInteraction.guild.id, uid, session);
  return {
    embeds: [clarifyEmbed(messageOrInteraction.guild.id, session)],
    components: clarifyComponents(session),
  };
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

  if (id === 'aibuild:undo') {
    try {
      await interaction.deferUpdate();
      const deleted = await undoLastAiBuild(interaction.guild);
      return interaction.editReply({
        embeds: [
          successEmbed(
            interaction.guild.id,
            'AI Undo',
            `Removed:\n${deleted.map((d) => `• ${d}`).join('\n')}`
          ),
        ],
        components: [],
      });
    } catch (err) {
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          embeds: [errorEmbed(interaction.guild.id, 'AI Undo', err.message || 'Undo failed.')],
          components: [],
        });
      }
      return interaction.reply({
        embeds: [errorEmbed(interaction.guild.id, 'AI Undo', err.message || 'Undo failed.')],
        ephemeral: true,
      });
    }
  }

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
    if (!session.waitingFor || session.waitingFor === 'details') {
      session.waitingFor = session.serverAbout ? (session.needs ? 'ready' : 'needs') : 'about';
    }
    setPendingBuild(interaction.guild.id, interaction.user.id, session);
    return interaction.update({
      embeds: [clarifyEmbed(interaction.guild.id, session)],
      components: clarifyComponents(session),
    });
  }

  if (id.startsWith('aibuild:perm:')) {
    session.perm = id.split(':')[2];
    if (!session.waitingFor || session.waitingFor === 'details') {
      session.waitingFor = session.serverAbout ? (session.needs ? 'ready' : 'needs') : 'about';
    }
    setPendingBuild(interaction.guild.id, interaction.user.id, session);
    return interaction.update({
      embeds: [clarifyEmbed(interaction.guild.id, session)],
      components: clarifyComponents(session),
    });
  }

  if (id === 'aibuild:plan' || id === 'aibuild:preview') {
    if (!interviewReady(session)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            interaction.guild.id,
            'AI Channels',
            'Reply in chat first: what the server is about, then what to add.'
          ),
        ],
        ephemeral: true,
      });
    }

    await interaction.update({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'AI Channels',
          description: 'Generating preview… (nothing is created yet)',
        }),
      ],
      components: [],
    });

    try {
      const payload = await generateInterviewPreview(interaction, session);
      return interaction.editReply(payload);
    } catch (err) {
      console.error('AI preview failed:', err.message);
      return interaction.editReply({
        embeds: [errorEmbed(interaction.guild.id, 'AI Channels', err.message || 'Failed.')],
        components: [],
      });
    }
  }

  if (id === 'aibuild:confirm' || id === 'aibuild:go') {
    if (!interviewReady(session)) {
      return interaction.reply({
        embeds: [
          errorEmbed(
            interaction.guild.id,
            'AI Channels',
            'Finish the interview (about + what to add) and generate a preview first.'
          ),
        ],
        ephemeral: true,
      });
    }
    if (!session.type) session.type = 'text';
    if (!session.perm) session.perm = 'open';

    // Explicit “whole server” only if they asked during interview and confirm again here
    const wantFull =
      wantsFullServerLayout(session.prompt) ||
      wantsFullServerLayout(session.needs) ||
      wantsFullServerLayout(session.serverAbout);
    session.allowFullLayout = !!wantFull && session.waitingFor === 'confirm';

    await interaction.update({
      embeds: [
        baseEmbed(interaction.guild.id, {
          title: 'AI Channels',
          description: 'Creating channels from the preview…',
        }),
      ],
      components: [],
    });

    try {
      session.previewOnly = false;
      const payload = await executeBuildFromSession(interaction, session, { previewOnly: false });
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
 * Interview replies: (1) what the server is about (2) what to add → then preview button.
 * @returns {boolean} true if handled
 */
async function handlePendingBuildReply(message) {
  if (!message.guild || message.author.bot || !message.content) return false;
  const session = getPendingBuild(message.guild.id, message.author.id);
  if (!session) return false;
  if (session.channelId && message.channel.id !== session.channelId) return false;

  const { getCommandPrefixes } = require('../utils/store');
  const prefixes = getCommandPrefixes(message.guild.id);
  const content = message.content.trim();
  if (prefixes.some((p) => content.startsWith(p))) return false;

  const { memberHasAdmin } = require('../utils/helpers');
  if (!memberHasAdmin(message.member)) {
    clearPendingBuild(message.guild.id, message.author.id);
    return false;
  }

  if (session.waitingFor === 'confirm') {
    await message.reply({
      embeds: [
        errorEmbed(
          message.guild.id,
          'AI Channels',
          session.previewOnly
            ? 'Preview only — use **Regenerate preview** or **Cancel** (no create from `askbuild preview`).'
            : 'Preview is ready — use **Create these channels**, **Regenerate preview**, or **Cancel**.'
        ),
      ],
    });
    return true;
  }

  if (isDisallowedBuildPrompt(content, session.prompt, session.serverAbout, session.needs)) {
    clearPendingBuild(message.guild.id, message.author.id);
    await message.reply({
      embeds: [
        errorEmbed(
          message.guild.id,
          'AI Channels',
          `${safetyBlockMessage()}\nBuild cancelled.`
        ),
      ],
    });
    return true;
  }

  const clipped = content.slice(0, 400);

  if (session.waitingFor === 'about' || !session.serverAbout) {
    session.serverAbout = clipped;
    session.waitingFor = 'needs';
    setPendingBuild(message.guild.id, message.author.id, session);
    await message.reply({
      embeds: [clarifyEmbed(message.guild.id, session)],
      components: clarifyComponents(session),
    });
    return true;
  }

  if (session.waitingFor === 'needs' || !session.needs) {
    session.needs = clipped;
    if (wantsFullServerLayout(clipped) || wantsFullServerLayout(session.prompt)) {
      session.allowFullLayout = false; // still capped unless they confirm after preview
    }
    session.waitingFor = 'ready';
    setPendingBuild(message.guild.id, message.author.id, session);
    await message.reply({
      embeds: [
        baseEmbed(message.guild.id, {
          title: 'AI Channels · Interview',
          description:
            'Got it. Optional: pick text/voice + permissions below, then click **Generate preview**.\n' +
            'Nothing is created until you confirm the preview.',
        }),
        clarifyEmbed(message.guild.id, session),
      ],
      components: clarifyComponents(session),
    });
    return true;
  }

  // Extra detail after interview answers
  session.purpose = clipped;
  setPendingBuild(message.guild.id, message.author.id, session);
  await message.reply({
    embeds: [clarifyEmbed(message.guild.id, session)],
    components: clarifyComponents(session),
  });
  return true;
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
  if (!readYouApiKey() && !readGeminiApiKey()) {
    return message.reply({
      embeds: [
        errorEmbed(
          message.guild.id,
          'Ask',
          'AI key missing — add `you-api-key.txt` or `gemini-api-key.txt`.'
        ),
      ],
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
    const existing = existingChannelsSummary(message.guild);
    const prompt =
      `You are Ougi, a Discord server bot assistant. Be concise and practical.\n` +
      `${tplNote}\n` +
      `Discord tips: announcements/rules = read-only; staff chats = staff-only; don't wipe servers.\n` +
      `If they want channels built or perms fixed, tell an admin to use askbuild (interview → preview → confirm; undo with askbuild undo).\n` +
      `Existing channels snapshot:\n${existing}\n` +
      `User (${message.author.username}) asks: ${q}`;
    const answer = await aiComplete(prompt, { webSearch: false });
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
  readGeminiApiKey,
  youExpress,
  aiComplete,
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
  isDisallowedBuildPrompt,
  safetyBlockMessage,
  undoLastAiBuild,
};
