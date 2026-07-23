const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const BOT_ENTRY = path.join(ROOT, 'index.js');
const STARTUP_NAME = 'OugiBot-AutoHost';
const STARTUP_DIR = path.join(
  process.env.APPDATA || '',
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup'
);
const STARTUP_BAT = path.join(STARTUP_DIR, `${STARTUP_NAME}.bat`);

const THEMES = [
  { id: 'red', label: 'Red', accent: '#E74C3C', bg: '#1a0f10', card: '#2a1618' },
  { id: 'black', label: 'Black', accent: '#E8E8E8', bg: '#0a0a0a', card: '#161616' },
  { id: 'white', label: 'White', accent: '#F5F5F5', bg: '#e8e8ec', card: '#ffffff', light: true },
  { id: 'pink', label: 'Pink', accent: '#FF6B9D', bg: '#1a1016', card: '#2a1822' },
  { id: 'blue', label: 'Blue', accent: '#57C7FF', bg: '#0d1520', card: '#152030' },
  { id: 'purple', label: 'Purple', accent: '#9B59B6', bg: '#140f1a', card: '#221830' },
  { id: 'green', label: 'Green', accent: '#2ECC71', bg: '#0d1812', card: '#152820' },
  { id: 'orange', label: 'Orange', accent: '#E67E22', bg: '#1a120a', card: '#2a1c10' },
  { id: 'cyan', label: 'Cyan', accent: '#1ABC9C', bg: '#0a1616', card: '#122424' },
  { id: 'gold', label: 'Gold', accent: '#F1C40F', bg: '#16140a', card: '#262210' },
];

let botProcess = null;
let botStartedAt = null;
const logs = [];
const MAX_LOGS = 400;

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify({ theme: 'blue', autoHost: false, port: 7474 }, null, 2)
    );
  }
}

function loadConfig() {
  ensureData();
  try {
    return {
      theme: 'blue',
      autoHost: false,
      port: 7474,
      ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')),
    };
  } catch {
    return { theme: 'blue', autoHost: false, port: 7474 };
  }
}

function saveConfig(cfg) {
  ensureData();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function pushLog(line, source = 'bot') {
  const entry = { t: Date.now(), source, line: String(line).replace(/\r/g, '') };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
}

function isBotRunning() {
  if (botProcess && !botProcess.killed && botProcess.exitCode === null) return true;
  // Also detect externally started bot
  try {
    if (process.platform === 'win32') {
      const out = execSync(
        'wmic process where "name=\'node.exe\'" get ProcessId,CommandLine /FORMAT:CSV',
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
      );
      return out.includes('index.js') && out.toLowerCase().includes('nexus-bot');
    }
  } catch {
    /* ignore */
  }
  return false;
}

function findExternalBotPids() {
  const pids = [];
  try {
    if (process.platform !== 'win32') return pids;
    const out = execSync(
      'wmic process where "name=\'node.exe\'" get ProcessId,CommandLine /FORMAT:CSV',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    );
    for (const line of out.split(/\r?\n/)) {
      if (!/index\.js/i.test(line)) continue;
      if (!/nexus-bot/i.test(line) && !line.includes(ROOT.replace(/\\/g, '\\\\'))) {
        // still accept any index.js in this folder path
        if (!line.includes(ROOT) && !line.includes('nexus-bot')) continue;
      }
      const parts = line.split(',');
      const pid = Number(parts[parts.length - 1]);
      if (pid && pid !== process.pid) pids.push(pid);
    }
  } catch {
    /* ignore */
  }
  return pids;
}

function startBot() {
  if (botProcess && botProcess.exitCode === null) {
    return { ok: true, message: 'Bot is already running (managed).' };
  }
  if (isBotRunning()) {
    return { ok: true, message: 'Bot is already running.' };
  }

  botProcess = spawn(process.execPath, [BOT_ENTRY], {
    cwd: ROOT,
    env: { ...process.env, NEXUS_HOSTED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  botStartedAt = Date.now();
  pushLog('Bot process started.', 'host');

  botProcess.stdout.on('data', (buf) => {
    String(buf)
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => pushLog(line, 'bot'));
  });
  botProcess.stderr.on('data', (buf) => {
    String(buf)
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => pushLog(line, 'err'));
  });
  botProcess.on('exit', (code) => {
    pushLog(`Bot exited (code ${code}).`, 'host');
    botProcess = null;
    botStartedAt = null;
  });

  return { ok: true, message: 'Bot hosted.' };
}

function stopBot() {
  let stopped = false;

  if (botProcess && botProcess.exitCode === null) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${botProcess.pid} /T /F`, { windowsHide: true, stdio: 'ignore' });
      } else {
        botProcess.kill('SIGTERM');
      }
    } catch {
      botProcess.kill();
    }
    botProcess = null;
    botStartedAt = null;
    stopped = true;
  }

  for (const pid of findExternalBotPids()) {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { windowsHide: true, stdio: 'ignore' });
      stopped = true;
    } catch {
      /* ignore */
    }
  }

  pushLog(stopped ? 'Bot stopped.' : 'Bot was not running.', 'host');
  return { ok: true, message: stopped ? 'Bot stopped.' : 'Bot was not running.' };
}

function setAutoHost(enabled) {
  const cfg = loadConfig();
  cfg.autoHost = !!enabled;
  saveConfig(cfg);

  if (process.platform !== 'win32') {
    return { ok: false, message: 'Auto-host currently supports Windows only.' };
  }

  try {
    if (!fs.existsSync(STARTUP_DIR)) fs.mkdirSync(STARTUP_DIR, { recursive: true });
    if (enabled) {
      const nodePath = process.execPath;
      const launcher = path.join(__dirname, 'autostart.js');
      const content =
        `@echo off\r\n` +
        `cd /d "${ROOT}"\r\n` +
        `"${nodePath}" "${launcher}"\r\n`;
      fs.writeFileSync(STARTUP_BAT, content, 'utf8');
      pushLog('Auto-host enabled (Windows Startup).', 'host');
      return { ok: true, message: 'Auto-host ON — bot will start when Windows signs in.' };
    }
    if (fs.existsSync(STARTUP_BAT)) fs.unlinkSync(STARTUP_BAT);
    pushLog('Auto-host disabled.', 'host');
    return { ok: true, message: 'Auto-host OFF.' };
  } catch (err) {
    return { ok: false, message: String(err.message || err) };
  }
}

function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
    }[ext] || 'application/octet-stream'
  );
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function getBotInviteUrl() {
  try {
    const tokenPath = path.join(ROOT, 'token.txt');
    if (!fs.existsSync(tokenPath)) return null;
    const token = fs.readFileSync(tokenPath, 'utf8').trim();
    const id = Buffer.from(token.split('.')[0], 'base64').toString('utf8');
    if (!/^\d{16,20}$/.test(id)) return null;
    const { buildBotInviteUrl } = require(path.join(ROOT, 'src', 'utils', 'invite'));
    return buildBotInviteUrl(id);
  } catch {
    return null;
  }
}

function statusPayload() {
  const cfg = loadConfig();
  const running = isBotRunning();
  let access = { privateMode: true, allowedGuildIds: [], requests: [] };
  try {
    access = require(path.join(ROOT, 'src', 'utils', 'access')).loadAccess();
  } catch {
    /* ignore */
  }
  return {
    running,
    managed: !!(botProcess && botProcess.exitCode === null),
    pid: botProcess?.pid || null,
    startedAt: botStartedAt,
    uptimeMs: botStartedAt ? Date.now() - botStartedAt : 0,
    theme: cfg.theme,
    autoHost: cfg.autoHost || fs.existsSync(STARTUP_BAT),
    themes: THEMES,
    port: cfg.port,
    inviteUrl: getBotInviteUrl(),
    siteUrl: 'http://127.0.0.1:5050',
    access: {
      privateMode: !!access.privateMode,
      allowedCount: (access.allowedGuildIds || []).length,
      allowedGuildIds: access.allowedGuildIds || [],
      pendingRequests: (access.requests || []).filter((r) => r.status === 'pending').slice(0, 20),
    },
  };
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/status') {
    return sendJson(res, 200, statusPayload());
  }
  if (req.method === 'GET' && pathname === '/api/logs') {
    const url = new URL(req.url, 'http://localhost');
    const since = Number(url.searchParams.get('since') || 0);
    return sendJson(res, 200, { logs: logs.filter((l) => l.t > since) });
  }
  if (req.method === 'GET' && pathname === '/api/themes') {
    return sendJson(res, 200, { themes: THEMES, active: loadConfig().theme });
  }

  if (req.method === 'GET' && pathname === '/api/invite') {
    const inviteUrl = getBotInviteUrl();
    if (!inviteUrl) {
      return sendJson(res, 400, {
        ok: false,
        message: 'Could not build invite URL. Check token.txt.',
      });
    }
    return sendJson(res, 200, {
      ok: true,
      inviteUrl,
      private: true,
      tip: 'Owner-only invite. After they join, approve their server ID under Access.',
    });
  }

  if (req.method === 'GET' && pathname === '/api/access') {
    const access = require(path.join(ROOT, 'src', 'utils', 'access')).loadAccess();
    return sendJson(res, 200, { ok: true, access });
  }

  if (req.method === 'POST' && pathname === '/api/access') {
    const body = await readBody(req);
    const accessApi = require(path.join(ROOT, 'src', 'utils', 'access'));
    const action = String(body.action || '').toLowerCase();
    try {
      if (action === 'private') {
        accessApi.setPrivateMode(!!body.enabled);
        pushLog(`Private mode ${body.enabled ? 'ON' : 'OFF'}`, 'host');
      } else if (action === 'allow' && body.guildId) {
        accessApi.allowGuild(String(body.guildId));
        pushLog(`Allowed guild ${body.guildId}`, 'host');
      } else if (action === 'revoke' && body.guildId) {
        accessApi.revokeGuild(String(body.guildId));
        pushLog(`Revoked guild ${body.guildId}`, 'host');
      } else if (action === 'approve' && body.requestId) {
        accessApi.setRequestStatus(String(body.requestId), 'approved', body.guildId || null);
        pushLog(`Approved request ${body.requestId}`, 'host');
      } else if (action === 'deny' && body.requestId) {
        accessApi.setRequestStatus(String(body.requestId), 'denied');
        pushLog(`Denied request ${body.requestId}`, 'host');
      } else if (action === 'license') {
        const lic = accessApi.createLicense(body.note || '');
        return sendJson(res, 200, { ok: true, license: lic, access: accessApi.loadAccess() });
      } else {
        return sendJson(res, 400, { ok: false, message: 'Unknown access action.' });
      }
      return sendJson(res, 200, { ok: true, access: accessApi.loadAccess() });
    } catch (err) {
      return sendJson(res, 400, { ok: false, message: err.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/start') {
    return sendJson(res, 200, startBot());
  }
  if (req.method === 'POST' && pathname === '/api/stop') {
    return sendJson(res, 200, stopBot());
  }
  if (req.method === 'POST' && pathname === '/api/restart') {
    stopBot();
    await new Promise((r) => setTimeout(r, 800));
    return sendJson(res, 200, startBot());
  }
  if (req.method === 'POST' && pathname === '/api/theme') {
    const body = await readBody(req);
    const id = String(body.theme || '').toLowerCase();
    if (!THEMES.some((t) => t.id === id)) {
      return sendJson(res, 400, { ok: false, message: 'Unknown theme.' });
    }
    const cfg = loadConfig();
    cfg.theme = id;
    saveConfig(cfg);
    pushLog(`Host theme set to ${id}.`, 'host');
    return sendJson(res, 200, { ok: true, theme: id, themes: THEMES });
  }
  if (req.method === 'POST' && pathname === '/api/autohost') {
    const body = await readBody(req);
    return sendJson(res, 200, setAutoHost(!!body.enabled));
  }

  return sendJson(res, 404, { ok: false, message: 'Not found' });
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC, 'index.html');
  }
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mime(filePath) });
  res.end(data);
}

ensureData();
const config = loadConfig();
const PORT = Number(process.env.NEXUS_HOST_PORT || config.port || 7474);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url.pathname);
    }
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    pushLog(String(err.message || err), 'host');
    sendJson(res, 500, { ok: false, message: 'Server error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`Ougi Host App → ${url}`);
  pushLog(`Host panel listening on ${url}`, 'host');

  // Open browser on Windows
  if (process.platform === 'win32' && process.env.NEXUS_NO_OPEN !== '1') {
    try {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } catch {
      /* ignore */
    }
  }
});

process.on('SIGINT', () => {
  stopBot();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopBot();
  process.exit(0);
});
