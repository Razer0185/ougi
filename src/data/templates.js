/**
 * Builds a connected category tree preview:
 *   ▲ CATEGORY
 *   │ ├─ #channel
 *   │ └─ 🔊 voice
 *   ▼
 */
function treePreview(categories) {
  const lines = [];
  categories.forEach((cat, ci) => {
    const isLastCat = ci === categories.length - 1;
    lines.push(`▲ ${cat.name}`);
    const channels = cat.channels || [];
    if (channels.length === 0) {
      lines.push('│   (empty)');
    } else {
      channels.forEach((ch, i) => {
        const last = i === channels.length - 1;
        const branch = last ? '└─' : '├─';
        const decorated = /[・|]|[\u{1F300}-\u{1FAFF}]/u.test(ch.name);
        const label =
          ch.type === 'voice'
            ? decorated
              ? ch.name
              : `🔊 ${ch.name}`
            : decorated
              ? ch.name
              : `#${ch.name}`;
        lines.push(`│ ${branch} ${label}`);
      });
    }
    lines.push(isLastCat ? '▼' : '│');
    if (!isLastCat) lines.push('│');
  });
  return lines.join('\n');
}

/** Role display: 👑・Owner · 👑｜Owner · 💀 ★ Owner */
function styledRoleName(baseName, emoji, style = 'dot') {
  const clean = String(baseName)
    .replace(/^\d+\s*\+\s*/, '')
    .replace(/^★\s*/u, '')
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u, '')
    .replace(/^[・｜|│┊\-_.\s★]+/u, '')
    .trim();
  const em = emoji || '•';
  if (style === 'star') return `${em} ★ ${clean}`;
  if (style === 'pipe') return `${em}｜${clean}`;
  if (style === 'dash') return `${em}-${clean}`;
  return `${em}・${clean}`;
}

const SERVER_TEMPLATES = [
  {
    id: 'community',
    name: 'Community Hub',
    description: 'General community — info, chat, tickets (buyer priority), voice, and staff.',
    categories: [
      {
        name: '📌 INFO',
        channels: [
          { name: 'rules', type: 'text', perm: 'readonly' },
          { name: 'announcements', type: 'text', perm: 'readonly' },
          { name: 'roles', type: 'text', perm: 'readonly' },
          { name: 'updates', type: 'text', perm: 'readonly' },
        ],
      },
      {
        name: '💬 COMMUNITY',
        channels: [
          { name: 'general', type: 'text' },
          { name: 'introductions', type: 'text' },
          { name: 'memes', type: 'text' },
          { name: 'media', type: 'text' },
          { name: 'bot-commands', type: 'text' },
          { name: 'do-not-type', type: 'text', honeypot: true },
        ],
      },
      {
        name: '🔊 VOICE',
        channels: [
          { name: 'Lounge', type: 'voice' },
          { name: 'Gaming', type: 'voice' },
          { name: 'AFK', type: 'voice' },
        ],
      },
      {
        name: '🛡️ STAFF',
        channels: [
          { name: 'staff-chat', type: 'text', perm: 'staff' },
          { name: 'ticket-logs', type: 'text', perm: 'logs' },
          { name: 'mod-logs', type: 'text', perm: 'logs' },
          { name: 'reports', type: 'text', perm: 'staff' },
        ],
        staffOnly: true,
      },
      {
        name: '🎫 SUPPORT',
        channels: [
          { name: 'create-ticket', type: 'text', perm: 'readonly' },
          { name: 'priority-support', type: 'text', perm: 'staff' },
        ],
      },
    ],
  },
  {
    id: 'gaming',
    name: 'Gaming Server',
    description: 'Squads, LFG, clips, and game voice rooms.',
    categories: [
      {
        name: '📌 INFO',
        channels: [
          { name: 'announcements', type: 'text', perm: 'readonly' },
          { name: 'rules', type: 'text', perm: 'readonly' },
          { name: 'roles', type: 'text', perm: 'readonly' },
        ],
      },
      {
        name: '💬 CHAT',
        channels: [
          { name: 'general', type: 'text' },
          { name: 'clips', type: 'text' },
          { name: 'highlights', type: 'text' },
          { name: 'looking-for-duo', type: 'text' },
          { name: 'do-not-type', type: 'text', honeypot: true },
        ],
      },
      {
        name: '🎮 LFG',
        channels: [
          { name: 'looking-for-group', type: 'text' },
          { name: 'scrims', type: 'text' },
        ],
      },
      {
        name: '🔊 VOICE',
        channels: [
          { name: 'Lobby', type: 'voice' },
          { name: 'Ranked', type: 'voice' },
          { name: 'Casual', type: 'voice' },
          { name: 'AFK', type: 'voice' },
        ],
      },
      {
        name: '🛡️ STAFF',
        channels: [
          { name: 'staff-chat', type: 'text', perm: 'staff' },
          { name: 'mod-logs', type: 'text', perm: 'logs' },
          { name: 'reports', type: 'text', perm: 'staff' },
        ],
        staffOnly: true,
      },
    ],
  },
  {
    id: 'support',
    name: 'Support / Brand',
    description: 'Welcome, tickets-ready support, and team rooms.',
    categories: [
      {
        name: '👋 WELCOME',
        channels: [
          { name: 'welcome', type: 'text', perm: 'readonly' },
          { name: 'faq', type: 'text', perm: 'readonly' },
          { name: 'updates', type: 'text', perm: 'readonly' },
          { name: 'rules', type: 'text', perm: 'readonly' },
        ],
      },
      {
        name: '🎫 SUPPORT',
        channels: [
          { name: 'create-ticket', type: 'text', perm: 'readonly' },
          { name: 'priority-support', type: 'text', perm: 'staff' },
        ],
      },
      {
        name: '💬 COMMUNITY',
        channels: [
          { name: 'general', type: 'text' },
          { name: 'feedback', type: 'text' },
          { name: 'do-not-type', type: 'text', honeypot: true },
        ],
      },
      {
        name: '🔊 VOICE',
        channels: [
          { name: 'Waiting Room', type: 'voice' },
          { name: 'Support Call', type: 'voice' },
        ],
      },
      {
        name: '🛡️ TEAM',
        channels: [
          { name: 'team-chat', type: 'text', perm: 'staff' },
          { name: 'ticket-logs', type: 'text', perm: 'logs' },
          { name: 'mod-logs', type: 'text', perm: 'logs' },
        ],
        staffOnly: true,
      },
    ],
  },
  {
    id: 'creator',
    name: 'Creator Hub',
    description: 'Content creator layout — drops, fans, VIP (locked), and stream voice.',
    categories: [
      {
        name: '📢 CONTENT',
        channels: [
          { name: 'announcements', type: 'text', perm: 'readonly' },
          { name: 'uploads', type: 'text', perm: 'readonly' },
          { name: 'schedule', type: 'text', perm: 'readonly' },
        ],
      },
      {
        name: '💬 FANS',
        channels: [
          { name: 'general', type: 'text' },
          { name: 'clips', type: 'text' },
          { name: 'fan-art', type: 'text' },
          { name: 'do-not-type', type: 'text', honeypot: true },
        ],
      },
      {
        name: '⭐ VIP',
        channels: [
          { name: 'vip-chat', type: 'text', perm: 'vip' },
          { name: 'vip-perks', type: 'text', perm: 'readonly' },
          { name: 'VIP Lounge', type: 'voice', perm: 'vip' },
        ],
        vipOnly: true,
      },
      {
        name: '🎙️ STREAM',
        channels: [
          { name: 'Stream Waiting', type: 'voice' },
          { name: 'After Party', type: 'voice' },
        ],
      },
      {
        name: '🛡️ TEAM',
        channels: [
          { name: 'mods', type: 'text', perm: 'staff' },
          { name: 'planning', type: 'text', perm: 'staff' },
          { name: 'mod-logs', type: 'text', perm: 'logs' },
        ],
        staffOnly: true,
      },
    ],
  },
  {
    id: 'school',
    name: 'Study / Class',
    description: 'Classes, homework help, and quiet study voice.',
    categories: [
      {
        name: '📚 INFO',
        channels: [
          { name: 'announcements', type: 'text', perm: 'readonly' },
          { name: 'resources', type: 'text', perm: 'readonly' },
          { name: 'rules', type: 'text', perm: 'readonly' },
        ],
      },
      {
        name: '📝 STUDY',
        channels: [
          { name: 'general', type: 'text' },
          { name: 'homework-help', type: 'text' },
          { name: 'notes', type: 'text' },
          { name: 'do-not-type', type: 'text', honeypot: true },
        ],
      },
      {
        name: '🔊 VOICE',
        channels: [
          { name: 'Study Hall', type: 'voice' },
          { name: 'Group Project', type: 'voice' },
          { name: 'Quiet Room', type: 'voice' },
        ],
      },
      {
        name: '🛡️ STAFF',
        channels: [
          { name: 'teachers', type: 'text', perm: 'staff' },
          { name: 'mod-chat', type: 'text', perm: 'staff' },
          { name: 'mod-logs', type: 'text', perm: 'logs' },
        ],
        staffOnly: true,
      },
    ],
  },
  {
    id: 'social',
    name: 'Social Hangout',
    description: 'Chill social server — chat, media, and hangout VCs.',
    categories: [
      {
        name: '🚪 LOBBY',
        channels: [
          { name: 'welcome', type: 'text', perm: 'readonly' },
          { name: 'rules', type: 'text', perm: 'readonly' },
          { name: 'roles', type: 'text', perm: 'readonly' },
        ],
      },
      {
        name: '💭 CHAT',
        channels: [
          { name: 'general', type: 'text' },
          { name: 'introductions', type: 'text' },
          { name: 'off-topic', type: 'text' },
          { name: 'media', type: 'text' },
          { name: 'do-not-type', type: 'text', honeypot: true },
        ],
      },
      {
        name: '🎉 FUN',
        channels: [
          { name: 'memes', type: 'text' },
          { name: 'pets', type: 'text' },
          { name: 'music', type: 'text' },
        ],
      },
      {
        name: '🔊 HANGOUT',
        channels: [
          { name: 'Hangout', type: 'voice' },
          { name: 'Music', type: 'voice' },
          { name: 'Late Night', type: 'voice' },
        ],
      },
      {
        name: '🛡️ STAFF',
        channels: [
          { name: 'staff', type: 'text', perm: 'staff' },
          { name: 'mod-logs', type: 'text', perm: 'logs' },
        ],
        staffOnly: true,
      },
    ],
  },
  {
    id: 'aesthetic-dot',
    name: 'Aesthetic ・ Dot',
    description: 'Decorated layout — 📢・channels with ╭ │ ╰ (empty end closer at the bottom).',
    categories: [
      {
        name: '╭─── Important ⚠️ ˅',
        channels: [
          { name: '📜・rules', type: 'text', perm: 'readonly' },
          { name: '📢・announcements', type: 'text', perm: 'readonly' },
          { name: '🟣・news', type: 'text', perm: 'readonly' },
          { name: '✨・roles', type: 'text', perm: 'readonly' },
        ],
      },
      {
        name: '│─── Community 💬 ˅',
        channels: [
          { name: '💬・general', type: 'text' },
          { name: '📷・media', type: 'text' },
          { name: '😂・memes', type: 'text' },
          { name: '🤖・commands', type: 'text' },
          { name: '⚠・do-not-type', type: 'text', honeypot: true },
        ],
      },
      {
        name: '│─── Voice 🔊 ˅',
        channels: [
          { name: '🔊・lounge', type: 'voice' },
          { name: '🎮・gaming', type: 'voice' },
          { name: '💤・afk', type: 'voice' },
        ],
      },
      {
        name: '│─── Staff 🛡️ ˅',
        channels: [
          { name: '🛡️・staff-chat', type: 'text', perm: 'staff' },
          { name: '📋・mod-logs', type: 'text', perm: 'logs' },
          { name: '🎫・ticket-logs', type: 'text', perm: 'logs' },
          { name: '🚨・reports', type: 'text', perm: 'staff' },
        ],
        staffOnly: true,
      },
      {
        name: '│─── Support 🎫 ˅',
        channels: [
          { name: '🎫・create-ticket', type: 'text', perm: 'readonly' },
          { name: '⚡・priority-support', type: 'text', perm: 'staff' },
        ],
      },
      {
        name: '╰──── End 🔚',
        channels: [],
        footer: true,
      },
    ],
  },
  {
    id: 'aesthetic-pipe',
    name: 'Aesthetic | Pipe',
    description: 'Decorated layout — 📕｜channels with ╭ │ ╰ (empty end closer at the bottom).',
    categories: [
      {
        name: '╭─── Important ⚠️ ˅',
        channels: [
          { name: '📕｜rules', type: 'text', perm: 'readonly' },
          { name: '📢｜announcements', type: 'text', perm: 'readonly' },
          { name: '🟣｜news', type: 'text', perm: 'readonly' },
          { name: '✨｜roles', type: 'text', perm: 'readonly' },
        ],
      },
      {
        name: '│─── Community 💬 ˅',
        channels: [
          { name: '💬｜general', type: 'text' },
          { name: '📷｜media', type: 'text' },
          { name: '😂｜memes', type: 'text' },
          { name: '🤖｜commands', type: 'text' },
          { name: '⚠｜do-not-type', type: 'text', honeypot: true },
        ],
      },
      {
        name: '│─── Voice 🔊 ˅',
        channels: [
          { name: '🔊｜lounge', type: 'voice' },
          { name: '🎮｜gaming', type: 'voice' },
          { name: '💤｜afk', type: 'voice' },
        ],
      },
      {
        name: '│─── Staff 🛡️ ˅',
        channels: [
          { name: '🛡️｜staff-chat', type: 'text', perm: 'staff' },
          { name: '📋｜mod-logs', type: 'text', perm: 'logs' },
          { name: '🎫｜ticket-logs', type: 'text', perm: 'logs' },
          { name: '🚨｜reports', type: 'text', perm: 'staff' },
        ],
        staffOnly: true,
      },
      {
        name: '│─── Support 🎫 ˅',
        channels: [
          { name: '🎫｜create-ticket', type: 'text', perm: 'readonly' },
          { name: '⚡｜priority-support', type: 'text', perm: 'staff' },
        ],
      },
      {
        name: '╰──── End 🔚',
        channels: [],
        footer: true,
      },
    ],
  },
  {
    id: 'aesthetic-dash',
    name: 'Aesthetic - Dash',
    description: 'Decorated layout — 📜-channels with ╭ │ ╰ (empty end closer at the bottom).',
    categories: [
      {
        name: '╭─── Important ⚠️ ˅',
        channels: [
          { name: '📜-rules', type: 'text', perm: 'readonly' },
          { name: '📢-announcements', type: 'text', perm: 'readonly' },
          { name: '🟣-news', type: 'text', perm: 'readonly' },
          { name: '✨-roles', type: 'text', perm: 'readonly' },
        ],
      },
      {
        name: '│─── Community 💬 ˅',
        channels: [
          { name: '💬-general', type: 'text' },
          { name: '📷-media', type: 'text' },
          { name: '😂-memes', type: 'text' },
          { name: '🤖-commands', type: 'text' },
          { name: '⚠-do-not-type', type: 'text', honeypot: true },
        ],
      },
      {
        name: '│─── Voice 🔊 ˅',
        channels: [
          { name: '🔊-lounge', type: 'voice' },
          { name: '🎮-gaming', type: 'voice' },
          { name: '💤-afk', type: 'voice' },
        ],
      },
      {
        name: '│─── Staff 🛡️ ˅',
        channels: [
          { name: '🛡️-staff-chat', type: 'text', perm: 'staff' },
          { name: '📋-mod-logs', type: 'text', perm: 'logs' },
          { name: '🎫-ticket-logs', type: 'text', perm: 'logs' },
          { name: '🚨-reports', type: 'text', perm: 'staff' },
        ],
        staffOnly: true,
      },
      {
        name: '│─── Support 🎫 ˅',
        channels: [
          { name: '🎫-create-ticket', type: 'text', perm: 'readonly' },
          { name: '⚡-priority-support', type: 'text', perm: 'staff' },
        ],
      },
      {
        name: '╰──── End 🔚',
        channels: [],
        footer: true,
      },
    ],
  },
  {
    id: 'aesthetic-star',
    name: 'Aesthetic ★ Star',
    description: 'Decorated layout — emoji ★ name channels (e.g. 💀 ★ general).',
    categories: [
      {
        name: '╭─── Important ⚠️ ˅',
        channels: [
          { name: '📜 ★ rules', type: 'text', perm: 'readonly' },
          { name: '📢 ★ announcements', type: 'text', perm: 'readonly' },
          { name: '🟣 ★ news', type: 'text', perm: 'readonly' },
          { name: '✨ ★ roles', type: 'text', perm: 'readonly' },
        ],
      },
      {
        name: '│─── Community 💬 ˅',
        channels: [
          { name: '💬 ★ general', type: 'text' },
          { name: '📷 ★ media', type: 'text' },
          { name: '😂 ★ memes', type: 'text' },
          { name: '🤖 ★ commands', type: 'text' },
          { name: '⚠ ★ do-not-type', type: 'text', honeypot: true },
        ],
      },
      {
        name: '│─── Voice 🔊 ˅',
        channels: [
          { name: '🔊 ★ lounge', type: 'voice' },
          { name: '🎮 ★ gaming', type: 'voice' },
          { name: '💤 ★ afk', type: 'voice' },
        ],
      },
      {
        name: '│─── Staff 🛡️ ˅',
        channels: [
          { name: '🛡️ ★ staff-chat', type: 'text', perm: 'staff' },
          { name: '📋 ★ mod-logs', type: 'text', perm: 'logs' },
          { name: '🎫 ★ ticket-logs', type: 'text', perm: 'logs' },
          { name: '🚨 ★ reports', type: 'text', perm: 'staff' },
        ],
        staffOnly: true,
      },
      {
        name: '│─── Support 🎫 ˅',
        channels: [
          { name: '🎫 ★ create-ticket', type: 'text', perm: 'readonly' },
          { name: '⚡ ★ priority-support', type: 'text', perm: 'staff' },
        ],
      },
      {
        name: '╰──── End 🔚',
        channels: [],
        footer: true,
      },
    ],
  },
];

for (const t of SERVER_TEMPLATES) {
  t.preview = treePreview(t.categories || []);
}

const ROLE_TEMPLATES = [
  {
    id: 'staff-ladder',
    name: 'Staff Ladder',
    description: 'Full staff chain — 👑・Owner style (same look as aesthetic channels).',
    style: 'dot',
    roles: [
      { baseName: 'Owner', emoji: '👑', color: 0xE74C3C, perms: ['Administrator'] },
      { baseName: 'Co-Owner', emoji: '💎', color: 0x9B59B6, perms: ['Administrator'] },
      {
        baseName: 'Sr. Mod',
        emoji: '⭐',
        color: 0x3498DB,
        perms: ['ManageMessages', 'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageNicknames'],
      },
      {
        baseName: 'Mod',
        emoji: '🛡️',
        color: 0x2ECC71,
        perms: ['ManageMessages', 'KickMembers', 'ModerateMembers', 'ManageNicknames'],
      },
      {
        baseName: 'Staff Team',
        emoji: '🔧',
        color: 0x1ABC9C,
        perms: ['ManageMessages', 'ModerateMembers'],
      },
      {
        baseName: 'Ticket Support',
        emoji: '🎫',
        color: 0xF1C40F,
        perms: ['ManageMessages', 'ViewChannel'],
      },
      { baseName: 'Member', emoji: '👥', color: 0x95A5A6, perms: [] },
    ],
  },
  {
    id: 'simple-staff',
    name: 'Simple Staff',
    description: 'Lightweight admin / mod / member — emoji・name.',
    style: 'dot',
    roles: [
      { baseName: 'Admin', emoji: '👑', color: 0xE74C3C, perms: ['Administrator'] },
      {
        baseName: 'Moderator',
        emoji: '🛡️',
        color: 0x3498DB,
        perms: ['ManageMessages', 'KickMembers', 'BanMembers', 'ModerateMembers'],
      },
      { baseName: 'Member', emoji: '👥', color: 0x95A5A6, perms: [] },
    ],
  },
  {
    id: 'creator',
    name: 'Creator / Influencer',
    description: 'Creator community roles — emoji・name.',
    style: 'dot',
    roles: [
      { baseName: 'Creator', emoji: '🎬', color: 0xFF6B9D, perms: ['Administrator'] },
      {
        baseName: 'Manager',
        emoji: '💼',
        color: 0x9B59B6,
        perms: ['ManageGuild', 'ManageChannels', 'ManageRoles'],
      },
      {
        baseName: 'Mod',
        emoji: '🛡️',
        color: 0x57C7FF,
        perms: ['ManageMessages', 'KickMembers', 'ModerateMembers'],
      },
      { baseName: 'VIP', emoji: '⭐', color: 0xF1C40F, perms: [] },
      { baseName: 'Fan', emoji: '👥', color: 0x95A5A6, perms: [] },
    ],
  },
  {
    id: 'gaming-ranks',
    name: 'Gaming Ranks',
    description: 'Competitive ladder — emoji・name.',
    style: 'dot',
    roles: [
      { baseName: 'Owner', emoji: '👑', color: 0xE74C3C, perms: ['Administrator'] },
      {
        baseName: 'Admin',
        emoji: '⚔️',
        color: 0xE67E22,
        perms: ['ManageGuild', 'KickMembers', 'BanMembers', 'ModerateMembers'],
      },
      {
        baseName: 'Mod',
        emoji: '🛡️',
        color: 0x3498DB,
        perms: ['ManageMessages', 'KickMembers', 'ModerateMembers'],
      },
      { baseName: 'Pro', emoji: '🏆', color: 0xF1C40F, perms: [] },
      { baseName: 'Competitive', emoji: '🎯', color: 0x2ECC71, perms: [] },
      { baseName: 'Casual', emoji: '🎮', color: 0x95A5A6, perms: [] },
    ],
  },
  {
    id: 'business',
    name: 'Business / Team',
    description: 'Company-style roles — emoji・name.',
    style: 'dot',
    roles: [
      { baseName: 'CEO', emoji: '💼', color: 0xE74C3C, perms: ['Administrator'] },
      {
        baseName: 'Manager',
        emoji: '📋',
        color: 0x9B59B6,
        perms: ['ManageGuild', 'ManageChannels', 'ManageRoles'],
      },
      {
        baseName: 'Support Lead',
        emoji: '🎧',
        color: 0x3498DB,
        perms: ['ManageMessages', 'ModerateMembers'],
      },
      { baseName: 'Support', emoji: '🎫', color: 0x1ABC9C, perms: ['ManageMessages'] },
      { baseName: 'Buyer', emoji: '🛒', color: 0xe67e22, perms: [] },
      { baseName: 'Client', emoji: '👤', color: 0x95A5A6, perms: [] },
    ],
  },
  {
    id: 'staff-pipe',
    name: 'Staff Ladder｜Pipe',
    description: 'Same staff ladder with 👑｜Owner naming.',
    style: 'pipe',
    roles: [
      { baseName: 'Owner', emoji: '👑', color: 0xE74C3C, perms: ['Administrator'] },
      { baseName: 'Co-Owner', emoji: '💎', color: 0x9B59B6, perms: ['Administrator'] },
      {
        baseName: 'Sr. Mod',
        emoji: '⭐',
        color: 0x3498DB,
        perms: ['ManageMessages', 'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageNicknames'],
      },
      {
        baseName: 'Mod',
        emoji: '🛡️',
        color: 0x2ECC71,
        perms: ['ManageMessages', 'KickMembers', 'ModerateMembers', 'ManageNicknames'],
      },
      { baseName: 'Member', emoji: '👥', color: 0x95A5A6, perms: [] },
    ],
  },
  {
    id: 'staff-star',
    name: 'Staff Ladder ★ Star',
    description: 'Staff ladder with emoji ★ Name — e.g. 💀 ★ Owner.',
    style: 'star',
    roles: [
      { baseName: 'Owner', emoji: '👑', color: 0xE74C3C, perms: ['Administrator'] },
      { baseName: 'Co-Owner', emoji: '💎', color: 0x9B59B6, perms: ['Administrator'] },
      {
        baseName: 'Sr. Mod',
        emoji: '⭐',
        color: 0x3498DB,
        perms: ['ManageMessages', 'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageNicknames'],
      },
      {
        baseName: 'Mod',
        emoji: '🛡️',
        color: 0x2ECC71,
        perms: ['ManageMessages', 'KickMembers', 'ModerateMembers', 'ManageNicknames'],
      },
      {
        baseName: 'Staff Team',
        emoji: '🔧',
        color: 0x1ABC9C,
        perms: ['ManageMessages', 'ModerateMembers'],
      },
      {
        baseName: 'Ticket Support',
        emoji: '🎫',
        color: 0xF1C40F,
        perms: ['ManageMessages', 'ViewChannel'],
      },
      { baseName: 'Member', emoji: '👥', color: 0x95A5A6, perms: [] },
    ],
  },
  {
    id: 'simple-star',
    name: 'Simple Staff ★',
    description: 'Admin / mod / member with emoji ★ Name — e.g. 👑 ★ Admin.',
    style: 'star',
    roles: [
      { baseName: 'Admin', emoji: '👑', color: 0xE74C3C, perms: ['Administrator'] },
      {
        baseName: 'Moderator',
        emoji: '🛡️',
        color: 0x3498DB,
        perms: ['ManageMessages', 'KickMembers', 'BanMembers', 'ModerateMembers'],
      },
      { baseName: 'Member', emoji: '👥', color: 0x95A5A6, perms: [] },
    ],
  },
];

for (const t of ROLE_TEMPLATES) {
  const style = t.style || 'dot';
  t.preview = t.roles.map((r) => styledRoleName(r.baseName, r.emoji, style)).join('\n');
  t.roles = t.roles.map((r) => ({
    ...r,
    name: styledRoleName(r.baseName, r.emoji, style),
  }));
}

/** Maps short names → PermissionFlagsBits keys */
const PERM_MAP = {
  Administrator: 'Administrator',
  ManageGuild: 'ManageGuild',
  ManageChannels: 'ManageChannels',
  ManageRoles: 'ManageRoles',
  ManageMessages: 'ManageMessages',
  ManageNicknames: 'ManageNicknames',
  ManageWebhooks: 'ManageWebhooks',
  ManageEvents: 'ManageEvents',
  ManageThreads: 'ManageThreads',
  KickMembers: 'KickMembers',
  BanMembers: 'BanMembers',
  ModerateMembers: 'ModerateMembers',
  MuteMembers: 'MuteMembers',
  DeafenMembers: 'DeafenMembers',
  MoveMembers: 'MoveMembers',
  ViewAuditLog: 'ViewAuditLog',
  ViewChannel: 'ViewChannel',
  SendMessages: 'SendMessages',
  EmbedLinks: 'EmbedLinks',
  AttachFiles: 'AttachFiles',
  ReadMessageHistory: 'ReadMessageHistory',
  MentionEveryone: 'MentionEveryone',
  ChangeNickname: 'ChangeNickname',
  CreateInstantInvite: 'CreateInstantInvite',
  Connect: 'Connect',
  Speak: 'Speak',
  UseVAD: 'UseVAD',
  PrioritySpeaker: 'PrioritySpeaker',
  Stream: 'Stream',
};

/**
 * Full permission packs by role type.
 * Matched from the role's base name (Owner, Mod, Support, etc.).
 */
const ROLE_PERM_PRESETS = {
  owner: ['Administrator'],
  coowner: ['Administrator'],
  admin: ['Administrator'],
  ceo: ['Administrator'],
  creator: ['Administrator'],

  manager: [
    'ManageGuild',
    'ManageChannels',
    'ManageRoles',
    'ManageMessages',
    'ManageNicknames',
    'ManageWebhooks',
    'ManageEvents',
    'ManageThreads',
    'KickMembers',
    'BanMembers',
    'ModerateMembers',
    'MuteMembers',
    'DeafenMembers',
    'MoveMembers',
    'ViewAuditLog',
    'MentionEveryone',
    'Connect',
    'Speak',
    'PrioritySpeaker',
  ],

  srmod: [
    'ManageMessages',
    'ManageNicknames',
    'ManageThreads',
    'KickMembers',
    'BanMembers',
    'ModerateMembers',
    'MuteMembers',
    'DeafenMembers',
    'MoveMembers',
    'ViewAuditLog',
    'Connect',
    'Speak',
    'Stream',
    'PrioritySpeaker',
    'ViewChannel',
    'SendMessages',
    'EmbedLinks',
    'AttachFiles',
    'ReadMessageHistory',
  ],

  mod: [
    'ManageMessages',
    'ManageNicknames',
    'ManageThreads',
    'KickMembers',
    'ModerateMembers',
    'MuteMembers',
    'MoveMembers',
    'ViewAuditLog',
    'Connect',
    'Speak',
    'Stream',
    'ViewChannel',
    'SendMessages',
    'EmbedLinks',
    'AttachFiles',
    'ReadMessageHistory',
  ],

  staff: [
    'ManageMessages',
    'ModerateMembers',
    'MuteMembers',
    'ManageThreads',
    'ViewChannel',
    'SendMessages',
    'EmbedLinks',
    'AttachFiles',
    'ReadMessageHistory',
    'Connect',
    'Speak',
  ],

  supportlead: [
    'ManageMessages',
    'ModerateMembers',
    'ManageThreads',
    'MuteMembers',
    'ViewChannel',
    'Connect',
    'Speak',
  ],

  support: [
    'ManageMessages',
    'ManageThreads',
    'ViewChannel',
    'SendMessages',
    'EmbedLinks',
    'AttachFiles',
    'ReadMessageHistory',
    'Connect',
    'Speak',
  ],

  ticket: [
    'ManageMessages',
    'ManageThreads',
    'ViewChannel',
    'SendMessages',
    'EmbedLinks',
    'AttachFiles',
    'ReadMessageHistory',
  ],

  vip: [
    'ChangeNickname',
    'Connect',
    'Speak',
    'Stream',
    'UseVAD',
    'PrioritySpeaker',
  ],

  pro: ['ChangeNickname', 'Connect', 'Speak', 'Stream', 'PrioritySpeaker'],
  competitive: ['ChangeNickname', 'Connect', 'Speak', 'Stream'],
  casual: ['ChangeNickname', 'Connect', 'Speak'],
  member: ['ChangeNickname', 'Connect', 'Speak', 'UseVAD'],
  fan: ['ChangeNickname', 'Connect', 'Speak', 'UseVAD'],
  client: ['ChangeNickname', 'Connect', 'Speak', 'UseVAD'],
};

function detectRolePreset(baseName) {
  const n = String(baseName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (/^(owner|coowner|admin|ceo|creator)$/.test(n) || n.includes('owner') || n === 'admin') {
    if (n.includes('coowner') || n === 'coowner') return 'coowner';
    if (n.includes('owner')) return 'owner';
    if (n === 'admin' || n.endsWith('admin')) return 'admin';
    if (n === 'ceo') return 'ceo';
    if (n === 'creator') return 'creator';
  }
  if (n.includes('manager')) return 'manager';
  if (n.includes('srmod') || n.includes('seniormod') || n.includes('headmod')) return 'srmod';
  if (n.includes('moderator') || n === 'mod' || n.endsWith('mod')) return 'mod';
  if (n.includes('supportlead') || n.includes('leadsupport')) return 'supportlead';
  if (n.includes('ticket')) return 'ticket';
  if (n.includes('support')) return 'support';
  if (n.includes('staff')) return 'staff';
  if (n.includes('vip')) return 'vip';
  if (n === 'pro') return 'pro';
  if (n.includes('competitive')) return 'competitive';
  if (n.includes('casual')) return 'casual';
  if (n.includes('fan')) return 'fan';
  if (n.includes('client')) return 'client';
  if (n.includes('member')) return 'member';
  return null;
}

/** Resolve final permission flag names for a role. */
function resolveRolePermNames(baseName, explicitPerms = []) {
  const preset = detectRolePreset(baseName);
  const fromPreset = preset ? ROLE_PERM_PRESETS[preset] || [] : [];
  const merged = new Set([...(explicitPerms || []), ...fromPreset]);

  // Administrator alone is enough — drop the rest to avoid clutter
  if (merged.has('Administrator')) return ['Administrator'];
  return [...merged];
}

function resolveRolePermissionFlags(baseName, explicitPerms = []) {
  const { PermissionFlagsBits } = require('discord.js');
  return resolveRolePermNames(baseName, explicitPerms)
    .map((p) => PermissionFlagsBits[PERM_MAP[p] || p])
    .filter(Boolean);
}

module.exports = {
  SERVER_TEMPLATES,
  ROLE_TEMPLATES,
  PERM_MAP,
  ROLE_PERM_PRESETS,
  treePreview,
  styledRoleName,
  detectRolePreset,
  resolveRolePermNames,
  resolveRolePermissionFlags,
};
