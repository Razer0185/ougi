'use strict';

/**
 * Railway/Render entrypoint.
 * Website listens on THIS process (healthchecks).
 * Pro bot (index.js) + Free bot (index-free.js) run as children when tokens are set.
 */

const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

// Never inherit a free-edition flag onto the Pro child by accident
const hostedEdition = String(process.env.OUGI_EDITION || '').toLowerCase();
if (hostedEdition === 'free') {
  console.warn('[hosted] OUGI_EDITION=free on the host process is ignored for Pro; Free uses its own child.');
}
delete process.env.OUGI_EDITION;

if (!process.env.OUGI_SITE_HOST || process.env.OUGI_SITE_HOST.includes('://')) {
  process.env.OUGI_SITE_HOST = '0.0.0.0';
}
if (!process.env.OUGI_SITE_ORIGIN && process.env.RAILWAY_PUBLIC_DOMAIN) {
  process.env.OUGI_SITE_ORIGIN = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
}

require(path.join(root, 'website', 'server.js'));

const children = [];
let shuttingDown = false;

function startChild(label, scriptRel, envExtra = {}) {
  const child = spawn(process.execPath, [path.join(root, scriptRel)], {
    cwd: root,
    env: { ...process.env, ...envExtra },
    stdio: 'inherit',
  });
  children.push({ label, child, scriptRel, envExtra });
  child.on('exit', (code, signal) => {
    console.error(`[${label}] exited code=${code} signal=${signal}`);
    const idx = children.findIndex((c) => c.child === child);
    if (idx >= 0) children.splice(idx, 1);
    if (!shuttingDown) {
      console.error(`[${label}] retry in 15s`);
      setTimeout(() => startChild(label, scriptRel, envExtra), 15_000);
    }
  });
  console.log(`[hosted] started ${label} (${scriptRel})`);
  return child;
}

const proToken = String(
  process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || ''
).trim();
const freeToken = String(
  process.env.DISCORD_TOKEN_FREE || process.env.OUGI_FREE_TOKEN || ''
).trim();

if (proToken) {
  // Pro: paid / hosted seats — private mode + subscriptions
  startChild('pro-bot', 'index.js', {
    OUGI_EDITION: '',
    DISCORD_TOKEN: proToken,
  });
} else {
  console.warn('[hosted] DISCORD_TOKEN not set — Pro bot offline (website only).');
}

if (freeToken) {
  // Free: TikTok trial bot — public invites
  startChild('free-bot', 'index-free.js', {
    DISCORD_TOKEN_FREE: freeToken,
    OUGI_FREE_TOKEN: freeToken,
  });
} else {
  console.warn('[hosted] DISCORD_TOKEN_FREE not set — Free bot offline.');
}

function shutdown() {
  shuttingDown = true;
  for (const { child, label } of children) {
    if (child && !child.killed) {
      console.log(`[hosted] stopping ${label}`);
      child.kill('SIGTERM');
    }
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
