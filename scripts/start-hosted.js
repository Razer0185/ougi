'use strict';

/**
 * Starts Discord bot + website together (Railway / Render).
 * Website is required for healthchecks. Bot is best-effort if DISCORD_TOKEN is set.
 */

const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
/** @type {import('child_process').ChildProcess[]} */
const kids = [];
let shuttingDown = false;

function run(label, script, { critical }) {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  kids.push(child);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[${label}] exited code=${code} signal=${signal}`);
    if (critical) {
      shuttingDown = true;
      for (const k of kids) {
        if (k !== child && !k.killed) k.kill('SIGTERM');
      }
      process.exit(code || 1);
      return;
    }
    // Non-critical (bot): keep website up; retry bot after a delay
    console.error(`[${label}] will retry in 15s (website stays online)`);
    setTimeout(() => {
      if (shuttingDown) return;
      run(label, script, { critical: false });
    }, 15_000);
  });
  return child;
}

run('site', path.join(root, 'website', 'server.js'), { critical: true });

if (process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN) {
  run('bot', path.join(root, 'index.js'), { critical: false });
} else {
  console.warn('[bot] DISCORD_TOKEN not set — website only. Add DISCORD_TOKEN in Railway Variables.');
}

function shutdown() {
  shuttingDown = true;
  for (const k of kids) {
    if (!k.killed) k.kill('SIGTERM');
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
