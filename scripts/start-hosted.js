'use strict';

/**
 * Cloud entrypoint (legacy Railway/Render).
 *
 * Discord bot is PC-only now — never start index.js here.
 * Website can still run for healthchecks if a platform redeploys, but bot stays off.
 */

const path = require('path');

const root = path.join(__dirname, '..');

delete process.env.OUGI_EDITION;

if (!process.env.OUGI_SITE_HOST || process.env.OUGI_SITE_HOST.includes('://')) {
  process.env.OUGI_SITE_HOST = '0.0.0.0';
}
if (!process.env.OUGI_SITE_ORIGIN && process.env.RAILWAY_PUBLIC_DOMAIN) {
  process.env.OUGI_SITE_ORIGIN = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
}

console.warn(
  '[hosted] Discord bot is PC-only. Not starting index.js on this host. Run `npm start` on your PC.'
);

if (process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN) {
  console.warn(
    '[hosted] DISCORD_TOKEN is set on this host but ignored — remove it from Railway Variables.'
  );
}

// Keep HTTP up only so an old Railway service does not flap healthchecks while you delete it.
require(path.join(root, 'website', 'server.js'));
