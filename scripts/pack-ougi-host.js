'use strict';

/**
 * Customer release — NO readable bot source in the download.
 *
 *   release/OugiHost/
 *     OugiHost.exe
 *     OugiHost.dat          ← encrypted runtime + Node (opaque)
 *     WebView2Loader.dll
 *     README.txt
 *
 * First launch unpacks into %LocalAppData%\OugiPC\app
 *
 * Usage: npm run host-app:pack
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'release', 'OugiHost');
const RESOURCES = path.join(ROOT, 'desktop', 'OugiHost', 'Resources');
const DAT = path.join(RESOURCES, 'OugiRuntime.dat');

function log(msg) {
  console.log(`[pack] ${msg}`);
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

function publishExe() {
  log('Publishing self-contained OugiHost.exe…');
  const dist = path.join(ROOT, 'desktop', 'dist');
  rmrf(dist);
  execSync(
    `dotnet publish "${path.join(ROOT, 'desktop', 'OugiHost', 'OugiHost.csproj')}" -c Release -r win-x64 --self-contained true -o "${dist}"`,
    { stdio: 'inherit', cwd: ROOT }
  );
  return dist;
}

function findWebViewDll(dist) {
  const candidates = [
    path.join(dist, 'WebView2Loader.dll'),
    path.join(dist, 'runtimes', 'win-x64', 'native', 'WebView2Loader.dll'),
    path.join(
      ROOT,
      'desktop',
      'OugiHost',
      'bin',
      'Release',
      'net8.0-windows',
      'win-x64',
      'WebView2Loader.dll'
    ),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function writeReadme(outDir) {
  fs.writeFileSync(
    path.join(outDir, 'README.txt'),
    [
      'Ougi Host (PC)',
      '==============',
      '',
      '1. Keep everything in this Ougi folder together.',
      '2. Double-click OugiHost.exe',
      '3. Sign in / sign up, paste your Discord bot token, Start',
      '',
      'Files:',
      '  OugiHost.exe        — the app',
      '  OugiHost.dat        — sealed runtime (not source)',
      '  WebView2Loader.dll  — required next to the exe',
      '',
      'You do NOT need Node.js, .NET, GitHub, or any bot source.',
      'First launch unpacks once into AppData.',
      'Requirements: Windows 10/11 x64 + WebView2 (usually already installed).',
      '',
    ].join('\n'),
    'utf8'
  );
}

async function main() {
  log('Sealing runtime (encrypted, no plain source in download)…');
  execSync(`node "${path.join(ROOT, 'scripts', 'seal-runtime.js')}"`, {
    stdio: 'inherit',
    cwd: ROOT,
  });
  if (!fs.existsSync(DAT)) throw new Error('Seal failed — missing OugiRuntime.dat');

  const dist = publishExe();
  const dll = findWebViewDll(dist);
  if (!dll) throw new Error('WebView2Loader.dll missing');

  log(`Assembling ${OUT}`);
  rmrf(OUT);
  mkdir(OUT);
  copyFile(path.join(dist, 'OugiHost.exe'), path.join(OUT, 'OugiHost.exe'));
  copyFile(DAT, path.join(OUT, 'OugiHost.dat'));
  copyFile(dll, path.join(OUT, 'WebView2Loader.dll'));
  writeReadme(OUT);

  const zipPath = path.join(ROOT, 'release', 'OugiHost-win-x64.zip');
  rmrf(zipPath);
  const zip = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${OUT.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: 'inherit' }
  );
  if (zip.status === 0) log(`Zip: ${zipPath}`);
  else log('Zip failed — folder is still ready at release/OugiHost');

  try {
    copyFile(path.join(OUT, 'OugiHost.exe'), path.join(ROOT, 'OugiHost.exe'));
    copyFile(path.join(OUT, 'WebView2Loader.dll'), path.join(ROOT, 'WebView2Loader.dll'));
    copyFile(path.join(OUT, 'OugiHost.dat'), path.join(ROOT, 'OugiHost.dat'));
  } catch {
    /* exe locked */
  }

  const buyerDir = path.join(ROOT, 'Ougi');
  log(`Also writing buyer folder ${buyerDir}`);
  rmrf(buyerDir);
  mkdir(buyerDir);
  copyFile(path.join(OUT, 'OugiHost.exe'), path.join(buyerDir, 'OugiHost.exe'));
  copyFile(path.join(OUT, 'OugiHost.dat'), path.join(buyerDir, 'OugiHost.dat'));
  copyFile(path.join(OUT, 'WebView2Loader.dll'), path.join(buyerDir, 'WebView2Loader.dll'));
  writeReadme(buyerDir);

  log('Done. Ship the Ougi\\ folder (or release/OugiHost-win-x64.zip)');
  log('Contents: exe + OugiHost.dat + WebView2Loader.dll (no source folders).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
