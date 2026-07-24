'use strict';

/**
 * Writable data directory. PC Host sets OUGI_DATA_DIR to AppData so installs
 * stay portable (runtime folder can be read-only / re-downloaded).
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

function dataDir() {
  const dir = process.env.OUGI_DATA_DIR
    ? path.join(process.env.OUGI_DATA_DIR, 'data')
    : path.join(PROJECT_ROOT, 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function dataFile(...parts) {
  return path.join(dataDir(), ...parts);
}

module.exports = { PROJECT_ROOT, dataDir, dataFile };
