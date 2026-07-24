'use strict';

/**
 * Build an encrypted sealed runtime blob for OugiHost.exe.
 * Buyers never get a readable runtime/ or node_modules folder in the download —
 * the Host extracts into %LocalAppData%\OugiPC\app on first launch.
 *
 * Output:
 *   desktop/OugiHost/Resources/OugiRuntime.dat
 *   desktop/OugiHost/Resources/RuntimeVersion.txt
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { spawnSync } = require('child_process');
const { createWriteStream } = require('fs');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'desktop', '.cache');
const STAGING = path.join(CACHE, 'seal-staging');
const RESOURCES = path.join(ROOT, 'desktop', 'OugiHost', 'Resources');
const NODE_VER = process.env.OUGI_PACK_NODE || '20.18.1';
const NODE_ZIP = `node-v${NODE_VER}-win-x64.zip`;
const NODE_URL = `https://nodejs.org/dist/v${NODE_VER}/${NODE_ZIP}`;

/** Must match desktop/OugiHost/Program.cs RuntimeSeal.Passphrase */
const PASSPHRASE = 'OugiHost.Runtime.Seal.v1';

const COPY_DIRS = ['agent', 'src', 'website', 'host'];
const COPY_FILES = ['index.js', 'package.json'];
const SKIP_NAMES = new Set([
  '.git',
  'node_modules',
  'data',
  'desktop',
  'release',
  'token.txt',
  '.env',
  'paypal-api.txt',
  'you-api-key.txt',
  'YDC_API_KEY.txt',
  'ydc-api-key.txt',
]);

function log(msg) {
  console.log(`[seal] ${msg}`);
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function mkdir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest) {
  mkdir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function shouldSkip(name) {
  return SKIP_NAMES.has(name) || name.endsWith('.map') || name.endsWith('.md');
}

function copyDirFiltered(src, dest) {
  mkdir(dest);
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (shouldSkip(ent.name)) continue;
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDirFiltered(from, to);
    else copyFile(from, to);
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    mkdir(path.dirname(dest));
    const file = createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {
            /* ignore */
          }
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed ${res.statusCode}: ${url}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      })
      .on('error', reject);
  });
}

async function ensurePortableNode() {
  const zipPath = path.join(CACHE, NODE_ZIP);
  const extractDir = path.join(CACHE, `node-v${NODE_VER}-win-x64`);
  const nodeExe = path.join(extractDir, 'node.exe');
  if (!fs.existsSync(nodeExe)) {
    if (!fs.existsSync(zipPath)) {
      log(`Downloading Node ${NODE_VER}…`);
      await download(NODE_URL, zipPath);
    }
    log('Extracting Node…');
    rmrf(extractDir);
    const ps = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${CACHE.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: 'inherit' }
    );
    if (ps.status !== 0 || !fs.existsSync(nodeExe)) {
      throw new Error('Failed to extract portable Node');
    }
  }
  return extractDir;
}

function buildVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${pkg.version || '1.0.0'}+${stamp}`;
}

function stageRuntime(nodeDir, version) {
  log('Staging sealed payload…');
  rmrf(STAGING);
  const runtimeDir = path.join(STAGING, 'runtime');
  const nodeOut = path.join(STAGING, 'node');
  mkdir(runtimeDir);
  mkdir(nodeOut);

  for (const f of COPY_FILES) {
    copyFile(path.join(ROOT, f), path.join(runtimeDir, f));
  }
  for (const d of COPY_DIRS) {
    const src = path.join(ROOT, d);
    if (fs.existsSync(src)) copyDirFiltered(src, path.join(runtimeDir, d));
  }

  const nm = path.join(ROOT, 'node_modules');
  if (!fs.existsSync(nm)) throw new Error('Run npm install before sealing.');
  log('Copying node_modules…');
  fs.cpSync(nm, path.join(runtimeDir, 'node_modules'), { recursive: true });

  mkdir(path.join(runtimeDir, 'data'));
  fs.writeFileSync(
    path.join(runtimeDir, 'data', 'README.txt'),
    'Writable data lives in %LocalAppData%\\OugiPC\\data\n',
    'utf8'
  );

  copyFile(path.join(nodeDir, 'node.exe'), path.join(nodeOut, 'node.exe'));
  for (const extra of ['libuv.dll', 'zlib.dll']) {
    const p = path.join(nodeDir, extra);
    if (fs.existsSync(p)) copyFile(p, path.join(nodeOut, extra));
  }

  fs.writeFileSync(path.join(STAGING, 'VERSION'), version, 'utf8');
}

function zipStaging(zipPath) {
  rmrf(zipPath);
  mkdir(path.dirname(zipPath));
  // Zip contents of staging (not the staging folder itself)
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${STAGING.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: 'inherit' }
  );
  if (ps.status !== 0 || !fs.existsSync(zipPath)) {
    throw new Error('Failed to zip sealed staging folder');
  }
}

function encryptZip(zipPath, outDat, version) {
  const key = crypto.createHash('sha256').update(PASSPHRASE, 'utf8').digest();
  const iv = crypto.randomBytes(12);
  const plain = fs.readFileSync(zipPath);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();

  const verBuf = Buffer.from(version, 'utf8');
  if (verBuf.length > 65535) throw new Error('version too long');

  const header = Buffer.alloc(4 + 2);
  header.write('OGI1', 0, 4, 'ascii');
  header.writeUInt16BE(verBuf.length, 4);

  const out = Buffer.concat([header, verBuf, iv, tag, enc]);
  mkdir(path.dirname(outDat));
  fs.writeFileSync(outDat, out);
  fs.writeFileSync(path.join(RESOURCES, 'RuntimeVersion.txt'), version, 'utf8');
  log(`Wrote ${path.relative(ROOT, outDat)} (${(out.length / 1e6).toFixed(1)} MB) version ${version}`);
}

async function main() {
  const version = buildVersion();
  const nodeDir = await ensurePortableNode();
  stageRuntime(nodeDir, version);
  const zipPath = path.join(CACHE, 'ougi-runtime.zip');
  log('Compressing…');
  zipStaging(zipPath);
  log('Encrypting…');
  encryptZip(zipPath, path.join(RESOURCES, 'OugiRuntime.dat'), version);
  // Keep zip out of git noise
  try {
    fs.unlinkSync(zipPath);
  } catch {
    /* ignore */
  }
  rmrf(STAGING);
  log('Seal complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
