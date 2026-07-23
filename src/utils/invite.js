/**
 * Proper Discord bot invite (adds the bot as a server member).
 * Keep this private when selling Ougi — pair with access.js whitelist.
 */
function buildBotInviteUrl(clientId, permissions = 8) {
  const id = String(clientId || '').trim();
  if (!id) return null;
  const params = new URLSearchParams({
    client_id: id,
    permissions: String(permissions),
    scope: 'bot applications.commands',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function writeInviteFile(rootDir, clientId) {
  const url = buildBotInviteUrl(clientId);
  if (!url) return null;
  const fs = require('fs');
  const path = require('path');
  let privateMode = true;
  try {
    privateMode = require('./access').isPrivateMode();
  } catch {
    /* ignore */
  }
  const file = path.join(rootDir, 'invite-url.txt');
  const guide = [
    'Ougi — PRIVATE invite (owner only)',
    '================================',
    '',
    privateMode
      ? 'Private mode is ON. Do NOT post this link publicly.'
      : 'Share carefully — anyone with this link can add the bot.',
    '',
    'Bot invite (not Discord Add App):',
    url,
    '',
    'After a customer authorizes:',
    '  1. Get their server ID',
    '  2. Run: .access allow <serverId>',
    '  Or approve from Ougi Host → Access',
    '',
    'Extra lock: Discord Developer Portal → Bot → Public Bot = OFF',
    '',
  ].join('\n');
  fs.writeFileSync(file, guide, 'utf8');
  return { url, file };
}

module.exports = { buildBotInviteUrl, writeInviteFile };
