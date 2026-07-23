const fs = require('fs');
const path = require('path');
const { ButtonStyle } = require('discord.js');

/**
 * 10 interface color templates.
 * Drop preview images into assets/interfaces/ as:
 *   red.png, black.png, white.png, pink.png, blue.png,
 *   purple.png, green.png, orange.png, cyan.png, gold.png
 */
const INTERFACE_TEMPLATES = [
  {
    id: 'red',
    label: 'Red',
    color: 0xe74c3c,
    accent: '#E74C3C',
    emoji: '🔴',
    button: ButtonStyle.Danger,
  },
  {
    id: 'black',
    label: 'Black',
    color: 0x2c2f33,
    accent: '#2C2F33',
    emoji: '⬛',
    button: ButtonStyle.Secondary,
  },
  {
    id: 'white',
    label: 'White',
    color: 0xeceff4,
    accent: '#ECEFF4',
    emoji: '⬜',
    button: ButtonStyle.Secondary,
  },
  {
    id: 'pink',
    label: 'Pink',
    color: 0xff6b9d,
    accent: '#FF6B9D',
    emoji: '💗',
    button: ButtonStyle.Primary,
  },
  {
    id: 'blue',
    label: 'Blue',
    color: 0x57c7ff,
    accent: '#57C7FF',
    emoji: '💙',
    button: ButtonStyle.Primary,
  },
  {
    id: 'purple',
    label: 'Purple',
    color: 0x9b59b6,
    accent: '#9B59B6',
    emoji: '💜',
    button: ButtonStyle.Primary,
  },
  {
    id: 'green',
    label: 'Green',
    color: 0x2ecc71,
    accent: '#2ECC71',
    emoji: '💚',
    button: ButtonStyle.Success,
  },
  {
    id: 'orange',
    label: 'Orange',
    color: 0xe67e22,
    accent: '#E67E22',
    emoji: '🧡',
    button: ButtonStyle.Danger,
  },
  {
    id: 'cyan',
    label: 'Cyan',
    color: 0x1abc9c,
    accent: '#1ABC9C',
    emoji: '🩵',
    button: ButtonStyle.Success,
  },
  {
    id: 'gold',
    label: 'Gold',
    color: 0xf1c40f,
    accent: '#F1C40F',
    emoji: '💛',
    button: ButtonStyle.Primary,
  },
];

const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets', 'interfaces');

function ensureAssetsDir() {
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

function findPreviewFile(id) {
  ensureAssetsDir();
  const exts = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
  for (const ext of exts) {
    const file = path.join(ASSETS_DIR, `${id}${ext}`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function getInterface(id) {
  return INTERFACE_TEMPLATES.find((t) => t.id === id) || INTERFACE_TEMPLATES[4];
}

function getTheme(name) {
  const t = getInterface(name);
  return {
    id: t.id,
    label: t.label,
    color: t.color,
    accent: t.accent,
    emoji: t.emoji,
    button: t.button,
  };
}

function themeButtonStyle(themeOrId) {
  const t =
    typeof themeOrId === 'object' && themeOrId?.button != null
      ? themeOrId
      : getTheme(themeOrId);
  return t.button || ButtonStyle.Primary;
}

/** Thin visual rule used in embed descriptions */
function themeRule() {
  return '━━━━━━━━━━━━━━━━━━';
}

const THEMES = Object.fromEntries(
  INTERFACE_TEMPLATES.map((t) => [
    t.id,
    {
      id: t.id,
      label: t.label,
      color: t.color,
      accent: t.accent,
      emoji: t.emoji,
      button: t.button,
    },
  ])
);

module.exports = {
  INTERFACE_TEMPLATES,
  THEMES,
  ASSETS_DIR,
  ensureAssetsDir,
  findPreviewFile,
  getInterface,
  getTheme,
  themeButtonStyle,
  themeRule,
};
