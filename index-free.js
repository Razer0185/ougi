'use strict';

/**
 * Start the FREE / promo Ougi bot (TikTok trial edition).
 *
 * 1. Put the free Discord bot token in:  token-free.txt
 * 2. Edit promo links in:                data/free-edition.json  (created on first run)
 * 3. Run:                                npm run start:free
 *
 * Main HQ server (never left): 1521568250473873438
 */

const fs = require('fs');
const path = require('path');

process.env.OUGI_EDITION = 'free';
// Free bot must accept public invites (TikTok traffic)
process.env.OUGI_FORCE_PUBLIC = '1';

function readFreeToken() {
  const fromEnv = String(process.env.DISCORD_TOKEN_FREE || process.env.OUGI_FREE_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  const p = path.join(__dirname, 'token-free.txt');
  if (!fs.existsSync(p)) {
    console.error('');
    console.error('Missing free bot token.');
    console.error('Create token-free.txt in the project root and paste the FREE bot token (one line).');
    console.error('Or set env DISCORD_TOKEN_FREE.');
    console.error('');
    process.exit(1);
  }
  const token = fs.readFileSync(p, 'utf8').trim();
  if (!token || token.includes('PASTE')) {
    console.error('token-free.txt is empty. Paste your free Discord bot token and restart.');
    process.exit(1);
  }
  return token;
}

process.env.DISCORD_TOKEN = readFreeToken();
console.log('Starting Ougi FREE edition…');
console.log('Token source: token-free.txt (or DISCORD_TOKEN_FREE)');
console.log('HQ server protected: 1521568250473873438');

require('./index.js');
