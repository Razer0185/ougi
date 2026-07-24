'use strict';

/**
 * Encrypt the entire buyer Host payload (exe + dat + dll) into one Ougi.sealed blob.
 * Buyers only receive OugiUnlock.exe + Ougi.sealed — nothing runnable plaintext.
 *
 * Format OGB1: magic | verLen | version | iv(12) | tag(16) | ciphertext(zip)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { setPackageKey, randomPackageKey } = require('../src/utils/package-seal');

const ROOT = path.join(__dirname, '..');

function log(msg) {
  console.log(`[buyer-seal] ${msg}`);
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function mkdir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function zipDirContents(srcDir, zipPath) {
  rmrf(zipPath);
  mkdir(path.dirname(zipPath));
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${srcDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: 'inherit' }
  );
  if (ps.status !== 0 || !fs.existsSync(zipPath)) {
    throw new Error('Failed to zip buyer payload');
  }
}

/**
 * @param {string} payloadDir directory containing OugiHost.exe, OugiHost.dat, WebView2Loader.dll
 * @param {string} outSealed path to Ougi.sealed
 * @param {string} version
 */
function sealBuyerPayload(payloadDir, outSealed, version) {
  const must = ['OugiHost.exe', 'OugiHost.dat', 'WebView2Loader.dll'];
  for (const f of must) {
    if (!fs.existsSync(path.join(payloadDir, f))) {
      throw new Error(`Missing ${f} in payload dir`);
    }
  }

  const cache = path.join(ROOT, 'desktop', '.cache');
  mkdir(cache);
  const zipPath = path.join(cache, 'buyer-payload.zip');
  log('Zipping Host binaries…');
  zipDirContents(payloadDir, zipPath);

  const key = randomPackageKey();
  const iv = crypto.randomBytes(12);
  const plain = fs.readFileSync(zipPath);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();

  const verBuf = Buffer.from(String(version || '1'), 'utf8');
  if (verBuf.length > 65535) throw new Error('version too long');
  const header = Buffer.alloc(4 + 2);
  header.write('OGB1', 0, 4, 'ascii');
  header.writeUInt16BE(verBuf.length, 4);

  const out = Buffer.concat([header, verBuf, iv, tag, enc]);
  mkdir(path.dirname(outSealed));
  fs.writeFileSync(outSealed, out);

  const entry = setPackageKey(version, key);
  const keyOut = path.join(ROOT, 'release', 'CURRENT_PACKAGE_KEY.txt');
  mkdir(path.dirname(keyOut));
  fs.writeFileSync(
    keyOut,
    [
      '# Keep secret — set on Railway as OUGI_PC_PACKAGE_KEY (base64 only, one line)',
      `# version ${entry.version}`,
      entry.key,
      '',
    ].join('\n'),
    { mode: 0o600 }
  );

  try {
    fs.unlinkSync(zipPath);
  } catch {
    /* ignore */
  }

  log(`Wrote ${outSealed} (${(out.length / 1e6).toFixed(1)} MB)`);
  log(`Package key saved for unlock API (version ${entry.version})`);
  log('Set Railway: OUGI_PC_PACKAGE_KEY=<base64 from release/CURRENT_PACKAGE_KEY.txt>');
  return entry;
}

module.exports = { sealBuyerPayload };

if (require.main === module) {
  const payload = process.argv[2] || path.join(ROOT, 'release', 'OugiHost');
  const out = process.argv[3] || path.join(ROOT, 'Ougi', 'Ougi.sealed');
  const ver =
    process.argv[4] ||
    (fs.existsSync(path.join(ROOT, 'desktop', 'OugiHost', 'Resources', 'RuntimeVersion.txt'))
      ? fs.readFileSync(path.join(ROOT, 'desktop', 'OugiHost', 'Resources', 'RuntimeVersion.txt'), 'utf8').trim()
      : `pkg-${Date.now()}`);
  sealBuyerPayload(payload, out, ver);
}
