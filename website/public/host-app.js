(function () {
  const API = '';
  let csrf = '';
  let mode = 'signin';
  let subscription = null;
  let user = null;
  let botRunning = false;

  const $ = (id) => document.getElementById(id);
  const isDesktop = !!(window.chrome && window.chrome.webview);

  function log(msg, where) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
    const targets =
      where === 'auth'
        ? [$('logAuth')]
        : where === 'dash'
          ? [$('logDash')]
          : [$('logAuth'), $('logDash')].filter(Boolean);
    targets.forEach((el) => {
      if (!el) return;
      el.textContent += line;
      el.scrollTop = el.scrollHeight;
    });
  }

  function showError(el, msg) {
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function setChip(text, kind) {
    const chip = $('statusChip');
    chip.textContent = text;
    chip.className = 'chip' + (kind ? ' ' + kind : '');
  }

  async function api(path, opts = {}) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(opts.headers || {}),
    };
    if (csrf && opts.method && opts.method !== 'GET') {
      headers['X-CSRF-Token'] = csrf;
    }
    const res = await fetch(API + path, {
      credentials: 'same-origin',
      ...opts,
      headers,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || `Request failed (${res.status})`);
    if (json.csrf) csrf = json.csrf;
    return json;
  }

  async function refreshCsrf() {
    const json = await api('/api/csrf');
    csrf = json.csrf || '';
    return csrf;
  }

  function setMode(next) {
    mode = next;
    const signup = mode === 'signup';
    $('tabSignIn').classList.toggle('on', !signup);
    $('tabSignUp').classList.toggle('on', signup);
    $('authTitle').textContent = signup ? 'Sign up' : 'Sign in';
    $('authSub').textContent = signup
      ? 'Creates the same Ougi website account used for checkout.'
      : 'Same account as the Ougi website.';
    $('authSubmit').textContent = signup ? 'Sign up' : 'Sign in';
    $('authSwitch').textContent = signup ? 'Already have an account? Sign in' : 'Create account';
    $('signupExtra').hidden = !signup;
    $('signinExtras').hidden = signup;
    $('passHint').hidden = !signup;
    $('displayName').required = signup;
    $('discord').required = signup;
    showError($('authError'), null);
  }

  function showAuth() {
    $('viewAuth').hidden = false;
    $('viewDash').hidden = true;
  }

  function showDash() {
    $('viewAuth').hidden = true;
    $('viewDash').hidden = false;
    renderPlan();
  }

  function renderPlan() {
    $('whoLabel').textContent = user
      ? `${user.discord || user.name || ''} · ${user.email || ''}`
      : 'Signed in';

    if (!subscription) {
      $('planName').textContent = 'No active plan';
      $('planMeta').textContent = 'Buy a License plan to run the bot on this PC — or use Dev grant while testing.';
      $('planMode').textContent = '—';
      $('planStatus').textContent = 'none';
      $('planExpires').textContent = '—';
      setChip(botRunning ? 'Bot running' : 'No plan', botRunning ? 'run' : 'bad');
      return;
    }

    const s = subscription;
    $('planName').textContent = s.planName || 'Plan';
    $('planMode').textContent = (s.hostMode || '—').toUpperCase();
    $('planStatus').textContent = s.status || '—';
    let exp = 'never';
    if (s.expiresAt) {
      const d = new Date(s.expiresAt);
      exp = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }
    $('planExpires').textContent = exp;
    $('planMeta').textContent = s.canPcHost
      ? 'PC Host ready — paste your Discord bot token and start.'
      : 'Cloud / inactive for PC — buy a License plan for local hosting.';

    if (botRunning) setChip('Bot running', 'run');
    else if (s.canPcHost) setChip('PC ready', 'ok');
    else setChip(s.status || 'No plan', 'bad');
  }

  function postDesktop(msg) {
    if (!isDesktop) {
      throw new Error('Open this page from OugiHost.exe to start the PC bot.');
    }
    window.chrome.webview.postMessage(JSON.stringify(msg));
  }

  async function loadStatus() {
    const json = await api('/api/host/status');
    user = json.user || user;
    subscription = json.subscription || null;
    renderPlan();
    return json;
  }

  async function trySession() {
    try {
      const json = await api('/api/account/me');
      user = json.user;
      await loadStatus();
      showDash();
      log('Session restored.', 'dash');
      return true;
    } catch {
      return false;
    }
  }

  async function onAuthSubmit(e) {
    e.preventDefault();
    showError($('authError'), null);
    const email = $('email').value.trim();
    const password = $('password').value;
    try {
      await refreshCsrf();
      if (mode === 'signup') {
        const name = $('displayName').value.trim();
        const discord = $('discord').value.trim();
        if (password.length < 12) throw new Error('Password must be at least 12 characters.');
        if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
          throw new Error('Password must include letters and numbers.');
        }
        log('Creating account…', 'auth');
        const json = await api('/api/account/register', {
          method: 'POST',
          body: JSON.stringify({ csrf, email, password, name, discord }),
        });
        user = json.user;
        log('Account created.', 'auth');
      } else {
        log('Signing in…', 'auth');
        const json = await api('/api/app/login', {
          method: 'POST',
          body: JSON.stringify({ csrf, email, password }),
        });
        user = json.user;
        subscription = json.subscription || null;
        log('Signed in.', 'auth');
      }
      if ($('rememberMe').checked) localStorage.setItem('ougi_host_email', email);
      else localStorage.removeItem('ougi_host_email');
      await loadStatus();
      showDash();
      log('Welcome' + (user?.discord ? `, ${user.discord}` : '') + '.', 'dash');
    } catch (err) {
      showError($('authError'), err.message || 'Auth failed');
      log(err.message || 'Auth failed', 'auth');
    }
  }

  async function startBot() {
    showError($('dashError'), null);
    try {
      await loadStatus();
      if (!subscription?.canPcHost) {
        throw new Error('Need an active License (PC Host) plan. Buy one or use Dev grant.');
      }
      const token = $('botToken').value.trim();
      if (token.length < 50) throw new Error('Paste your Discord bot token from the Developer Portal.');

      log('Requesting license ticket…', 'dash');
      const ticket = await api('/api/license/pc-ticket', {
        method: 'POST',
        body: JSON.stringify({ csrf, machineId: navigator.userAgent.slice(0, 80) }),
      });
      localStorage.setItem('ougi_host_token_len', String(token.length));
      postDesktop({ type: 'start', discordToken: token, licenseToken: ticket.token });
      botRunning = true;
      renderPlan();
      log('Start signal sent to Ougi Host.', 'dash');
    } catch (err) {
      showError($('dashError'), err.message || 'Could not start');
      log(err.message || 'Start failed', 'dash');
    }
  }

  function stopBot() {
    try {
      postDesktop({ type: 'stop' });
      botRunning = false;
      renderPlan();
      log('Stop signal sent.', 'dash');
    } catch (err) {
      showError($('dashError'), err.message);
    }
  }

  async function grantDev() {
    showError($('dashError'), null);
    try {
      await api('/api/host/grant-dev', {
        method: 'POST',
        body: JSON.stringify({ csrf, planId: 'pc' }),
      });
      await loadStatus();
      log('Granted PC month (dev).', 'dash');
    } catch (err) {
      showError($('dashError'), err.message || 'Grant failed');
      log(err.message || 'Grant failed', 'dash');
    }
  }

  async function logout() {
    try {
      await api('/api/account/logout', { method: 'POST', body: JSON.stringify({ csrf }) });
    } catch {
      /* ignore */
    }
    try { postDesktop({ type: 'stop' }); } catch { /* ignore */ }
    botRunning = false;
    user = null;
    subscription = null;
    csrf = '';
    $('password').value = '';
    showAuth();
    log('Logged out.', 'auth');
  }

  function wireDesktopChrome() {
    document.body.classList.add('desktop');
    const bar = $('titlebar');
    bar.hidden = false;

    const drag = $('titlebarDrag');
    drag.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      // Ignore if clicking a control that somehow nested here
      if (e.target.closest('.win-btn')) return;
      postDesktop({ type: 'window', action: 'drag' });
    });
    drag.addEventListener('dblclick', () => {
      postDesktop({ type: 'window', action: 'maximize' });
    });

    $('btnWinMin').onclick = () => postDesktop({ type: 'window', action: 'minimize' });
    $('btnWinMax').onclick = () => postDesktop({ type: 'window', action: 'maximize' });
    $('btnWinClose').onclick = () => postDesktop({ type: 'window', action: 'close' });
  }

  // Desktop → UI log bridge
  if (isDesktop) {
    wireDesktopChrome();
    window.chrome.webview.addEventListener('message', (ev) => {
      let data = ev.data;
      try {
        if (typeof data === 'string') data = JSON.parse(data);
      } catch {
        data = { type: 'log', text: String(ev.data) };
      }
      if (data.type === 'log') log(data.text || '', 'dash');
      if (data.type === 'site') {
        $('siteChip').textContent = data.text || '';
        log(data.text || '', 'auth');
      }
      if (data.type === 'bot') {
        botRunning = !!data.running;
        renderPlan();
      }
      if (data.type === 'window') {
        const maxBtn = $('btnWinMax');
        if (maxBtn) {
          maxBtn.textContent = data.maximized ? '❐' : '□';
          maxBtn.title = data.maximized ? 'Restore' : 'Maximize';
          maxBtn.setAttribute('aria-label', maxBtn.title);
        }
      }
    });
    postDesktop({ type: 'ready' });
  } else {
    $('siteChip').textContent = 'Browser preview · use OugiHost.exe for Start bot';
  }

  $('tabSignIn').onclick = () => setMode('signin');
  $('tabSignUp').onclick = () => setMode('signup');
  $('authSwitch').onclick = () => setMode(mode === 'signin' ? 'signup' : 'signin');
  $('authForm').onsubmit = onAuthSubmit;
  $('btnStart').onclick = startBot;
  $('btnStop').onclick = stopBot;
  $('btnGrant').onclick = grantDev;
  $('btnLogout').onclick = logout;
  $('clearLogAuth').onclick = () => { $('logAuth').textContent = ''; };
  $('clearLogDash').onclick = () => { $('logDash').textContent = ''; };
  $('togglePass').onclick = () => {
    const i = $('password');
    i.type = i.type === 'password' ? 'text' : 'password';
  };
  $('toggleToken').onclick = () => {
    const i = $('botToken');
    i.type = i.type === 'password' ? 'text' : 'password';
  };

  const saved = localStorage.getItem('ougi_host_email');
  if (saved) $('email').value = saved;

  setMode('signin');
  log('Ougi Host ready.', 'auth');
  trySession().then((ok) => {
    if (!ok) log('Sign in to continue.', 'auth');
  });
})();
