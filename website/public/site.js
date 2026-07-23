(function () {
  const path = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  document.querySelectorAll('.topbar nav a').forEach((a) => {
    const href = (a.getAttribute('href') || '').toLowerCase();
    if (href === path) a.classList.add('on');
  });

  window.ougiToast = function (msg) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(window.__ougiToastTimer);
    window.__ougiToastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  };

  window.ougiCopy = async function (text) {
    try {
      await navigator.clipboard.writeText(text);
      ougiToast('Copied');
    } catch {
      ougiToast(text);
    }
  };

  window.ougiSendForm = async function (payload, subject) {
    const cfg = window.OUGI_SITE || {};
    try {
      let csrf = payload.csrf;
      if (!csrf) {
        const r = await fetch('/api/csrf', { credentials: 'same-origin' });
        const j = await r.json();
        csrf = j.csrf;
      }
      const res = await fetch('/api/access/request', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' },
        body: JSON.stringify({ ...payload, csrf }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.ok) return { ok: true, local: true };
        return { ok: false, message: json.message || 'Request failed' };
      }
    } catch {
      /* FormSubmit fallback */
    }

    const email = String(cfg.notifyEmail || '').trim();
    if (!email || email.includes('YOUR_EMAIL')) {
      return { ok: false, message: 'Set notifyEmail in config.js' };
    }

    const body = new FormData();
    Object.entries(payload).forEach(([k, v]) => {
      if (k === 'csrf' || k === 'password') return;
      body.set(k, v == null ? '' : String(v));
    });
    body.set('_subject', subject || 'Ougi website');
    body.set('_template', 'table');
    body.set('_captcha', 'false');

    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(email)}`, {
      method: 'POST',
      body,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return { ok: false, message: json.message || 'Could not send' };
    }
    return { ok: true };
  };
})();
