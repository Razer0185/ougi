(function () {
  const cfg = window.OUGI_SITE || {};
  const invite = cfg.discordInvite || 'https://discord.gg/AMaPQfQXGb';
  const discordLink = document.getElementById('discordLink');
  const navDiscord = document.getElementById('navDiscord');
  if (discordLink) discordLink.href = invite;
  if (navDiscord) navDiscord.href = invite;

  const raw = sessionStorage.getItem('ougi-receipt');
  let receipt = null;
  try {
    receipt = raw ? JSON.parse(raw) : null;
  } catch {
    receipt = null;
  }
  const q = new URLSearchParams(location.search);
  if (!receipt) {
    receipt = {
      orderId: q.get('order') || '—',
      planId: q.get('planId') || '',
      planName: q.get('plan') || '—',
      amount: q.get('amount') || '—',
      method: q.get('method') || (q.get('paid') === '1' ? 'Card (Stripe)' : '—'),
      buyer: q.get('buyer') || '—',
    };
  }

  function planMeta(planId) {
    const p = (cfg.plans || []).find((x) => x.id === planId);
    return p || null;
  }

  function isPcLicense(receipt) {
    const id = String(receipt.planId || '').toLowerCase();
    if (id === 'pc' || id === 'pc-lifetime') return true;
    const p = planMeta(receipt.planId);
    if (p?.hostMode === 'pc') return true;
    const name = String(receipt.planName || '').toLowerCase();
    return name.includes('license') || name.includes('pc host');
  }

  function money(n) {
    if (typeof n === 'number' && !Number.isNaN(n)) {
      return `$${n.toFixed(2).replace(/\.00$/, '')}`;
    }
    const s = String(n || '—');
    if (/^\$/.test(s)) return s;
    const num = Number(s);
    if (!Number.isNaN(num) && s.trim() !== '') {
      return `$${num.toFixed(2).replace(/\.00$/, '')}`;
    }
    return s || '—';
  }

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  function paintSteps() {
    const ol = document.getElementById('receiptSteps');
    const sub = document.getElementById('receiptSub');
    const next = document.getElementById('nextAction');
    const kicker = document.getElementById('receiptKicker');
    if (!ol) return;

    const pc = isPcLicense(receipt);
    if (kicker) kicker.textContent = pc ? 'License paid' : 'Hosting paid';

    const steps = pc
      ? [
          {
            n: '1',
            t: 'Open Host',
            d: 'Sign in on the Host page / Ougi Host app with the same account.',
          },
          {
            n: '2',
            t: 'Start the bot',
            d: 'Start Ougi on your PC while your license is active.',
          },
          {
            n: '3',
            t: 'Invite to Discord',
            d: 'Add the bot to your server, then use .setup / the panel.',
          },
          {
            n: '?',
            t: 'Need help?',
            d: 'Use live chat on the right, or join Discord.',
          },
        ]
      : [
          {
            n: '1',
            t: 'Message staff',
            d: 'Use live chat (right) with your server name or ID.',
          },
          {
            n: '2',
            t: 'Wait for staff',
            d: 'Someone joins your Discord server.',
          },
          {
            n: '3',
            t: 'Give Administrator',
            d: 'Temporary Admin is fine so we can add Ougi.',
          },
          {
            n: '4',
            t: 'We add Ougi',
            d: 'Then you can remove their role.',
          },
        ];

    while (ol.firstChild) ol.removeChild(ol.firstChild);
    steps.forEach((s) => {
      const li = document.createElement('li');
      const num = document.createElement('div');
      num.className = 'receipt-step-num';
      num.textContent = s.n;
      const body = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = s.t;
      const p = document.createElement('p');
      p.textContent = s.d;
      body.appendChild(strong);
      body.appendChild(p);
      li.appendChild(num);
      li.appendChild(body);
      ol.appendChild(li);
    });

    if (sub) {
      sub.textContent = pc
        ? 'Your license is paid. Open Host to run Ougi on your PC, or chat if something fails.'
        : 'Thanks. Chat with staff so we can whitelist your server and add the bot.';
    }
    if (next) {
      if (pc) {
        next.href = 'host.html';
        next.textContent = 'Open Host';
      } else {
        next.href = '#chatMount';
        next.textContent = 'Open live chat';
        next.addEventListener('click', (e) => {
          e.preventDefault();
          document.getElementById('chatMount')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          document.querySelector('#chatInput')?.focus();
        });
      }
    }
  }

  function paint() {
    let method = receipt.method || '—';
    if (receipt.cardBrand && receipt.cardLast4) {
      method = `${String(receipt.cardBrand).toUpperCase()} •••• ${receipt.cardLast4}`;
    }
    set('rOrder', receipt.orderId || '—');
    set('rPlan', receipt.planName || '—');
    set('rAmount', money(receipt.amount));
    set('rMethod', method);
    set('rBuyer', receipt.buyer || '—');
    paintSteps();
  }

  paint();

  async function finalizeFromRedirect() {
    const orderId = q.get('order');
    const paymentIntent = q.get('payment_intent');
    if (q.get('paid') !== '1' || !orderId) return;
    try {
      const csrfRes = await fetch('/api/csrf', { credentials: 'same-origin' });
      const csrfJson = await csrfRes.json();
      const doneRes = await fetch('/api/pay/complete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfJson.csrf || '',
        },
        body: JSON.stringify({
          csrf: csrfJson.csrf,
          orderId,
          paymentIntentId: paymentIntent,
        }),
      });
      const done = await doneRes.json();
      if (doneRes.ok && done.ok) {
        receipt = {
          ...receipt,
          orderId: done.orderId,
          planId: done.planId || receipt.planId,
          planName: done.planName || receipt.planName,
          amount: done.amountCents != null ? done.amountCents / 100 : receipt.amount,
          method: 'Card (Stripe)',
          buyer: done.discord || receipt.buyer,
          cardBrand: done.cardBrand,
          cardLast4: done.cardLast4,
        };
        sessionStorage.setItem('ougi-receipt', JSON.stringify(receipt));
        paint();
      }
    } catch {
      /* show whatever we have */
    }
  }

  finalizeFromRedirect().finally(() => {
    const mount = document.getElementById('chatMount');
    if (typeof mountOugiChat === 'function' && mount) {
      mountOugiChat(mount, {
        autoOpen: true,
        order: {
          orderId: receipt.orderId,
          plan: receipt.planId,
          planName: receipt.planName,
          amount: receipt.amount,
          method: receipt.method,
        },
      });
    }
  });
})();
