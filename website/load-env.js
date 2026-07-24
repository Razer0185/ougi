'use strict';

/**
 * Load project-root .env into process.env (does not override existing keys).
 * Used by website + hosted entry so Google/Stripe work without a dotenv package.
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../src/utils/data-paths');

function loadEnvFile(force = false) {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (!fs.existsSync(envPath)) return false;
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 0) continue;
      const key = t.slice(0, i).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      let val = t.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (force || !(key in process.env) || String(process.env[key] || '').trim() === '') {
        process.env[key] = val;
      }
    }
    return true;
  } catch {
    return false;
  }
}

loadEnvFile();

module.exports = { loadEnvFile };
