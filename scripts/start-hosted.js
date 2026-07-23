'use strict';

/**
 * Starts Discord bot + website together (for free hosts like Render).
 * Website keeps the container as a web service; bot runs alongside it.
 */

const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const kids = [];

function run(label, script) {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  kids.push(child);
  child.on('exit', (code, signal) => {
    console.error(`[${label}] exited code=${code} signal=${signal}`);
    // If either dies, stop the other so the host restarts the service
    for (const k of kids) {
      if (k !== child && !k.killed) k.kill('SIGTERM');
    }
    process.exit(code || 1);
  });
}

run('bot', path.join(root, 'index.js'));
run('site', path.join(root, 'website', 'server.js'));

function shutdown() {
  for (const k of kids) {
    if (!k.killed) k.kill('SIGTERM');
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
