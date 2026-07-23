/**
 * Runs on Windows sign-in when Auto-Host is enabled.
 * Starts the Discord bot (and optionally keeps a quiet host watcher).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const BOT = path.join(ROOT, 'index.js');
const CONFIG = path.join(__dirname, 'data', 'config.json');

function autoEnabled() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    return !!cfg.autoHost;
  } catch {
    return true;
  }
}

if (!autoEnabled()) {
  process.exit(0);
}

const child = spawn(process.execPath, [BOT], {
  cwd: ROOT,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
  env: { ...process.env, NEXUS_HOSTED: '1', NEXUS_AUTOSTART: '1' },
});
child.unref();
process.exit(0);
