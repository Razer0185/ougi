'use strict';

/**
 * After local code updates:
 *  1) Stop the Pro bot (index.js)
 *  2) Wipe + apply the next aesthetic server template on the demo guild
 *  3) Recreate the Ougi panel
 *  4) Start the Pro bot again
 *
 * Defaults:
 *   Demo guild = "00" (1516162119161352233) — never the Ougi HQ
 *   Templates rotate: aesthetic-dot → pipe → dash → star
 *
 * Env overrides:
 *   OUGI_DEV_GUILD_ID=...
 *   OUGI_DEV_TEMPLATE=aesthetic-star   (skip rotation)
 *   OUGI_DEV_SKIP_APPLY=1              (restart only)
 *   OUGI_DEV_NO_RESTART=1              (apply only, leave bot stopped)
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { Client, GatewayIntentBits } = require('discord.js');

const ROOT = path.join(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'host', 'data', 'dev-reapply.json');
const HQ_GUILD_ID = '1521568250473873438';
const DEFAULT_DEMO_GUILD_ID = '1516162119161352233'; // "00"
const AESTHETIC_IDS = ['aesthetic-dot', 'aesthetic-pipe', 'aesthetic-dash', 'aesthetic-star'];

function readToken() {
  const env =
    process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || '';
  if (env.trim()) return env.trim();
  const tokenPath = path.join(ROOT, 'token.txt');
  if (!fs.existsSync(tokenPath)) throw new Error('Missing token.txt / DISCORD_TOKEN');
  const token = fs.readFileSync(tokenPath, 'utf8').trim();
  if (!token) throw new Error('token.txt is empty');
  return token;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { lastTemplateId: null, lastGuildId: null, at: 0 };
  }
}

function saveState(state) {
  const dir = path.dirname(STATE_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function nextAestheticId(lastId) {
  const forced = String(process.env.OUGI_DEV_TEMPLATE || '').trim();
  if (forced) {
    if (!AESTHETIC_IDS.includes(forced)) {
      throw new Error(`OUGI_DEV_TEMPLATE must be one of: ${AESTHETIC_IDS.join(', ')}`);
    }
    return forced;
  }
  const idx = AESTHETIC_IDS.indexOf(lastId);
  return AESTHETIC_IDS[(idx + 1) % AESTHETIC_IDS.length];
}

function stopProBot() {
  if (process.platform === 'win32') {
    try {
      execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -match 'index\\\\.js' -and $_.CommandLine -notmatch 'index-free' -and $_.CommandLine -notmatch 'dev-refresh' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
        { stdio: 'ignore' }
      );
    } catch {
      /* ignore */
    }
  } else {
    try {
      execSync(
        `pkill -f "[n]ode.*index\\.js" 2>/dev/null; pgrep -af 'index-free' >/dev/null || true`,
        { stdio: 'ignore' }
      );
    } catch {
      /* ignore */
    }
  }
}

function startProBot() {
  const isWin = process.platform === 'win32';
  const child = isWin
    ? spawn('cmd.exe', ['/c', 'npm start'], {
        cwd: ROOT,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env },
      })
    : spawn('npm', ['start'], {
        cwd: ROOT,
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
      });
  child.unref();
  console.log(`[dev-refresh] Pro bot started (pid ${child.pid})`);
}

async function applyAesthetic(guildId, templateId) {
  if (String(guildId) === HQ_GUILD_ID) {
    throw new Error('Refusing to wipe Ougi HQ — set OUGI_DEV_GUILD_ID to your demo server');
  }

  const { applyServerTemplate } = require('../src/features/templates');
  const { createPanel } = require('../src/commands');

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(readToken());
  await new Promise((resolve, reject) => {
    let settled = false;
    const ok = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    client.once('clientReady', ok);
    client.once('ready', ok);
    client.once('error', reject);
    setTimeout(() => reject(new Error('Discord ready timeout')), 45000);
  });

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    await client.destroy();
    throw new Error(`Bot is not in guild ${guildId}`);
  }
  await guild.channels.fetch().catch(() => {});

  console.log(`[dev-refresh] Wiping + applying ${templateId} on ${guild.name} (${guild.id})…`);
  const result = await applyServerTemplate(guild, templateId, null, { wipeChannels: true });
  try {
    await createPanel(guild, client);
    console.log('[dev-refresh] Control panel recreated');
  } catch (err) {
    console.warn('[dev-refresh] Panel recreate failed:', err.message);
  }

  console.log(
    `[dev-refresh] Done — ${result.template.name} (${result.created.length} lines, tickets=${result.ticketsSetup?.ok ? 'ok' : 'skip'})`
  );
  await client.destroy();
  return result;
}

async function main() {
  const guildId = String(process.env.OUGI_DEV_GUILD_ID || DEFAULT_DEMO_GUILD_ID);
  const skipApply = process.env.OUGI_DEV_SKIP_APPLY === '1';
  const noRestart = process.env.OUGI_DEV_NO_RESTART === '1';

  console.log('[dev-refresh] Stopping Pro bot…');
  stopProBot();
  await new Promise((r) => setTimeout(r, 1200));

  if (!skipApply) {
    const state = loadState();
    const templateId = nextAestheticId(state.lastTemplateId);
    await applyAesthetic(guildId, templateId);
    saveState({
      lastTemplateId: templateId,
      lastGuildId: guildId,
      at: Date.now(),
    });
  } else {
    console.log('[dev-refresh] Skip template apply (OUGI_DEV_SKIP_APPLY=1)');
  }

  if (!noRestart) {
    startProBot();
  } else {
    console.log('[dev-refresh] Left bot stopped (OUGI_DEV_NO_RESTART=1)');
  }
}

main().catch((err) => {
  console.error('[dev-refresh] FAILED:', err.message || err);
  if (process.env.OUGI_DEV_NO_RESTART !== '1') {
    try {
      startProBot();
    } catch {
      /* ignore */
    }
  }
  process.exit(1);
});
