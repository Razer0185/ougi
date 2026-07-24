(function () {
  const gate = document.getElementById('dashGate');
  const app = document.getElementById('dashApp');
  let csrf = '';
  let config = null;
  let guildId = null;
  let subscription = null;

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(key, msg, ok) {
    const el = document.querySelector(`[data-status="${key}"]`);
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = ok === false ? 'var(--danger)' : ok ? 'var(--ok)' : '';
  }

  function showGate(title, text, primaryHref, primaryLabel, showHost) {
    gate.hidden = false;
    app.hidden = true;
    $('gateTitle').textContent = title;
    $('gateText').textContent = text;
    const primary = $('gatePrimary');
    primary.href = primaryHref;
    primary.textContent = primaryLabel;
    $('gateSecondary').hidden = !showHost;
  }

  function actionLabel(a) {
    if (a === 'kick') return 'Kick joiners';
    if (a === 'none') return 'Detect only';
    return 'Lock server';
  }

  function updatePreview() {
    const joins = Number($('arJoins')?.value) || 8;
    const action = $('arAction')?.value || 'lock';
    const lockdown = !!config?.antiraid?.lockdown;
    $('pvJoins').textContent = String(joins);
    $('pvThresh').textContent = String(joins);
    $('pvAction').textContent = actionLabel(action);
    $('pvStatus').textContent = lockdown ? 'Lockdown enabled' : 'Ready';
    $('pvStatus').classList.toggle('accent', lockdown || action === 'lock');

    const chip = $('lockdownChip');
    if (chip) {
      chip.innerHTML = lockdown
        ? '<span class="dot on"></span> Lockdown: on'
        : '<span class="dot"></span> Lockdown: off';
      chip.classList.toggle('warn', lockdown);
    }
  }

  function fillForm(cfg) {
    config = cfg;
    $('amEnabled').checked = !!cfg.automod.enabled;
    $('amSpam').checked = !!cfg.automod.antiSpam;
    $('amInvites').checked = !!cfg.automod.antiInvite;
    $('amLinks').checked = !!cfg.automod.antiLinks;
    $('amMentions').value = cfg.automod.maxMentions;
    $('arEnabled').checked = !!cfg.antiraid.enabled;
    $('arJoins').value = cfg.antiraid.joinsPerMinute;
    $('arAction').value = cfg.antiraid.action;
    $('arExempt').value = (cfg.antiraid.exemptRoleIds || []).join(', ');

    $('lvEnabled').checked = !!cfg.levels.enabled;
    $('lvVoice').checked = !!cfg.levels.voiceXpEnabled;
    $('lvVoiceRate').value = cfg.levels.voiceXpPerMinute;
    $('lvAnnounce').value = cfg.levels.announceChannelId || '';

    $('wEnabled').checked = !!cfg.welcome.enabled;
    $('wCard').checked = !!cfg.welcome.card;
    $('wChannel').value = cfg.welcome.channelId || '';
    $('wMessage').value = cfg.welcome.message || '';
    $('gEnabled').checked = !!cfg.goodbye.enabled;
    $('gChannel').value = cfg.goodbye.channelId || '';
    $('gMessage').value = cfg.goodbye.message || '';

    $('sgEnabled').checked = !!cfg.suggestions.enabled;
    $('sgChannel').value = cfg.suggestions.channelId || '';

    $('logEnabled').checked = !!cfg.logging.enabled;
    $('logChannel').value = cfg.logging.channelId || '';
    $('sbEnabled').checked = !!cfg.starboard.enabled;
    $('sbChannel').value = cfg.starboard.channelId || '';
    $('sbThreshold').value = cfg.starboard.threshold;

    $('cfgPrefix').value = cfg.prefix || '.';
    $('cfgTheme').value = cfg.theme || 'blue';

    $('ovPlan').textContent = subscription?.planName || '—';
    $('ovPrefix').textContent = cfg.prefix || '.';
    $('ovTheme').textContent = cfg.theme || 'blue';
    $('ovRaid').textContent = cfg.antiraid.enabled
      ? `${cfg.antiraid.joinsPerMinute}/min · ${cfg.antiraid.action}`
      : 'Off';

    updatePreview();
  }

  function showSection(id) {
    document.querySelectorAll('.dash-nav-item').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.section === id);
    });
    document.querySelectorAll('.dash-panel').forEach((panel) => {
      panel.hidden = panel.dataset.panel !== id;
    });
    const preview = $('dashPreview');
    if (preview) preview.hidden = id !== 'automod' && id !== 'overview';
    if (id === 'automod' || id === 'overview') updatePreview();
  }

  async function save(section) {
    setStatus(section, 'Saving…');
    let patch = {};
    if (section === 'automod') {
      patch = {
        automod: {
          enabled: $('amEnabled').checked,
          antiSpam: $('amSpam').checked,
          antiInvite: $('amInvites').checked,
          antiLinks: $('amLinks').checked,
          maxMentions: Number($('amMentions').value),
        },
        antiraid: {
          enabled: $('arEnabled').checked,
          joinsPerMinute: Number($('arJoins').value),
          action: $('arAction').value,
          exemptRoleIds: $('arExempt').value,
        },
      };
    } else if (section === 'levels') {
      patch = {
        levels: {
          enabled: $('lvEnabled').checked,
          voiceXpEnabled: $('lvVoice').checked,
          voiceXpPerMinute: Number($('lvVoiceRate').value),
          announceChannelId: $('lvAnnounce').value.trim() || null,
        },
      };
    } else if (section === 'welcome') {
      patch = {
        welcome: {
          enabled: $('wEnabled').checked,
          card: $('wCard').checked,
          channelId: $('wChannel').value.trim() || null,
          message: $('wMessage').value,
        },
        goodbye: {
          enabled: $('gEnabled').checked,
          channelId: $('gChannel').value.trim() || null,
          message: $('gMessage').value,
        },
      };
    } else if (section === 'suggestions') {
      patch = {
        suggestions: {
          enabled: $('sgEnabled').checked,
          channelId: $('sgChannel').value.trim() || null,
        },
      };
    } else if (section === 'logging') {
      patch = {
        logging: {
          enabled: $('logEnabled').checked,
          channelId: $('logChannel').value.trim() || null,
        },
        starboard: {
          enabled: $('sbEnabled').checked,
          channelId: $('sbChannel').value.trim() || null,
          threshold: Number($('sbThreshold').value),
        },
      };
    } else if (section === 'theme') {
      patch = {
        prefix: $('cfgPrefix').value.trim(),
        theme: $('cfgTheme').value,
      };
    }

    try {
      const res = await fetch('/api/dashboard/config', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ csrf, patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(section, data.message || 'Save failed', false);
        return;
      }
      if (data.config) fillForm(data.config);
      setStatus(section, 'Saved — live on Discord.', true);
    } catch {
      setStatus(section, 'Network error', false);
    }
  }

  async function boot() {
    const hash = (location.hash || '').replace(/^#/, '');
    const start = hash || 'automod';

    let res;
    try {
      res = await fetch('/api/dashboard/config', { credentials: 'same-origin' });
    } catch {
      showGate('Offline', 'Could not reach the Ougi site API.', 'dashboard.html', 'Retry', false);
      return;
    }

    if (res.status === 401) {
      showGate(
        'Sign in required',
        'Log in with the same account you use for Host and checkout.',
        'account.html?next=dashboard.html',
        'Log in',
        false
      );
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (data.csrf) csrf = data.csrf;

    if (res.status === 403 || data.needActivate) {
      showGate(
        'Link a server first',
        data.message || 'Activate your Discord server on Host, then come back.',
        'host.html',
        'Open Host',
        false
      );
      return;
    }

    if (!res.ok || !data.config) {
      showGate('Error', data.message || 'Could not load config.', 'host.html', 'Host', true);
      return;
    }

    gate.hidden = true;
    app.hidden = false;
    guildId = data.guildId;
    subscription = data.subscription;
    $('guildIdLabel').textContent = guildId;
    fillForm(data.config);
    showSection(
      ['overview', 'moderation', 'automod', 'levels', 'welcome', 'suggestions', 'schedules', 'roles', 'templates', 'logging', 'custom', 'ai', 'theme'].includes(start)
        ? start
        : 'automod'
    );
  }

  document.getElementById('dashNav')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-section]');
    if (!btn) return;
    const id = btn.dataset.section;
    showSection(id);
    history.replaceState(null, '', `#${id}`);
  });

  document.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', () => save(btn.dataset.save));
  });

  ['arJoins', 'arAction', 'arEnabled'].forEach((id) => {
    $(id)?.addEventListener('input', updatePreview);
    $(id)?.addEventListener('change', updatePreview);
  });

  boot();
})();
