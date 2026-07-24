'use strict';

/**
 * Copy OugiHost.exe + WebView2Loader.dll to the repo root.
 * Single-file publish still needs the native loader next to the exe.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'desktop', 'dist');

const exeSrc = path.join(dist, 'OugiHost.exe');
const dllCandidates = [
  path.join(dist, 'WebView2Loader.dll'),
  path.join(dist, 'runtimes', 'win-x64', 'native', 'WebView2Loader.dll'),
  path.join(
    root,
    'desktop',
    'OugiHost',
    'bin',
    'Release',
    'net8.0-windows',
    'win-x64',
    'WebView2Loader.dll'
  ),
  path.join(
    root,
    'desktop',
    'OugiHost',
    'bin',
    'Release',
    'net8.0-windows',
    'win-x64',
    'runtimes',
    'win-x64',
    'native',
    'WebView2Loader.dll'
  ),
];

if (!fs.existsSync(exeSrc)) {
  console.error('Missing publish output:', exeSrc);
  process.exit(1);
}

fs.copyFileSync(exeSrc, path.join(root, 'OugiHost.exe'));
console.log('OugiHost.exe updated');

const dllSrc = dllCandidates.find((p) => fs.existsSync(p));
if (!dllSrc) {
  console.error('Missing WebView2Loader.dll — Host UI will fail to start.');
  process.exit(1);
}

fs.copyFileSync(dllSrc, path.join(root, 'WebView2Loader.dll'));
console.log('WebView2Loader.dll updated (required next to OugiHost.exe)');
