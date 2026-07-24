'use strict';

/**
 * Image rank card (MEE6-style vanity) via @napi-rs/canvas.
 */

const { AttachmentBuilder } = require('discord.js');
const { getTheme } = require('../utils/theme');
const { loadGuild } = require('../utils/store');

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

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function buildRankCard({ guild, user, stats, position }) {
  const canvasLib = await loadCanvas();
  if (!canvasLib) return null;
  const { createCanvas, loadImage } = canvasLib;
  const theme = getTheme(loadGuild(guild.id).theme);

  const width = 934;
  const height = 282;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0b0c10';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = hexColor(theme.color);
  ctx.fillRect(0, 0, 12, height);

  ctx.fillStyle = '#151820';
  roundRect(ctx, 28, 28, width - 56, height - 56, 16);
  ctx.fill();

  try {
    const avatar = await loadImage(user.displayAvatarURL({ extension: 'png', size: 256 }));
    ctx.save();
    ctx.beginPath();
    ctx.arc(120, 141, 72, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, 48, 69, 144, 144);
    ctx.restore();
    ctx.strokeStyle = hexColor(theme.color);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(120, 141, 74, 0, Math.PI * 2);
    ctx.stroke();
  } catch {
    /* skip */
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px Sans-Serif';
  ctx.fillText((user.username || 'Member').slice(0, 22), 230, 100);

  ctx.fillStyle = '#9aa3b2';
  ctx.font = '22px Sans-Serif';
  const rankLine = position != null ? `RANK #${position}` : 'UNRANKED';
  ctx.fillText(`${rankLine}  ·  LEVEL ${stats.level}`, 230, 138);

  const barX = 230;
  const barY = 170;
  const barW = 640;
  const barH = 28;
  const pct = Math.max(0, Math.min(1, (stats.xpIntoLevel || 0) / (stats.needed || 1)));

  ctx.fillStyle = '#2a2f3a';
  roundRect(ctx, barX, barY, barW, barH, 10);
  ctx.fill();
  ctx.fillStyle = hexColor(theme.color);
  roundRect(ctx, barX, barY, Math.max(12, barW * pct), barH, 10);
  ctx.fill();

  ctx.fillStyle = '#c5cad3';
  ctx.font = '18px Sans-Serif';
  ctx.fillText(`${stats.xpIntoLevel} / ${stats.needed} XP`, barX, 230);
  ctx.fillText(`Total ${stats.totalXp} XP`, barX + 420, 230);

  const buffer = canvas.toBuffer('image/png');
  return new AttachmentBuilder(buffer, { name: 'rank.png' });
}

module.exports = { buildRankCard };
