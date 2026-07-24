(function () {
  let csrf = '';
  let activeId = '';
  let timer = null;
  let me = { role: 'staff', staffName: 'Staff', staffEmail: '', staffId: '' };

  async function api(path, opts = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    };
    if (csrf && opts.method && opts.method !== 'GET') headers['X-CSRF-Token'] = csrf;
    const res = await fetch(path, {
      credentials: 'same-origin',
      ...opts,
      headers,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || 'Request failed');
    return json;
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function renderThreads(threads) {
    const list = document.getElementById('threadList');
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!threads.length) {
      const p = document.createElement('p');
      p.className = 'note';
      p.style.padding = '14px';
      p.textContent = 'No chats yet.';
      list.appendChild(p);
      return;
    }
    threads.forEach((t) => {
      const btn = document.createElement('button');
      btn.className = `thread-item ${t.id === activeId ? 'active' : ''}`;
      btn.type = 'button';
      btn.dataset.id = t.id;
      const strong = document.createElement('strong');
      strong.textContent = t.buyerName;
      const small = document.createElement('small');
      small.textContent = t.preview || 'No messages';
      btn.appendChild(strong);
      btn.appendChild(small);
      btn.onclick = () => openThread(t.id);
      list.appendChild(btn);
    });
  }

  function renderMessages(thread) {
    const box = document.getElementById('adminMessages');
    document.getElementById('activeTitle').textContent = thread.buyerName;
    const order = thread.order
      ? `${thread.order.planName || ''} · ${thread.order.method || ''} · $${thread.order.amount ?? ''}`
      : 'No order info';
    document.getElementById('activeMeta').textContent = order;
    while (box.firstChild) box.removeChild(box.firstChild);
    (thread.messages || []).forEach((m) => {
      const bubble = document.createElement('div');
      bubble.className = `bubble ${m.from === 'staff' ? 'staff' : 'buyer'}`;
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = m.name || m.from;
      bubble.appendChild(who);
      bubble.appendChild(document.createTextNode(m.text || ''));
      box.appendChild(bubble);
    });
    box.scrollTop = box.scrollHeight;
  }

  async function refreshList() {
    const json = await api('/api/chat/admin/threads');
    renderThreads(json.threads || []);
  }

  async function openThread(id) {
    activeId = id;
    const json = await api(`/api/chat/thread/${encodeURIComponent(id)}`);
    renderMessages(json.thread);
    await refreshList();
  }

  async function enterInbox() {
    document.getElementById('loginGate').hidden = true;
    document.getElementById('inbox').hidden = false;
    const who = document.getElementById('staffWho');
    if (who) {
      who.textContent = `${me.staffName}${me.staffEmail ? ' · ' + me.staffEmail : ''}${
        me.role === 'admin' ? ' · admin' : ''
      }`;
    }
    const panel = document.getElementById('staffPanel');
    if (panel) panel.hidden = me.role !== 'admin';
    const freePanel = document.getElementById('freeBotPanel');
    if (freePanel) freePanel.hidden = me.role !== 'admin';
    await refreshList();
    await refreshPaypalClaims();
    if (me.role === 'admin') {
      await refreshStaffList();
      await refreshFreeBot();
    }
    if (timer) clearInterval(timer);
    timer = setInterval(async () => {
      try {
        await refreshList();
        await refreshPaypalClaims();
        if (activeId) await openThread(activeId);
      } catch {
        /* session may have expired */
      }
    }, 2500);
  }

  async function refreshPaypalClaims() {
    const box = document.getElementById('paypalClaims');
    const hint = document.getElementById('paypalApiHint');
    if (!box) return;
    try {
      const json = await api('/api/pay/paypal-claims?status=pending');
      if (hint) {
        hint.textContent =
          'Open PayPal → Activity. When you see a payment from the email below for the right amount, click Confirm & activate.';
      }
      while (box.firstChild) box.removeChild(box.firstChild);
      const claims = json.claims || [];
      if (!claims.length) {
        const p = document.createElement('p');
        p.className = 'note';
        p.textContent = 'No pending PayPal claims.';
        box.appendChild(p);
        return;
      }
      claims.forEach((c) => {
        const row = document.createElement('div');
        row.className = 'paypal-claim';
        const amt = Number(c.amount).toFixed(2).replace(/\.00$/, '');
        const txLine = c.transactionId
          ? `<div class="paypal-tx">TX <code>${esc(c.transactionId)}</code></div>`
          : '';
        row.innerHTML = `
          <div><strong>${esc(c.paypalSenderEmail || '—')}</strong>
            <span class="note"> sent $${esc(amt)} · ${esc(c.planName)}</span></div>
          <div class="note">Account: ${esc(c.discord || '—')} · ${esc(c.email || '')}</div>
          ${txLine}
          <div class="paypal-claim-actions">
            ${
              c.transactionId
                ? `<button type="button" class="btn tiny ghost" data-pp-action="api" data-id="${esc(c.id)}">Auto-check TX</button>`
                : ''
            }
            <button type="button" class="btn tiny primary" data-pp-action="confirm" data-id="${esc(c.id)}">Confirm &amp; activate</button>
            <button type="button" class="btn tiny ghost" data-pp-action="reject" data-id="${esc(c.id)}">Reject</button>
          </div>
          <p class="note pp-msg" data-msg-for="${esc(c.id)}"></p>
        `;
        box.appendChild(row);
      });
      box.querySelectorAll('[data-pp-action]').forEach((btn) => {
        btn.addEventListener('click', () => runPaypalAction(btn.dataset.id, btn.dataset.ppAction));
      });
    } catch (err) {
      if (hint) hint.textContent = err.message || 'Could not load claims';
    }
  }

  async function runPaypalAction(claimId, action) {
    const msg = document.querySelector(`[data-msg-for="${claimId}"]`);
    if (msg) {
      msg.className = 'note pp-msg';
      msg.textContent = 'Working…';
    }
    try {
      const json = await api('/api/pay/paypal-claim/verify', {
        method: 'POST',
        body: JSON.stringify({ csrf, claimId, action }),
      });
      if (msg) {
        if (json.autoVerified) {
          msg.className = 'note pp-msg ok';
          msg.textContent = 'Verified — plan activated for that account.';
        } else if (json.matched === false) {
          msg.className = 'note pp-msg err';
          msg.textContent = json.reason || 'TX not found in PayPal.';
        } else if (json.claim) {
          msg.className = 'note pp-msg';
          msg.textContent = json.reason || json.claim.verifyNote || 'Updated.';
        } else {
          msg.textContent = 'Done.';
        }
      }
      await refreshPaypalClaims();
    } catch (err) {
      if (msg) {
        msg.className = 'note pp-msg err';
        msg.textContent = err.message || 'Failed';
      }
    }
  }

  async function refreshStaffList() {
    const box = document.getElementById('staffList');
    if (!box || me.role !== 'admin') return;
    try {
      const json = await api('/api/chat/admin/staff');
      while (box.firstChild) box.removeChild(box.firstChild);
      (json.staff || []).forEach((s) => {
        const row = document.createElement('div');
        row.className = 'paypal-claim';
        row.innerHTML = `
          <div><strong>${esc(s.email)}</strong>
            <span class="note"> · ${esc(s.name)} · ${esc(s.role)}${s.disabled ? ' · disabled' : ''}</span></div>
          ${
            s.id !== me.staffId && !s.disabled
              ? `<button type="button" class="btn tiny ghost" data-disable="${esc(s.id)}">Disable</button>`
              : ''
          }
        `;
        box.appendChild(row);
      });
      box.querySelectorAll('[data-disable]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await api('/api/chat/admin/staff/disable', {
              method: 'POST',
              body: JSON.stringify({ csrf, staffId: btn.dataset.disable, disabled: true }),
            });
            await refreshStaffList();
          } catch (err) {
            const st = document.getElementById('staffStatus');
            if (st) {
              st.className = 'status show err';
              st.textContent = err.message || 'Failed';
            }
          }
        });
      });
    } catch (err) {
      const st = document.getElementById('staffStatus');
      if (st) {
        st.className = 'status show err';
        st.textContent = err.message || 'Could not load staff';
      }
    }
  }

  async function refreshFreeBot() {
    const status = document.getElementById('freeBotStatus');
    if (!status || me.role !== 'admin') return;
    try {
      const json = await api('/api/staff/free-bot');
      status.textContent =
        `HQ: ${json.mainGuildId} · trial ${json.trialDays}d · tracked active ${json.trackedActive}` +
        (json.control?.leaveAllRequestedAt &&
        (!json.control.leaveAllDoneAt || json.control.leaveAllDoneAt < json.control.leaveAllRequestedAt)
          ? ' · leave-all QUEUED (start free bot)'
          : json.control?.lastResult
            ? ` · last leave-all: left ${json.control.lastResult.left}`
            : '');
      if (json.trialDays) document.getElementById('freeTrialDays').value = json.trialDays;
      if (json.promo?.discordInvite) document.getElementById('freeDiscordInvite').value = json.promo.discordInvite;
      if (json.promo?.productUrl) document.getElementById('freeProductUrl').value = json.promo.productUrl;
    } catch (err) {
      status.textContent = err.message || 'Could not load free bot status';
    }
  }

  document.getElementById('freeBotRefresh')?.addEventListener('click', () => refreshFreeBot());

  document.getElementById('freeBotSave')?.addEventListener('click', async () => {
    const msg = document.getElementById('freeBotMsg');
    msg.className = 'status show';
    msg.textContent = 'Saving…';
    try {
      await api('/api/staff/free-bot/config', {
        method: 'POST',
        body: JSON.stringify({
          csrf,
          trialDays: Number(document.getElementById('freeTrialDays').value),
          discordInvite: document.getElementById('freeDiscordInvite').value.trim(),
          productUrl: document.getElementById('freeProductUrl').value.trim(),
        }),
      });
      msg.classList.add('ok');
      msg.textContent = 'Saved.';
      await refreshFreeBot();
    } catch (err) {
      msg.classList.add('err');
      msg.textContent = err.message || 'Failed';
    }
  });

  document.getElementById('freeBotLeaveAll')?.addEventListener('click', async () => {
    if (
      !confirm(
        'Queue leave-all for the FREE bot? It will leave every server except your HQ (1521568250473873438). The free bot process must be running.'
      )
    ) {
      return;
    }
    const msg = document.getElementById('freeBotMsg');
    msg.className = 'status show';
    msg.textContent = 'Queuing…';
    try {
      const json = await api('/api/staff/free-bot/leave-all', {
        method: 'POST',
        body: JSON.stringify({ csrf }),
      });
      msg.classList.add('ok');
      msg.textContent = json.message || 'Queued.';
      await refreshFreeBot();
    } catch (err) {
      msg.classList.add('err');
      msg.textContent = err.message || 'Failed';
    }
  });

  document.getElementById('paypalRefresh')?.addEventListener('click', () => refreshPaypalClaims());

  document.getElementById('staffAdd')?.addEventListener('click', async () => {
    const status = document.getElementById('staffStatus');
    status.className = 'status show';
    status.textContent = 'Creating…';
    try {
      await api('/api/chat/admin/staff', {
        method: 'POST',
        body: JSON.stringify({
          csrf,
          email: document.getElementById('newStaffEmail').value.trim(),
          name: document.getElementById('newStaffName').value.trim(),
          password: document.getElementById('newStaffPass').value,
          role: document.getElementById('newStaffRole').value,
        }),
      });
      document.getElementById('newStaffEmail').value = '';
      document.getElementById('newStaffName').value = '';
      document.getElementById('newStaffPass').value = '';
      status.classList.add('ok');
      status.textContent = 'Account created. Tell them their email + temp password.';
      await refreshStaffList();
    } catch (err) {
      status.classList.add('err');
      status.textContent = err.message || 'Failed';
    }
  });

  document.getElementById('adminLogin').addEventListener('click', async () => {
    const status = document.getElementById('loginStatus');
    status.className = 'status show';
    status.textContent = 'Checking…';
    try {
      const email = document.getElementById('adminEmail').value.trim();
      const password = document.getElementById('adminPass').value;
      const json = await api('/api/chat/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      csrf = json.csrf;
      me = {
        role: json.role || 'staff',
        staffName: json.staffName || 'Staff',
        staffEmail: json.staffEmail || email,
        staffId: json.staffId || '',
      };
      status.classList.add('ok');
      status.textContent = 'Logged in';
      await enterInbox();
    } catch (err) {
      status.classList.add('err');
      status.textContent = err.message || 'Unauthorized';
    }
  });

  document.getElementById('adminLogout')?.addEventListener('click', async () => {
    try {
      await api('/api/chat/admin/logout', { method: 'POST', body: JSON.stringify({ csrf }) });
    } catch {
      /* ignore */
    }
    location.reload();
  });

  document.getElementById('adminSend').addEventListener('click', async () => {
    const input = document.getElementById('adminInput');
    const text = input.value.trim();
    if (!text || !activeId) return;
    input.value = '';
    const json = await api(`/api/chat/admin/thread/${encodeURIComponent(activeId)}/message`, {
      method: 'POST',
      body: JSON.stringify({ text, csrf }),
    });
    renderMessages(json.thread);
    await refreshList();
  });

  document.getElementById('pwChange')?.addEventListener('click', async () => {
    const status = document.getElementById('pwStatus');
    status.className = 'status show';
    status.textContent = 'Updating…';
    try {
      await api('/api/chat/admin/password', {
        method: 'POST',
        body: JSON.stringify({
          csrf,
          currentPassword: document.getElementById('pwCurrent').value,
          newPassword: document.getElementById('pwNew').value,
        }),
      });
      status.classList.add('ok');
      status.textContent = 'Password updated. Log in again.';
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      status.classList.add('err');
      status.textContent = err.message || 'Failed';
    }
  });

  fetch('/api/chat/admin/bootstrap', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((json) => {
      const hint = document.getElementById('loginHint');
      if (hint && json.needsBootstrap && json.hint) hint.textContent = json.hint;
    })
    .catch(() => {});

  api('/api/chat/admin/session')
    .then(async (json) => {
      csrf = json.csrf;
      me = {
        role: json.role || 'staff',
        staffName: json.staffName || 'Staff',
        staffEmail: json.staffEmail || '',
        staffId: json.staffId || '',
      };
      await enterInbox();
    })
    .catch(() => {
      /* need login */
    });
})();
