'use strict';

/**
 * Sync selected secrets from local .env → Railway service (stdin, no echo).
 * Usage: node scripts/sync-railway-secrets.js
 *
 * Syncs: STRIPE_*, GOOGLE_*, YDC_API_KEY / YOU_API_KEY, OUGI_SITE_ORIGIN, …
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
  'YDC_API_KEY',
  'YOU_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_AI_API_KEY',
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

/** Prefer .env, else you-api-key.txt (gitignored). */
function resolveYouApiKey(env) {
  const fromEnv = String(env.YDC_API_KEY || env.YOU_API_KEY || env.YOUCOM_API_KEY || '').trim();
  if (fromEnv && !/YOUR_KEY|PASTE|example/i.test(fromEnv)) return fromEnv;
  for (const name of ['you-api-key.txt', 'YDC_API_KEY.txt', 'ydc-api-key.txt']) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) continue;
    const v = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/)[0].trim();
    if (v) return v;
  }
  return '';
}

function resolveGeminiApiKey(env) {
  const fromEnv = String(env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY || '').trim();
  if (fromEnv && !/YOUR_KEY|PASTE|example/i.test(fromEnv)) return fromEnv;
  for (const name of ['gemini-api-key.txt', 'GOOGLE_AI_API_KEY.txt']) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) continue;
    const v = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/)[0].trim();
    if (v) return v;
  }
  return '';
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

  const youKey = resolveYouApiKey(env);
  if (youKey) env.YDC_API_KEY = youKey;
  const gemKey = resolveGeminiApiKey(env);
  if (gemKey) env.GEMINI_API_KEY = gemKey;

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
    console.log('Nothing to sync. Add keys to .env or you-api-key.txt first.');
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
