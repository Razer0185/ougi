'use strict';

/**
 * Welcome / goodbye image cards via @napi-rs/canvas.
 */

const { AttachmentBuilder } = require('discord.js');
const { getTheme } = require('../utils/theme');

async function loadCanvas() {
  try {
    return require('@napi-rs/canvas');
  } catch {
    return null;
  }
}

function hexColor(n) {
  return `#${Number(n).toString(16).padStart(6, '0')}`;
}

async function buildWelcomeCard({ guild, member, messageText }) {
  const canvasLib = await loadCanvas();
  if (!canvasLib) return null;
  const { createCanvas, loadImage } = canvasLib;

  const width = 900;
  const height = 300;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const theme = getTheme(require('../utils/store').loadGuild(guild.id).theme);

  // Background
  ctx.fillStyle = '#0f1115';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = hexColor(theme.color);
  ctx.fillRect(0, 0, 16, height);

  // Soft panel
  ctx.fillStyle = '#1a1d24';
  ctx.beginPath();
  roundRect(ctx, 40, 40, width - 80, height - 80, 18);
  ctx.fill();

  // Avatar
  const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
  try {
    const avatar = await loadImage(avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(140, 150, 64, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, 76, 86, 128, 128);
    ctx.restore();
    ctx.strokeStyle = hexColor(theme.color);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(140, 150, 66, 0, Math.PI * 2);
    ctx.stroke();
  } catch {
    /* skip avatar */
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px Sans-Serif';
  ctx.fillText('Welcome', 240, 120);

  ctx.fillStyle = hexColor(theme.color);
  ctx.font = 'bold 28px Sans-Serif';
  const name = (member.displayName || member.user.username || 'Member').slice(0, 28);
  ctx.fillText(name, 240, 160);

  ctx.fillStyle = '#a8b0bd';
  ctx.font = '20px Sans-Serif';
  const line = String(messageText || `You are member #${guild.memberCount}`)
    .replace(/\*\*/g, '')
    .slice(0, 70);
  ctx.fillText(line, 240, 200);

  ctx.fillStyle = '#6b7280';
  ctx.font = '16px Sans-Serif';
  ctx.fillText(guild.name.slice(0, 40), 240, 235);

  const buffer = canvas.toBuffer('image/png');
  return new AttachmentBuilder(buffer, { name: 'welcome.png' });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

module.exports = { buildWelcomeCard };
