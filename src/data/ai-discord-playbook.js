'use strict';

/**
 * Discord playbook + few-shot layouts for Ougi AI channel builder.
 * Not model training — injected into every plan prompt so results stay Discord-smart.
 */

const PLAYBOOK = `
DISCORD CHANNEL DESIGN RULES (follow strictly):
1. Keep layouts SMALL and useful — only what was asked. Never wipe or rebuild the whole server.
2. Category order (typical): Info/Welcome → Community → Topic (game/shop/etc) → Voice → Staff.
3. Announcements / rules / updates / faq / welcome → perm "readonly".
4. Mod-logs / ticket-logs / reports → perm "logs" or staff-only category.
5. Staff / mods / admin chat → perm "staff" (or staffOnly category).
6. VIP lounge → perm "vip" if they have a VIP role; otherwise skip VIP.
7. General / chat / memes / media → open (perm null).
8. Voice: Lobby, Duo, Squad, AFK — don't over-create voice channels.
9. Support/tickets: announcements (readonly) + open ticket panel channel or "create-ticket" + staff ticket-logs.
10. Shops: products (readonly), prices, proof, purchase/tickets, delivery (staff), scammer-list (staff/readonly).
11. Cheat/mod communities: status (readonly), downloads-info (readonly), general, media, support, staff — never phishing/malware channel themes.
12. Do NOT duplicate channels that already exist (see existing list). Use actions to fix perms/rename instead.
13. Channel names: short, clear, match the server's naming style (★ / ・ / plain).
14. Never @everyone in channel names. No illegal purposes.
`.trim();

/** Compact example layouts the model can mirror (JSON fragments). */
const EXAMPLES = {
  gaming: {
    label: 'gaming community',
    json: {
      categories: [
        {
          name: 'Info',
          staffOnly: false,
          channels: [
            { name: 'announcements', type: 'text', perm: 'readonly' },
            { name: 'rules', type: 'text', perm: 'readonly' },
            { name: 'roles', type: 'text', perm: 'readonly' },
          ],
        },
        {
          name: 'Community',
          staffOnly: false,
          channels: [
            { name: 'general', type: 'text', perm: null },
            { name: 'looking-for-group', type: 'text', perm: null },
            { name: 'clips', type: 'text', perm: null },
          ],
        },
        {
          name: 'Voice',
          staffOnly: false,
          channels: [
            { name: 'Lobby', type: 'voice', perm: null },
            { name: 'Duo', type: 'voice', perm: null },
            { name: 'Squad', type: 'voice', perm: null },
          ],
        },
      ],
      actions: [],
    },
  },
  cheats: {
    label: 'game cheats / mods community',
    json: {
      categories: [
        {
          name: 'Info',
          staffOnly: false,
          channels: [
            { name: 'announcements', type: 'text', perm: 'readonly' },
            { name: 'status', type: 'text', perm: 'readonly' },
            { name: 'downloads-info', type: 'text', perm: 'readonly' },
          ],
        },
        {
          name: 'Community',
          staffOnly: false,
          channels: [
            { name: 'general', type: 'text', perm: null },
            { name: 'media', type: 'text', perm: null },
            { name: 'support', type: 'text', perm: null },
          ],
        },
        {
          name: 'Staff',
          staffOnly: true,
          channels: [
            { name: 'staff-chat', type: 'text', perm: 'staff' },
            { name: 'logs', type: 'text', perm: 'logs' },
          ],
        },
      ],
      actions: [],
    },
  },
  shop: {
    label: 'shop / store',
    json: {
      categories: [
        {
          name: 'Shop',
          staffOnly: false,
          channels: [
            { name: 'products', type: 'text', perm: 'readonly' },
            { name: 'prices', type: 'text', perm: 'readonly' },
            { name: 'proof', type: 'text', perm: 'readonly' },
            { name: 'purchase', type: 'text', perm: null },
          ],
        },
        {
          name: 'Staff',
          staffOnly: true,
          channels: [
            { name: 'orders', type: 'text', perm: 'staff' },
            { name: 'delivery', type: 'text', perm: 'staff' },
          ],
        },
      ],
      actions: [],
    },
  },
  support: {
    label: 'support / tickets',
    json: {
      categories: [
        {
          name: 'Support',
          staffOnly: false,
          channels: [
            { name: 'faq', type: 'text', perm: 'readonly' },
            { name: 'create-ticket', type: 'text', perm: null },
            { name: 'general-help', type: 'text', perm: null },
          ],
        },
        {
          name: 'Staff',
          staffOnly: true,
          channels: [
            { name: 'ticket-logs', type: 'text', perm: 'logs' },
            { name: 'staff', type: 'text', perm: 'staff' },
          ],
        },
      ],
      actions: [],
    },
  },
  community: {
    label: 'general community',
    json: {
      categories: [
        {
          name: 'Welcome',
          staffOnly: false,
          channels: [
            { name: 'announcements', type: 'text', perm: 'readonly' },
            { name: 'rules', type: 'text', perm: 'readonly' },
            { name: 'introductions', type: 'text', perm: null },
          ],
        },
        {
          name: 'Chat',
          staffOnly: false,
          channels: [
            { name: 'general', type: 'text', perm: null },
            { name: 'memes', type: 'text', perm: null },
            { name: 'media', type: 'text', perm: null },
          ],
        },
      ],
      actions: [],
    },
  },
  permsFix: {
    label: 'fix permissions on existing channels',
    json: {
      categories: [],
      actions: [
        { op: 'setPerm', match: 'announcements', perm: 'readonly' },
        { op: 'setPerm', match: 'rules', perm: 'readonly' },
        { op: 'setPerm', match: 'staff-chat', perm: 'staff' },
        { op: 'setPerm', match: 'mod-logs', perm: 'logs' },
      ],
    },
  },
};

function detectThemes(...parts) {
  const t = parts.filter(Boolean).join(' ').toLowerCase();
  const themes = [];
  if (/\b(cheat|cheats|hack|hacks|trainer|trainers|mod\b|mods|script|scripts|spoofer|undetected)\b/.test(t)) {
    themes.push('cheats');
  }
  if (/\b(shop|store|sell|selling|buy|payment|products?|prices?)\b/.test(t)) themes.push('shop');
  if (/\b(ticket|tickets|support|help\s*desk|customer\s*service)\b/.test(t)) themes.push('support');
  if (/\b(game|gaming|gamer|valorant|fortnite|minecraft|roblox|fps|pvp|esports)\b/.test(t)) {
    themes.push('gaming');
  }
  if (/\b(perm|permission|readonly|read-only|staff\s*only|lock|unlock|rename)\b/.test(t)) {
    themes.push('permsFix');
  }
  if (!themes.length) themes.push('community');
  // Unique, prefer specific over generic
  return [...new Set(themes)].slice(0, 3);
}

function examplesForPrompt(themes) {
  const list = (themes && themes.length ? themes : ['community']).filter((k) => EXAMPLES[k]);
  if (!list.length) list.push('community');
  const chunks = [];
  for (const key of list) {
    const ex = EXAMPLES[key];
    chunks.push(
      `EXAMPLE (${ex.label}) — mirror structure when relevant:\n${JSON.stringify(ex.json)}`
    );
  }
  return chunks.join('\n\n');
}

function playbookForPrompt() {
  return PLAYBOOK;
}

module.exports = {
  PLAYBOOK,
  EXAMPLES,
  detectThemes,
  examplesForPrompt,
  playbookForPrompt,
};
