(function () {
  const needLogin = document.getElementById('needLogin');
  const hostPanel = document.getElementById('hostPanel');
  const hostStatus = document.getElementById('hostStatus');
  let csrf = '';
  let lastInviteUrl = '';

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

  function daysLeftLabel(sub) {
    if (!sub) return '—';
    if (sub.planId === 'lifetime' || sub.expiresAt == null) return 'Lifetime';
    const ms = Number(sub.expiresAt) - Date.now();
    if (!Number.isFinite(ms)) return '—';
    if (ms <= 0) return 'Expired';
    const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
    if (days <= 1) {
      const hours = Math.max(1, Math.ceil(ms / (60 * 60 * 1000)));
      return hours + 'h left';
    }
    return days + ' days left';
  }

  function shortGuild(id) {
    if (!id) return 'Not linked';
    const s = String(id);
    if (s.length <= 10) return s;
    return s.slice(0, 6) + '…' + s.slice(-4);
  }

  function setSteps(donePay, doneActivate, doneInviteReady) {
    const steps = document.getElementById('hostSteps');
    if (!steps) return;
    steps.querySelectorAll('[data-step]').forEach((li) => {
      const step = li.getAttribute('data-step');
      let on = false;
      if (step === 'pay') on = donePay;
      if (step === 'activate') on = doneActivate;
      if (step === 'invite') on = doneInviteReady;
      li.classList.toggle('done', on);
      li.classList.toggle('current', false);
    });
    const order = ['pay', 'activate', 'invite'];
    const flags = { pay: donePay, activate: doneActivate, invite: doneInviteReady };
    const next = order.find((k) => !flags[k]);
    if (next) {
      const el = steps.querySelector(`[data-step="${next}"]`);
      if (el) el.classList.add('current');
    }
  }

  function renderOverview(sub, inviteUrl) {
    const badge = document.getElementById('hostBadge');
    const next = document.getElementById('hostNext');
    const detail = document.getElementById('hostNextDetail');
    const days = document.getElementById('hostDaysLeft');
    const guildShort = document.getElementById('hostGuildShort');

    days.textContent = daysLeftLabel(sub);
    guildShort.textContent = shortGuild(sub?.guildId);

    const status = sub?.status || 'none';
    badge.className = 'host-badge';
    if (status === 'active') {
      badge.classList.add('ok');
      badge.textContent = 'Hosting active';
      next.textContent = inviteUrl ? 'Invite Ougi if it is not in your server yet' : 'Hosting is live on your server';
      detail.textContent = 'Use Configure bot for settings, or renew before expiry.';
      setSteps(true, true, !!inviteUrl || !!sub?.guildId);
    } else if (status === 'pending_activate') {
      badge.classList.add('warn');
      badge.textContent = 'Paid — activate next';
      next.textContent = 'Enter your Discord server ID and activate';
      detail.textContent = 'Then open the invite link to add Ougi.';
      setSteps(true, false, false);
    } else if (status === 'expired') {
      badge.classList.add('bad');
      badge.textContent = 'Expired';
      next.textContent = 'Renew on Checkout to restore hosting';
      detail.textContent = 'After payment, activate your server ID again.';
      setSteps(false, false, false);
    } else {
      badge.classList.add('muted');
      badge.textContent = 'No plan';
      next.textContent = 'Start with Checkout';
      detail.textContent = 'Pick a monthly plan, then come back here to activate.';
      setSteps(false, false, false);
    }
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
    lastInviteUrl = '';
    if (sub && (sub.status === 'active' || sub.status === 'pending_activate')) {
      inviteBlock.hidden = false;
      if (data.inviteUrl) {
        lastInviteUrl = data.inviteUrl;
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

    renderOverview(sub, data.inviteUrl);

    if (sub?.guildId) {
      document.getElementById('guildInput').value = sub.guildId;
    }

    const devBtn = document.getElementById('devGrantBtn');
    if (devBtn) {
      if (!sub || sub.status === 'expired' || sub.status === 'none') devBtn.hidden = false;
      else devBtn.hidden = Boolean(sub && sub.status !== 'expired' && sub.planId);
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

  document.getElementById('copyInviteBtn')?.addEventListener('click', async () => {
    const out = document.getElementById('inviteCopyStatus');
    if (!lastInviteUrl) {
      if (out) out.textContent = 'Invite link not ready yet.';
      return;
    }
    try {
      await navigator.clipboard.writeText(lastInviteUrl);
      if (out) {
        out.textContent = 'Invite link copied.';
        out.style.color = 'var(--ok)';
      }
    } catch {
      if (out) {
        out.textContent = lastInviteUrl;
        out.style.color = '';
      }
    }
  });

  load().catch((err) => {
    needLogin.hidden = false;
    hostPanel.hidden = true;
    console.error(err);
  });
})();
