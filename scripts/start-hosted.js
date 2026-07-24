'use strict';

/**
 * Railway/Render entrypoint (Pro / paid bot + website).
 * Website listens on THIS process (required for healthchecks).
 * Discord bot (index.js) runs as a child when DISCORD_TOKEN is set.
 *
 * Free bot (index-free.js / OUGI_EDITION=free) is local/TikTok only — not started here.
 */

const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

// Railway always provides PORT — never bind localhost-only
if (!process.env.OUGI_SITE_HOST || process.env.OUGI_SITE_HOST.includes('://')) {
  process.env.OUGI_SITE_HOST = '0.0.0.0';
}
if (!process.env.OUGI_SITE_ORIGIN && process.env.RAILWAY_PUBLIC_DOMAIN) {
  process.env.OUGI_SITE_ORIGIN = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
}

// Start HTTP server in-process so /api/health works for the platform healthcheck
require(path.join(root, 'website', 'server.js'));

const hasToken = Boolean(
  process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN
);

if (!hasToken) {
  console.warn('[bot] DISCORD_TOKEN not set — website only. Add it in Railway Variables.');
} else {
  let shuttingDown = false;
  let child = null;

  function startBot() {
    if (shuttingDown) return;
    child = spawn(process.execPath, [path.join(root, 'index.js')], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('exit', (code, signal) => {
      console.error(`[bot] exited code=${code} signal=${signal} — retry in 15s`);
      child = null;
      if (!shuttingDown) setTimeout(startBot, 15_000);
    });
  }

  startBot();

  function shutdown() {
    shuttingDown = true;
    if (child && !child.killed) child.kill('SIGTERM');
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
