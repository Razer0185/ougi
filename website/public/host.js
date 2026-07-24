(function () {
  const needLogin = document.getElementById('needLogin');
  const hostPanel = document.getElementById('hostPanel');
  const hostStatus = document.getElementById('hostStatus');
  let csrf = '';

  function setStatus(msg, ok) {
    if (!hostStatus) return;
    hostStatus.textContent = msg || '';
    hostStatus.style.color = ok === false ? 'var(--danger)' : ok ? 'var(--ok)' : '';
  }

  function fmtExpiry(sub) {
    if (!sub) return '—';
    if (sub.expiresAt == null && sub.planId === 'lifetime') return 'Never (lifetime)';
    if (!sub.expiresAt) return '—';
    return new Date(sub.expiresAt).toLocaleString();
  }

  function render(data) {
    const sub = data.subscription;
    document.getElementById('hName').textContent = data.user?.name || '—';
    document.getElementById('hEmail').textContent = data.user?.email || '—';
    document.getElementById('hDiscord').textContent = data.user?.discord || '—';
    document.getElementById('hStatus').textContent = sub?.status || 'none';
    document.getElementById('hPlan').textContent = sub?.planName || 'No plan yet';
    document.getElementById('hExpires').textContent = fmtExpiry(sub);
    document.getElementById('hGuild').textContent = sub?.guildId || 'Not linked';

    const hint = document.getElementById('hHint');
    if (!sub) {
      hint.textContent =
        'No paid plan yet. Checkout first, then Activate hosting here (we host — no source download).';
    } else if (sub.status === 'expired') {
      hint.textContent = 'Expired — renew on Checkout, then Activate again. Access ends when the month ends.';
    } else if (sub.status === 'pending_activate') {
      hint.textContent =
        'Paid and ready. Enter your Discord server ID and click Activate hosting — then invite our bot.';
    } else if (sub.active) {
      hint.textContent =
        'Hosting active on this server. Invite the bot below if needed. Deactivate unbinds and we leave.';
    } else {
      hint.textContent = '';
    }

    const inviteBlock = document.getElementById('inviteBlock');
    const inviteLink = document.getElementById('inviteLink');
    const inviteMissing = document.getElementById('inviteMissing');
    if (sub && (sub.status === 'active' || sub.status === 'pending_activate')) {
      inviteBlock.hidden = false;
      if (data.inviteUrl) {
        inviteLink.href = data.inviteUrl;
        inviteLink.hidden = false;
        inviteMissing.hidden = true;
      } else {
        inviteLink.hidden = true;
        inviteMissing.hidden = false;
      }
    } else {
      inviteBlock.hidden = true;
    }

    if (sub?.guildId) {
      document.getElementById('guildInput').value = sub.guildId;
    }

    // Dev grant button when no plan (local site)
    const devBtn = document.getElementById('devGrantBtn');
    if (devBtn) {
      devBtn.hidden = Boolean(sub && sub.status !== 'expired' && sub.planId);
      // Always show in non-paid local testing when nothing active
      if (!sub || sub.status === 'expired' || sub.status === 'none') devBtn.hidden = false;
    }
  }

  async function load() {
    const res = await fetch('/api/host/status', { credentials: 'same-origin' });
    if (res.status === 401) {
      needLogin.hidden = false;
      hostPanel.hidden = true;
      return;
    }
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || 'Failed to load');
    csrf = data.csrf;
    needLogin.hidden = true;
    hostPanel.hidden = false;
    render(data);
  }

  document.getElementById('activateBtn')?.addEventListener('click', async () => {
    setStatus('Activating…');
    try {
      const guildId = document.getElementById('guildInput').value.trim();
      const res = await fetch('/api/host/activate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ csrf, guildId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || 'Activate failed');
      setStatus('Hosting activated for that server.', true);
      await load();
    } catch (err) {
      setStatus(err.message || 'Activate failed', false);
    }
  });

  document.getElementById('deactivateBtn')?.addEventListener('click', async () => {
    setStatus('Deactivating…');
    try {
      const res = await fetch('/api/host/deactivate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ csrf }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || 'Deactivate failed');
      setStatus('Hosting deactivated.', true);
      await load();
    } catch (err) {
      setStatus(err.message || 'Deactivate failed', false);
    }
  });

  document.getElementById('devGrantBtn')?.addEventListener('click', async () => {
    setStatus('Granting test plan…');
    try {
      const res = await fetch('/api/host/grant-dev', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ csrf, planId: 'starter' }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || 'Grant failed (production disables this)');
      setStatus('Test month granted. Enter server ID and Activate.', true);
      await load();
    } catch (err) {
      setStatus(err.message || 'Grant failed', false);
    }
  });

  load().catch((err) => {
    needLogin.hidden = false;
    hostPanel.hidden = true;
    console.error(err);
  });
})();
