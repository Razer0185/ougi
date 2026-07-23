(function () {
  let csrf = '';

  async function getCsrf() {
    const res = await fetch('/api/csrf', { credentials: 'same-origin' });
    const json = await res.json();
    if (!res.ok || !json.csrf) throw new Error('Security token unavailable');
    csrf = json.csrf;
    return csrf;
  }

  async function api(path, opts = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    };
    if (opts.csrf !== false) {
      if (!csrf) await getCsrf();
      headers['X-CSRF-Token'] = csrf;
    }

    const res = await fetch(path, {
      credentials: 'same-origin',
      ...opts,
      headers,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || 'Request failed');
    if (json.csrf) csrf = json.csrf;
    return json;
  }

  function renderMessages(box, thread, buyerName) {
    while (box.firstChild) box.removeChild(box.firstChild);
    (thread.messages || []).forEach((m) => {
      const bubble = document.createElement('div');
      bubble.className = `bubble ${m.from === 'staff' ? 'staff' : 'buyer'}`;
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = m.from === 'staff' ? m.name || 'Staff' : buyerName || m.name || 'You';
      bubble.appendChild(who);
      bubble.appendChild(document.createTextNode(m.text || ''));
      box.appendChild(bubble);
    });
    box.scrollTop = box.scrollHeight;
  }

  function buildShell(root, discordInvite) {
    while (root.firstChild) root.removeChild(root.firstChild);
    const box = document.createElement('div');
    box.className = 'chat-box';

    const head = document.createElement('div');
    head.className = 'chat-head';
    const titleWrap = document.createElement('div');
    const h3 = document.createElement('h3');
    h3.textContent = 'Live support';
    const sub = document.createElement('span');
    sub.id = 'chatSub';
    sub.textContent = 'Chat with staff securely';
    titleWrap.appendChild(h3);
    titleWrap.appendChild(sub);
    const disc = document.createElement('a');
    disc.className = 'btn tiny ghost';
    disc.href = discordInvite;
    disc.target = '_blank';
    disc.rel = 'noopener noreferrer';
    disc.textContent = 'Discord';
    head.appendChild(titleWrap);
    head.appendChild(disc);

    const login = document.createElement('div');
    login.className = 'chat-login';
    login.id = 'chatLogin';
    const note = document.createElement('p');
    note.className = 'note';
    note.style.margin = '0';
    note.textContent = 'Sign in to your Ougi account to open support chat.';
    const link = document.createElement('a');
    link.className = 'btn primary';
    link.href = 'account.html?next=' + encodeURIComponent(location.pathname.split('/').pop() || 'receipt.html');
    link.textContent = 'Sign in / create account';
    login.appendChild(note);
    login.appendChild(link);

    const messages = document.createElement('div');
    messages.className = 'chat-messages';
    messages.id = 'chatMessages';
    messages.hidden = true;

    const compose = document.createElement('div');
    compose.className = 'chat-compose';
    compose.id = 'chatCompose';
    compose.hidden = true;
    const chatInput = document.createElement('input');
    chatInput.id = 'chatInput';
    chatInput.maxLength = 1000;
    chatInput.placeholder = 'Write a message…';
    chatInput.autocomplete = 'off';
    const sendBtn = document.createElement('button');
    sendBtn.className = 'btn primary tiny';
    sendBtn.type = 'button';
    sendBtn.id = 'chatSend';
    sendBtn.textContent = 'Send';
    compose.appendChild(chatInput);
    compose.appendChild(sendBtn);

    const offline = document.createElement('div');
    offline.className = 'chat-offline';
    offline.id = 'chatOffline';
    offline.hidden = true;

    box.appendChild(head);
    box.appendChild(login);
    box.appendChild(messages);
    box.appendChild(compose);
    box.appendChild(offline);
    root.appendChild(box);
  }

  window.mountOugiChat = function (root, options = {}) {
    if (!root) return;
    const discordInvite =
      (window.OUGI_SITE && window.OUGI_SITE.discordInvite) || 'https://discord.gg/DgGNBzXCcq';
    const order = options.order || null;
    const autoOpen = options.autoOpen !== false;

    try {
      localStorage.removeItem('ougi-chat-thread');
      localStorage.removeItem('ougi-chat-buyer-token');
    } catch {
      /* storage may be blocked */
    }

    buildShell(root, discordInvite);

    const login = root.querySelector('#chatLogin');
    const messages = root.querySelector('#chatMessages');
    const compose = root.querySelector('#chatCompose');
    const offline = root.querySelector('#chatOffline');
    const sub = root.querySelector('#chatSub');
    let threadId = '';
    let buyerName = '';
    let timer = null;

    function showOffline(err) {
      login.hidden = true;
      messages.hidden = true;
      compose.hidden = true;
      offline.hidden = false;
      while (offline.firstChild) offline.removeChild(offline.firstChild);
      offline.appendChild(
        document.createTextNode('Live chat needs the website server (run ')
      );
      const code = document.createElement('code');
      code.textContent = 'npm run site';
      offline.appendChild(code);
      offline.appendChild(document.createTextNode(').'));
      offline.appendChild(document.createElement('br'));
      offline.appendChild(document.createElement('br'));
      const a = document.createElement('a');
      a.className = 'btn primary';
      a.href = discordInvite;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'Join support Discord';
      offline.appendChild(a);
      if (err?.message) {
        const p = document.createElement('p');
        p.className = 'note';
        p.textContent = err.message;
        offline.appendChild(p);
      }
    }

    function showThread(thread) {
      threadId = thread.id;
      buyerName = thread.buyerName;
      login.hidden = true;
      offline.hidden = true;
      messages.hidden = false;
      compose.hidden = false;
      sub.textContent = `Chatting as ${buyerName}`;
      renderMessages(messages, thread, buyerName);
      if (timer) clearInterval(timer);
      timer = setInterval(poll, 2500);
    }

    async function poll() {
      if (!threadId) return;
      try {
        const json = await api(`/api/chat/thread/${encodeURIComponent(threadId)}`, { csrf: false });
        renderMessages(messages, json.thread, buyerName || json.thread.buyerName);
      } catch {
        /* brief network blips */
      }
    }

    async function send() {
      const input = root.querySelector('#chatInput');
      const text = input.value.trim();
      if (!text || !threadId) return;
      input.value = '';
      try {
        await getCsrf();
        const json = await api(`/api/chat/thread/${encodeURIComponent(threadId)}/message`, {
          method: 'POST',
          body: JSON.stringify({ text, csrf }),
        });
        renderMessages(messages, json.thread, buyerName);
      } catch (err) {
        ougiToast(err.message || 'Send failed');
      }
    }

    root.querySelector('#chatSend').onclick = send;
    root.querySelector('#chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send();
    });

    async function boot() {
      try {
        // Prefer existing thread (cookies or account)
        try {
          const cur = await api('/api/chat/current', { csrf: false });
          showThread(cur.thread);
          return;
        } catch {
          /* none yet */
        }

        if (!autoOpen) return;

        // Logged-in account → open/ensure support thread (especially after payment)
        const me = await fetch('/api/account/me', { credentials: 'same-origin' }).then((r) =>
          r.ok ? r.json() : null
        );
        if (!me?.ok) {
          login.hidden = false;
          return;
        }
        await getCsrf();
        const ens = await api('/api/chat/ensure', {
          method: 'POST',
          body: JSON.stringify({ csrf, order }),
        });
        showThread(ens.thread);
      } catch (err) {
        if (String(err.message || '').toLowerCase().includes('login')) {
          login.hidden = false;
          return;
        }
        showOffline(err);
      }
    }

    boot();
  };
})();
