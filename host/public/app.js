const els = {
  statusPill: document.getElementById('statusPill'),
  statusText: document.getElementById('statusText'),
  uptime: document.getElementById('uptime'),
  pid: document.getElementById('pid'),
  mode: document.getElementById('mode'),
  themeGrid: document.getElementById('themeGrid'),
  activeThemeChip: document.getElementById('activeThemeChip'),
  footTheme: document.getElementById('footTheme'),
  autoHostToggle: document.getElementById('autoHostToggle'),
  autoHostHint: document.getElementById('autoHostHint'),
  logs: document.getElementById('logs'),
  toast: document.getElementById('toast'),
  btnStart: document.getElementById('btnStart'),
  btnStop: document.getElementById('btnStop'),
  btnRestart: document.getElementById('btnRestart'),
  btnClearLogs: document.getElementById('btnClearLogs'),
  btnInvite: document.getElementById('btnInvite'),
  btnCopyInvite: document.getElementById('btnCopyInvite'),
  inviteHint: document.getElementById('inviteHint'),
  privateModeToggle: document.getElementById('privateModeToggle'),
  privateHint: document.getElementById('privateHint'),
  pendingRequests: document.getElementById('pendingRequests'),
  allowedList: document.getElementById('allowedList'),
  allowGuildInput: document.getElementById('allowGuildInput'),
  btnAllowGuild: document.getElementById('btnAllowGuild'),
  btnLicense: document.getElementById('btnLicense'),
  licenseOut: document.getElementById('licenseOut'),
  btnOpenSite: document.getElementById('btnOpenSite'),
};

let themes = [];
let lastLogTs = 0;
let toastTimer = null;

function formatUptime(ms) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m ${sec}s`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function applyTheme(themeId) {
  const t = themes.find((x) => x.id === themeId) || themes[0];
  if (!t) return;
  document.documentElement.style.setProperty('--accent', t.accent);
  document.documentElement.style.setProperty('--bg', t.bg);
  document.documentElement.style.setProperty('--card', t.card);
  document.documentElement.setAttribute('data-theme', t.id);
  document.body.classList.toggle('light', !!t.light);
  els.activeThemeChip.textContent = t.label;
  els.footTheme.textContent = `Theme: ${t.label}`;
  document.querySelectorAll('.theme-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.id === t.id);
  });
}

function renderThemes(active) {
  els.themeGrid.innerHTML = '';
  for (const t of themes) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-card' + (t.id === active ? ' active' : '');
    btn.dataset.id = t.id;
    btn.innerHTML = `
      <div class="theme-swatch" style="--swatch:${t.accent}; background:
        linear-gradient(145deg, ${t.accent}, ${t.bg}); height:54px;"></div>
      <div class="theme-meta">
        <strong>${t.label}</strong>
        <span>${t.accent}</span>
      </div>
    `;
    btn.addEventListener('click', () => setTheme(t.id));
    els.themeGrid.appendChild(btn);
  }
}

function toast(msg) {
  els.toast.hidden = false;
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
  }, 2600);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  return res.json();
}

function updateStatus(data) {
  const on = !!data.running;
  els.statusPill.classList.toggle('on', on);
  els.statusPill.classList.toggle('off', !on);
  els.statusText.textContent = on ? 'Bot hosted' : 'Bot stopped';
  els.uptime.textContent = formatUptime(data.uptimeMs);
  els.pid.textContent = data.pid || '—';
  els.mode.textContent = data.managed ? 'Managed' : on ? 'External' : 'Idle';
  els.autoHostToggle.checked = !!data.autoHost;
  els.autoHostHint.textContent = data.autoHost
    ? 'Auto-host is ON — Ougi starts with Windows sign-in.'
    : 'Auto-host is OFF.';
  if (data.inviteUrl) {
    els.btnInvite.href = data.inviteUrl;
    els.inviteHint.textContent =
      'Owner invite only — after they authorize, allow their server ID below.';
    els.btnInvite.dataset.url = data.inviteUrl;
  } else {
    els.btnInvite.href = '#';
    els.inviteHint.textContent = 'Invite link unavailable — check token.txt.';
  }

  if (data.access && els.privateModeToggle) {
    els.privateModeToggle.checked = !!data.access.privateMode;
    els.privateHint.textContent = data.access.privateMode
      ? `Private mode ON · ${data.access.allowedCount} allowed server(s)`
      : 'Private mode OFF — anyone with the invite can keep Ougi.';
    els.allowedList.textContent = data.access.allowedGuildIds?.length
      ? `Allowed: ${data.access.allowedGuildIds.join(', ')}`
      : 'Allowed: none yet (your current servers seed on bot start).';
    const pending = data.access.pendingRequests || [];
    if (!pending.length) {
      els.pendingRequests.textContent = 'No pending website requests.';
    } else {
      els.pendingRequests.innerHTML = pending
        .map(
          (r) =>
            `<div style="margin:6px 0">` +
            `<code>${r.id}</code> · ${r.discord || '—'} · ${r.server || 'n/a'} ` +
            `<button data-approve="${r.id}" class="btn tiny ghost" type="button">Approve</button> ` +
            `<button data-deny="${r.id}" class="btn tiny ghost" type="button">Deny</button>` +
            `</div>`
        )
        .join('');
      els.pendingRequests.querySelectorAll('[data-approve]').forEach((btn) => {
        btn.onclick = async () => {
          const guildId = prompt('Server ID to allow (required after they invite):') || '';
          const res = await api('/api/access', {
            method: 'POST',
            body: JSON.stringify({
              action: 'approve',
              requestId: btn.dataset.approve,
              guildId: guildId || undefined,
            }),
          });
          toast(res.ok ? 'Approved' : res.message || 'Failed');
          await refresh();
        };
      });
      els.pendingRequests.querySelectorAll('[data-deny]').forEach((btn) => {
        btn.onclick = async () => {
          const res = await api('/api/access', {
            method: 'POST',
            body: JSON.stringify({ action: 'deny', requestId: btn.dataset.deny }),
          });
          toast(res.ok ? 'Denied' : res.message || 'Failed');
          await refresh();
        };
      });
    }
  }
}

function appendLogs(entries) {
  if (!entries?.length) return;
  const atBottom =
    els.logs.scrollTop + els.logs.clientHeight >= els.logs.scrollHeight - 24;
  for (const e of entries) {
    lastLogTs = Math.max(lastLogTs, e.t);
    const time = new Date(e.t).toLocaleTimeString();
    const line = document.createElement('div');
    line.className = e.source || 'bot';
    line.textContent = `[${time}] ${e.line}`;
    els.logs.appendChild(line);
  }
  while (els.logs.childNodes.length > 400) {
    els.logs.removeChild(els.logs.firstChild);
  }
  if (atBottom) els.logs.scrollTop = els.logs.scrollHeight;
}

async function setTheme(id) {
  const data = await api('/api/theme', {
    method: 'POST',
    body: JSON.stringify({ theme: id }),
  });
  if (!data.ok) return toast(data.message || 'Could not set theme');
  applyTheme(id);
  toast(`Host theme → ${id}`);
}

async function refresh() {
  const data = await api('/api/status');
  themes = data.themes || [];
  if (!els.themeGrid.children.length) renderThemes(data.theme);
  applyTheme(data.theme);
  updateStatus(data);
}

async function pollLogs() {
  const data = await api(`/api/logs?since=${lastLogTs}`);
  appendLogs(data.logs || []);
}

els.btnStart.addEventListener('click', async () => {
  els.btnStart.disabled = true;
  const data = await api('/api/start', { method: 'POST', body: '{}' });
  toast(data.message || 'Started');
  els.btnStart.disabled = false;
  await refresh();
});

els.btnStop.addEventListener('click', async () => {
  els.btnStop.disabled = true;
  const data = await api('/api/stop', { method: 'POST', body: '{}' });
  toast(data.message || 'Stopped');
  els.btnStop.disabled = false;
  await refresh();
});

els.btnRestart.addEventListener('click', async () => {
  els.btnRestart.disabled = true;
  const data = await api('/api/restart', { method: 'POST', body: '{}' });
  toast(data.message || 'Restarted');
  els.btnRestart.disabled = false;
  await refresh();
});

els.autoHostToggle.addEventListener('change', async () => {
  const enabled = els.autoHostToggle.checked;
  const data = await api('/api/autohost', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
  toast(data.message || (enabled ? 'Auto-host on' : 'Auto-host off'));
  await refresh();
});

els.btnClearLogs.addEventListener('click', () => {
  els.logs.innerHTML = '';
});

els.btnCopyInvite.addEventListener('click', async () => {
  const url = els.btnInvite.dataset.url || els.btnInvite.href;
  if (!url || url === '#') return toast('Invite link not ready');
  try {
    await navigator.clipboard.writeText(url);
    toast('Invite link copied');
  } catch {
    toast(url);
  }
});

if (els.privateModeToggle) {
  els.privateModeToggle.addEventListener('change', async () => {
    const enabled = els.privateModeToggle.checked;
    const data = await api('/api/access', {
      method: 'POST',
      body: JSON.stringify({ action: 'private', enabled }),
    });
    toast(data.ok ? (enabled ? 'Private mode on' : 'Private mode off') : data.message || 'Failed');
    await refresh();
  });
}

if (els.btnAllowGuild) {
  els.btnAllowGuild.addEventListener('click', async () => {
    const guildId = (els.allowGuildInput.value || '').trim();
    if (!guildId) return toast('Enter a server ID');
    const data = await api('/api/access', {
      method: 'POST',
      body: JSON.stringify({ action: 'allow', guildId }),
    });
    toast(data.ok ? 'Server allowed' : data.message || 'Failed');
    els.allowGuildInput.value = '';
    await refresh();
  });
}

if (els.btnLicense) {
  els.btnLicense.addEventListener('click', async () => {
    const data = await api('/api/access', {
      method: 'POST',
      body: JSON.stringify({ action: 'license', note: 'host' }),
    });
    if (!data.ok) return toast(data.message || 'Failed');
    els.licenseOut.textContent = `License: ${data.license.key} — customer runs: access redeem ${data.license.key}`;
    try {
      await navigator.clipboard.writeText(data.license.key);
      toast('License key copied');
    } catch {
      toast(data.license.key);
    }
  });
}

refresh()
  .then(pollLogs)
  .catch((err) => toast(String(err.message || err)));

setInterval(() => {
  refresh().catch(() => {});
  pollLogs().catch(() => {});
}, 2000);
