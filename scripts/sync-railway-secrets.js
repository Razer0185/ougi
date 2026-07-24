'use strict';

/**
 * Sync selected secrets from local .env → Railway service (stdin, no echo).
 * Usage: node scripts/sync-railway-secrets.js
 *
 * Syncs: STRIPE_*, GOOGLE_*, OUGI_SITE_ORIGIN, OUGI_DISCORD_INVITE, OUGI_CHAT_SECRET (if set)
 * Does NOT print secret values.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVICE = process.env.RAILWAY_SERVICE || 'ougi';
const KEYS = [
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_PK',
  'STRIPE_SK',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'OUGI_SITE_ORIGIN',
  'OUGI_DISCORD_INVITE',
  'OUGI_CHAT_SECRET',
];

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function setVar(key, value, { skipDeploys }) {
  const args = [
    '--yes',
    '@railway/cli@latest',
    'variable',
    'set',
    key,
    '--stdin',
    '--service',
    SERVICE,
  ];
  if (skipDeploys) args.push('--skip-deploys');
  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args,
    {
      input: value,
      encoding: 'utf8',
      cwd: ROOT,
      shell: false,
    }
  );
  return r.status === 0;
}

function main() {
  const env = loadEnv();
  if (!env.OUGI_SITE_ORIGIN) {
    env.OUGI_SITE_ORIGIN = 'https://ougi-production.up.railway.app';
  }
  if (!env.OUGI_DISCORD_INVITE) {
    env.OUGI_DISCORD_INVITE = 'https://discord.gg/AMaPQfQXGb';
  }

  const toSet = [];
  for (const key of KEYS) {
    const val = String(env[key] || '').trim();
    if (!val || /YOUR_KEY|PASTE|example/i.test(val)) {
      console.log(`[skip] ${key} (missing or placeholder)`);
      continue;
    }
    toSet.push([key, val]);
  }

  if (!toSet.length) {
    console.log('Nothing to sync. Add Stripe/Google keys to .env first.');
    process.exit(0);
  }

  for (let i = 0; i < toSet.length; i++) {
    const [key, val] = toSet[i];
    const last = i === toSet.length - 1;
    const ok = setVar(key, val, { skipDeploys: !last });
    console.log(`[${ok ? 'ok' : 'fail'}] ${key} (len=${val.length})`);
    if (!ok) process.exitCode = 1;
  }

  console.log('\nDiscord token reset (manual when ready):');
  console.log('1. Discord Developer Portal → Bot → Reset Token');
  console.log('2. Save new token only in token.txt (and token-free.txt if needed)');
  console.log('3. pipe token into: npx @railway/cli variable set DISCORD_TOKEN --stdin --service ougi');
  console.log('4. Do not paste the token in chat');
}

main();
