'use strict';

/**
 * PC Host agent entry — started by OugiHost.exe after license check.
 * Does not ship as readable "source app"; customers get the loader + sealed runtime.
 *
 * Env:
 *   DISCORD_TOKEN       — customer's bot token (never ours)
 *   OUGI_LICENSE_TOKEN  — short-lived ticket from /api/license/pc-ticket
 *   OUGI_LICENSE_URL    — base URL of Ougi site (http://127.0.0.1:5050)
 *   OUGI_PC_AGENT=1
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.OUGI_PC_AGENT = '1';
const localApp = path.join(os.homedir(), 'AppData', 'Local');
const dataHomePreferred = path.join(localApp, 'Ougi');
const dataHomeLegacy = path.join(localApp, 'OugiPC');
try {
  if (fs.existsSync(dataHomeLegacy) && !fs.existsSync(dataHomePreferred)) {
    fs.renameSync(dataHomeLegacy, dataHomePreferred);
  }
} catch {
  /* ignore */
}
const dataHome = fs.existsSync(dataHomePreferred) ? dataHomePreferred : dataHomeLegacy;
fs.mkdirSync(path.join(dataHome, 'data'), { recursive: true });
process.env.OUGI_DATA_DIR = dataHome;

const token = process.env.OUGI_LICENSE_TOKEN;
const discordToken = process.env.DISCORD_TOKEN;
const baseUrl = (process.env.OUGI_LICENSE_URL || 'http://127.0.0.1:5050').replace(/\/$/, '');

if (!discordToken || discordToken.length < 50) {
  console.error('PC Host: missing Discord bot token. Create a bot in Discord Developer Portal and paste its token in Ougi Host.');
  process.exit(1);
}
if (!token) {
  console.error('PC Host: missing license ticket. Sign in and Start again from Ougi Host.');
  process.exit(1);
}

function requestJson(urlString, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(opts.headers || {}),
        },
        timeout: 15000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          let json = {};
          try {
            json = JSON.parse(raw || '{}');
          } catch {
            /* ignore */
          }
          if (res.statusCode >= 400) {
            const err = new Error(json.message || `HTTP ${res.statusCode}`);
            err.statusCode = res.statusCode;
            return reject(err);
          }
          resolve(json);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('License server timeout'));
    });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function heartbeat() {
  const json = await requestJson(`${baseUrl}/api/license/pc-heartbeat`, {
    method: 'POST',
    body: JSON.stringify({ token: process.env.OUGI_LICENSE_TOKEN }),
  });
  if (json.token) process.env.OUGI_LICENSE_TOKEN = json.token;
  return json;
}

async function main() {
  console.log('Ougi PC Host — checking license…');
  try {
    await heartbeat();
  } catch (err) {
    console.error('License check failed:', err.message);
    console.error('Pay for PC Host and sign in again. Expired licenses cannot run.');
    process.exit(1);
  }
  console.log('License OK — starting bot (no source access in this loader).');

  // Renew ticket while running; quit if payment lapses
  setInterval(() => {
    heartbeat().catch((err) => {
      console.error('License expired or revoked:', err.message);
      process.exit(2);
    });
  }, 10 * 60 * 1000).unref?.();

  // Launch main bot (token from env)
  require('../index.js');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
