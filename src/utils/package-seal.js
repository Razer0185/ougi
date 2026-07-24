'use strict';

/**
 * Current PC Host buyer-package AES key (unlocks Ougi.sealed).
 * Set OUGI_PC_PACKAGE_KEY (base64 32 bytes) on Railway after each pack,
 * or keep data/pc-package-key.json for local/dev.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dataFile } = require('./data-paths');

const KEY_PATH = dataFile('pc-package-key.json');

function ensureDir() {
  const dir = path.dirname(KEY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadStore() {
  ensureDir();
  if (!fs.existsSync(KEY_PATH)) return { current: null, byVersion: {} };
  try {
    return JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  } catch {
    return { current: null, byVersion: {} };
  }
}

function saveStore(store) {
  ensureDir();
  fs.writeFileSync(KEY_PATH, JSON.stringify(store, null, 2), { mode: 0o600 });
}

/** Persist a new package key for this build version. */
function setPackageKey(version, keyBuf) {
  if (!Buffer.isBuffer(keyBuf) || keyBuf.length !== 32) {
    throw new Error('Package key must be 32 bytes');
  }
  const store = loadStore();
  const entry = {
    version: String(version),
    key: keyBuf.toString('base64'),
    at: Date.now(),
  };
  store.current = entry;
  store.byVersion[entry.version] = entry;
  saveStore(store);
  return entry;
}

function keyFromEnv() {
  const raw = String(process.env.OUGI_PC_PACKAGE_KEY || '').trim();
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Resolve decrypt key for a sealed package version.
 * Prefers env (production), then matching version, then current.
 */
function resolvePackageKey(version) {
  const envKey = keyFromEnv();
  const store = loadStore();
  const ver = String(version || '');

  if (ver && store.byVersion[ver]?.key) {
    const buf = Buffer.from(store.byVersion[ver].key, 'base64');
    if (buf.length === 32) return { key: buf, version: ver, source: 'store' };
  }

  // Env overrides as the "live" key for whatever build is current on the CDN/folder
  if (envKey) {
    return { key: envKey, version: ver || store.current?.version || 'env', source: 'env' };
  }

  if (store.current?.key) {
    const buf = Buffer.from(store.current.key, 'base64');
    if (buf.length === 32) {
      return { key: buf, version: store.current.version, source: 'store-current' };
    }
  }

  return null;
}

function getPublicPackageMeta() {
  const store = loadStore();
  const envOn = !!keyFromEnv();
  return {
    configured: envOn || !!(store.current && store.current.key),
    version: store.current?.version || null,
    source: envOn ? 'env' : store.current ? 'file' : null,
  };
}

function randomPackageKey() {
  return crypto.randomBytes(32);
}

module.exports = {
  setPackageKey,
  resolvePackageKey,
  getPublicPackageMeta,
  randomPackageKey,
  KEY_PATH,
};
