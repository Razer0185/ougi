(function () {
  const params = new URLSearchParams(location.search);
  const next = params.get('next') || 'pay.html';
  let csrf = '';
  let mode = 'login';
  let signedInUser = null;
  let googleCfg = { google: false, clientId: null, redirect: false };
  let googleReady = false;

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
    if (opts.method && opts.method !== 'GET') {
      if (!csrf) await getCsrf();
      headers['X-CSRF-Token'] = csrf;
    }
    const res = await fetch(path, { credentials: 'same-origin', ...opts, headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || 'Request failed');
    if (json.csrf) csrf = json.csrf;
    return json;
  }

  function setMode(nextMode) {
    mode = nextMode === 'signup' ? 'signup' : 'login';
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const title = document.getElementById('authTitle');
    const prompt = document.getElementById('switchPrompt');
    const switchBtn = document.getElementById('switchMode');
    const heading = document.getElementById('pageHeading');
    const isSignup = mode === 'signup';
    loginForm.hidden = isSignup;
    registerForm.hidden = !isSignup;
    title.textContent = isSignup ? 'Sign up' : 'Log in';
    heading.textContent = isSignup ? 'Sign up' : 'Log in';
    prompt.textContent = isSignup ? 'Already have an account?' : 'Don’t have an account?';
    switchBtn.textContent = isSignup ? 'Log in' : 'Sign up';
    document.getElementById('loginStatus').className = 'status';
    document.getElementById('registerStatus').className = 'status';
  }

  function showAuthErrors() {
    const code = params.get('authError');
    if (!code) return;
    const el = document.getElementById('authError');
    const messages = {
      google_off:
        'Add GOOGLE_CLIENT_ID to your .env (Google Cloud → OAuth client), then restart the site.',
      google_start: 'Could not start Google sign-in.',
      google_denied: 'Google sign-in was cancelled.',
      google_state: 'Google sign-in expired. Try again.',
      google_fail: 'Google sign-in failed. Try again or use email.',
    };
    el.hidden = false;
    el.textContent = messages[code] || 'Sign-in failed.';
  }

  function afterLogin(user) {
    if (next && next !== 'account.html') {
      location.href = next.includes('.html') ? next : 'pay.html';
      return;
    }
    showAccount(user);
  }

  function showAccount(user) {
    signedInUser = user;
    document.getElementById('authGate').hidden = true;
    document.getElementById('accountPanel').hidden = false;
    document.getElementById('pageHeading').textContent = 'Account';
    document.getElementById('pageSub').textContent = 'You’re signed in.';
    document.getElementById('meName').textContent = user.name;
    document.getElementById('meEmail').textContent = user.email;
    document.getElementById('meDiscord').textContent = user.discord;
    document.getElementById('meAuth').textContent =
      user.authProvider === 'google' ? 'Google' : 'Email / password';
    document.getElementById('goPay').href = next.includes('.html') ? next : 'pay.html';
    const usePassword = Boolean(user.hasPassword);
    document.getElementById('deletePasswordWrap').hidden = !usePassword;
    document.getElementById('deleteConfirmWrap').hidden = usePassword;
  }

  function showAuthGate() {
    document.getElementById('authGate').hidden = false;
    document.getElementById('accountPanel').hidden = true;
    setMode(params.get('mode') === 'signup' ? 'signup' : 'login');
    showAuthErrors();
  }

  async function finishGoogleCredential(credential) {
    await getCsrf();
    const json = await api('/api/account/google', {
      method: 'POST',
      body: JSON.stringify({ csrf, credential }),
    });
    afterLogin(json.user);
  }

  function waitForGoogle(cb, tries) {
    if (window.google?.accounts?.id) {
      cb();
      return;
    }
    if (tries <= 0) return;
    setTimeout(() => waitForGoogle(cb, tries - 1), 100);
  }

  function initGoogleButton() {
    const wrap = document.getElementById('googleBtnWrap');
    const btn = document.getElementById('googleBtn');
    const hint = document.getElementById('googleHint');

    function redirectFallback() {
      if (!googleCfg.redirect) {
        hint.hidden = false;
        hint.textContent =
          'Google popup unavailable. Add GOOGLE_CLIENT_SECRET to .env for redirect sign-in, or allow Google scripts.';
        return;
      }
      const nextSafe = encodeURIComponent(next.includes('.html') ? next : 'pay.html');
      location.href = `/api/account/google/start?next=${nextSafe}`;
    }

    btn.addEventListener('click', () => {
      if (!googleCfg.google || !googleCfg.clientId) {
        hint.hidden = false;
        hint.textContent =
          'Add GOOGLE_CLIENT_ID to your project .env, then restart the site (npm run site).';
        return;
      }
      redirectFallback();
    });

    if (!googleCfg.google || !googleCfg.clientId) {
      hint.hidden = false;
      hint.textContent = 'Google sign-in needs GOOGLE_CLIENT_ID in .env — email login still works.';
      return;
    }

    waitForGoogle(() => {
      window.google.accounts.id.initialize({
        client_id: googleCfg.clientId,
        callback: async (response) => {
          try {
            hint.hidden = true;
            await finishGoogleCredential(response.credential);
          } catch (err) {
            hint.hidden = false;
            hint.classList.add('err');
            hint.textContent = err.message || 'Google sign-in failed';
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
        context: mode === 'signup' ? 'signup' : 'signin',
        ux_mode: 'popup',
      });

      // Official Google button (reliable click → account picker → ID token)
      wrap.innerHTML = '';
      const host = document.createElement('div');
      host.className = 'google-official';
      wrap.appendChild(host);
      window.google.accounts.id.renderButton(host, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: 360,
      });
      googleReady = true;
      hint.hidden = true;
    }, 50);
  }

  document.getElementById('switchMode').addEventListener('click', () => {
    setMode(mode === 'login' ? 'signup' : 'login');
  });

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('loginStatus');
    status.className = 'status show';
    status.textContent = 'Signing in…';
    const data = Object.fromEntries(new FormData(e.target).entries());
    try {
      await getCsrf();
      const json = await api('/api/account/login', {
        method: 'POST',
        body: JSON.stringify({ ...data, csrf }),
      });
      status.classList.add('ok');
      status.textContent = 'Logged in';
      afterLogin(json.user);
    } catch (err) {
      status.classList.add('err');
      status.textContent = err.message || 'Login failed';
    }
  });

  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('registerStatus');
    status.className = 'status show';
    status.textContent = 'Creating account…';
    const data = Object.fromEntries(new FormData(e.target).entries());
    try {
      await getCsrf();
      const json = await api('/api/account/register', {
        method: 'POST',
        body: JSON.stringify({ ...data, csrf }),
      });
      status.classList.add('ok');
      status.textContent = 'Account created';
      afterLogin(json.user);
    } catch (err) {
      status.classList.add('err');
      status.textContent = err.message || 'Could not create account';
    }
  });

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    try {
      await api('/api/account/logout', { method: 'POST', body: JSON.stringify({ csrf }) });
    } catch {
      /* ignore */
    }
    location.href = 'account.html';
  });

  document.getElementById('exportBtn')?.addEventListener('click', async () => {
    try {
      const json = await api('/api/account/export');
      const blob = new Blob([JSON.stringify(json.data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ougi-account-export.json';
      a.click();
    } catch (err) {
      ougiToast(err.message || 'Export failed');
    }
  });

  document.getElementById('deleteBtn')?.addEventListener('click', async () => {
    const status = document.getElementById('deleteStatus');
    status.className = 'status show';
    try {
      const payload = { csrf };
      if (signedInUser?.hasPassword) {
        payload.password = document.getElementById('deletePass').value;
      } else {
        payload.confirmDelete = document.getElementById('deleteConfirm').value;
      }
      await api('/api/account/delete', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      location.href = 'account.html';
    } catch (err) {
      status.classList.add('err');
      status.textContent = err.message || 'Delete failed';
    }
  });

  Promise.all([
    api('/api/account/me').then((json) => ({ user: json.user })).catch(() => null),
    fetch('/api/account/auth-config', { credentials: 'same-origin' })
      .then((r) => r.json())
      .catch(() => ({})),
  ]).then(([me, cfg]) => {
    googleCfg = {
      google: Boolean(cfg.google),
      clientId: cfg.clientId || null,
      redirect: Boolean(cfg.redirect),
    };
    if (me?.user) {
      showAccount(me.user);
      return;
    }
    showAuthGate();
    initGoogleButton();
  });
})();
