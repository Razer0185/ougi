(function () {
  let csrf = '';
  let activeId = '';
  let timer = null;

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
    await refreshList();
    if (timer) clearInterval(timer);
    timer = setInterval(async () => {
      try {
        await refreshList();
        if (activeId) await openThread(activeId);
      } catch {
        /* session may have expired */
      }
    }, 2500);
  }

  document.getElementById('adminLogin').addEventListener('click', async () => {
    const status = document.getElementById('loginStatus');
    status.className = 'status show';
    status.textContent = 'Checking…';
    try {
      const password = document.getElementById('adminPass').value;
      const staffName = document.getElementById('staffName').value.trim() || 'Staff';
      const json = await api('/api/chat/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password, staffName }),
      });
      csrf = json.csrf;
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

  api('/api/chat/admin/session')
    .then(async (json) => {
      csrf = json.csrf;
      if (json.staffName) document.getElementById('staffName').value = json.staffName;
      await enterInbox();
    })
    .catch(() => {
      /* need login */
    });
})();
