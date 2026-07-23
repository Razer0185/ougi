(function () {
  const cfg = window.OUGI_SITE || { plans: [], crypto: [], giftCards: [] };
  const params = new URLSearchParams(location.search);
  const planSelect = document.getElementById('planSelect');
  const baseAmountLabel = document.getElementById('baseAmountLabel');
  const amountLabel = document.getElementById('amountLabel');
  const feeLine = document.getElementById('feeLine');
  const feeLabel = document.getElementById('feeLabel');
  const feeAmountLabel = document.getElementById('feeAmountLabel');
  const methodLabel = document.getElementById('methodLabel');
  const processorLabel = document.getElementById('processorLabel');
  const panelCard = document.getElementById('panelCard');
  const panelCrypto = document.getElementById('panelCrypto');
  const panelGift = document.getElementById('panelGift');
  const cryptoList = document.getElementById('cryptoList');
  const giftType = document.getElementById('giftType');
  const giftBuyLink = document.getElementById('giftBuyLink');
  const giftTypeNote = document.getElementById('giftTypeNote');
  const giftDueLabel = document.getElementById('giftDueLabel');
  const paySubmit = document.getElementById('paySubmit');
  const stripeLoading = document.getElementById('stripeLoading');
  const stripeSetup = document.getElementById('stripeSetup');
  const setupHint = document.getElementById('setupHint');
  const payAuthGate = document.getElementById('payAuthGate');
  const payCheckout = document.getElementById('payCheckout');
  let method = 'card';
  let stripe = null;
  let elements = null;
  let payConfig = null;
  let csrf = '';
  let account = null;

  function currentPlan() {
    const id = planSelect.value;
    return cfg.plans.find((p) => p.id === id) || cfg.plans[0];
  }

  function currentGift() {
    const id = giftType.value;
    return (cfg.giftCards || []).find((g) => g.id === id) || (cfg.giftCards || [])[0];
  }

  function money(n) {
    return `$${Number(n).toFixed(2).replace(/\.00$/, '')}`;
  }

  function giftRequirement() {
    const p = currentPlan();
    const g = currentGift();
    if (!p || !g) return { amount: 0, label: '—', text: '—' };
    const amount = Number(g.amounts?.[p.id] ?? g.amounts?.starter ?? 0);
    const text = g.requirement?.[p.id] || `${money(amount)} ${g.label}`;
    return { amount, label: g.label, text };
  }

  function totals() {
    const p = currentPlan();
    const base = p ? Number(p.price) : 0;
    const req = giftRequirement();
    const total = method === 'giftcard' ? req.amount : base;
    const fee = method === 'giftcard' ? Math.max(0, Math.round((req.amount - base) * 100) / 100) : 0;
    return { base, fee, total, period: p?.period, giftText: req.text };
  }

  function refreshAmount() {
    const p = currentPlan();
    if (!p) return;
    const { base, fee, total, period, giftText } = totals();
    const periodTxt = period === 'once' ? ' once' : '/' + period;
    baseAmountLabel.textContent = `${money(base)}${periodTxt}`;
    if (method === 'giftcard') {
      feeLine.hidden = false;
      feeLabel.textContent = 'Gift card value (vs plan)';
      feeAmountLabel.textContent = money(total);
      amountLabel.textContent = giftText;
      giftDueLabel.textContent = giftText;
    } else {
      feeLine.hidden = true;
      amountLabel.textContent = `${money(base)}${periodTxt}`;
    }
  }

  function setMethodUI() {
    const labels = {
      card: 'Card / Apple Pay',
      giftcard: 'Gift card',
      crypto: 'Crypto',
    };
    const processors = {
      card: 'Stripe',
      giftcard: 'Official gift card stores',
      crypto: 'On-chain transfer',
    };
    methodLabel.textContent = labels[method] || method;
    processorLabel.textContent = processors[method] || '—';
    panelCard.hidden = method !== 'card';
    panelGift.hidden = method !== 'giftcard';
    panelCrypto.hidden = method !== 'crypto';
    refreshAmount();
  }

  function giftBuyUrl(card, planId) {
    if (!card) return '#';
    if (card.buyUrls && planId && card.buyUrls[planId]) return card.buyUrls[planId];
    return card.buyUrl || '#';
  }

  function refreshGiftUI() {
    const g = currentGift();
    const p = currentPlan();
    if (!g) return;
    const url = giftBuyUrl(g, p?.id);
    const amt = Number(g.amounts?.[p?.id] ?? g.amounts?.starter ?? 0);
    giftBuyLink.href = url;
    giftBuyLink.textContent = `Buy $${amt} ${g.label} on G2A`;
    giftTypeNote.textContent = g.note || '';
    refreshAmount();

    const grid = document.getElementById('giftQuickGrid');
    if (!grid || !p) return;
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    (cfg.giftCards || []).forEach((card) => {
      const tile = document.createElement('div');
      tile.className = 'gift-card-tile';
      const title = document.createElement('strong');
      title.textContent = card.label;
      const req = document.createElement('div');
      req.className = 'req';
      req.textContent = card.requirement?.[p.id] || `$${card.amounts?.[p.id] || '—'}`;
      const link = document.createElement('a');
      link.className = 'btn tiny ghost';
      link.href = giftBuyUrl(card, p.id);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const amt = Number(card.amounts?.[p.id] ?? 0);
      link.textContent = `Buy $${amt}`;
      link.addEventListener('click', () => {
        giftType.value = card.id;
        refreshGiftUI();
      });
      tile.appendChild(title);
      tile.appendChild(req);
      tile.appendChild(link);
      grid.appendChild(tile);
    });
  }

  function goReceipt(extra) {
    const plan = currentPlan();
    const { total, base } = totals();
    const receipt = {
      orderId: extra.orderId || 'R' + Date.now().toString(36).toUpperCase(),
      planId: plan?.id,
      planName: plan?.name,
      amount: extra.amount != null ? extra.amount : method === 'giftcard' ? total : base,
      method:
        extra.method ||
        (method === 'card' ? 'Card / Apple Pay' : method === 'giftcard' ? 'Gift card' : 'Crypto'),
      buyer: extra.buyer || account?.discord || '—',
      cardLast4: extra.cardLast4 || null,
      cardBrand: extra.cardBrand || null,
      at: Date.now(),
    };
    sessionStorage.setItem('ougi-receipt', JSON.stringify(receipt));
    location.href = 'receipt.html';
  }

  async function getCsrf() {
    const res = await fetch('/api/csrf', { credentials: 'same-origin' });
    const json = await res.json();
    if (!res.ok || !json.csrf) throw new Error('Security token unavailable');
    csrf = json.csrf;
    return csrf;
  }

  async function openSupportChat(order) {
    await getCsrf();
    await fetch('/api/chat/ensure', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ csrf, order }),
    });
  }

  function stripeAppearance() {
    const dark = document.documentElement.getAttribute('data-theme') !== 'light';
    return {
      theme: dark ? 'night' : 'stripe',
      variables: {
        colorPrimary: dark ? '#d6ff3a' : '#0a0a0a',
        colorBackground: dark ? '#1a1a1a' : '#ffffff',
        colorText: dark ? '#f5f5f5' : '#0a0a0a',
        colorDanger: '#ff4d4d',
        fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
        borderRadius: '0px',
      },
    };
  }

  function showSetupNeeded() {
    if (stripeLoading) stripeLoading.hidden = true;
    stripeSetup.hidden = false;
    while (stripeSetup.firstChild) stripeSetup.removeChild(stripeSetup.firstChild);
    const title = document.createElement('strong');
    title.textContent = 'Connect Stripe for card + Apple Pay';
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent =
      'Add Stripe keys to .env, then enable Apple Pay in the Stripe Dashboard (see website/PAYMENTS.md). Gift card + crypto still work without Stripe.';
    const pre = document.createElement('pre');
    pre.className = 'code-block';
    pre.textContent =
      'STRIPE_PUBLISHABLE_KEY=pk_test_...\nSTRIPE_SECRET_KEY=sk_test_...';
    const a = document.createElement('a');
    a.className = 'btn tiny ghost';
    a.href = 'https://dashboard.stripe.com/settings/payment_methods';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'Stripe payment methods';
    stripeSetup.appendChild(title);
    stripeSetup.appendChild(p);
    stripeSetup.appendChild(pre);
    stripeSetup.appendChild(a);
    setupHint.hidden = false;
    setupHint.textContent = 'Card/Apple Pay needs Stripe. Gift card & crypto work now.';
    paySubmit.disabled = true;
  }

  async function initStripe() {
    try {
      const res = await fetch('/api/pay/config', { credentials: 'same-origin' });
      payConfig = await res.json();
      if (!res.ok || !payConfig.configured || !payConfig.publishableKey) {
        showSetupNeeded();
        return;
      }
      if (typeof Stripe !== 'function') {
        throw new Error('Stripe.js failed to load');
      }
      stripe = Stripe(payConfig.publishableKey);
      elements = stripe.elements({
        mode: 'payment',
        amount: Math.round((currentPlan()?.price || 10) * 100),
        currency: 'usd',
        appearance: stripeAppearance(),
      });
      // Apple Pay / Google Pay show automatically when domain + Stripe wallets are enabled
      const paymentElement = elements.create('payment', {
        layout: { type: 'tabs', defaultCollapsed: false },
        wallets: { applePay: 'auto', googlePay: 'auto' },
        fields: { billingDetails: 'never' },
      });
      // Match new site theme (black + acid yellow)
      // appearance already set via stripeAppearance()
      if (stripeLoading) stripeLoading.remove();
      paymentElement.mount('#paymentElement');
      paySubmit.disabled = false;
    } catch (err) {
      showSetupNeeded();
      const status = document.getElementById('cardStatus');
      status.className = 'status show err';
      status.textContent = err.message || 'Could not load payment form';
    }
  }

  function updateElementsAmount() {
    if (!elements) return;
    const cents = Math.round((currentPlan()?.price || 10) * 100);
    elements.update({ amount: cents });
  }

  function fillAccount(user) {
    account = user;
    document.getElementById('payName').value = user.name || '';
    document.getElementById('payEmail').value = user.email || '';
    document.getElementById('payDiscord').value = user.discord || '';
    document.getElementById('cryptoDiscord').value = user.discord || '';
    document.getElementById('payAccountLabel').textContent =
      `Signed in as ${user.email} · Discord: ${user.discord}`;
  }

  async function requireAccount() {
    const res = await fetch('/api/account/me', { credentials: 'same-origin' });
    if (!res.ok) {
      payAuthGate.hidden = false;
      payCheckout.hidden = true;
      const plan = params.get('plan');
      const next = plan ? `pay.html?plan=${encodeURIComponent(plan)}` : 'pay.html';
      document.getElementById('payAuthLink').href = `account.html?next=${encodeURIComponent(next)}`;
      return false;
    }
    const json = await res.json();
    fillAccount(json.user);
    if (json.csrf) csrf = json.csrf;
    payAuthGate.hidden = true;
    payCheckout.hidden = false;
    return true;
  }

  planSelect.innerHTML = (cfg.plans || [])
    .map(
      (p) =>
        `<option value="${p.id}">${p.name} — $${p.price}${
          p.period === 'once' ? ' once' : '/' + p.period
        }</option>`
    )
    .join('');

  giftType.innerHTML = (cfg.giftCards || [])
    .map((g) => `<option value="${g.id}">${g.label}</option>`)
    .join('');

  const wanted = params.get('plan');
  if (wanted && cfg.plans.some((p) => p.id === wanted)) planSelect.value = wanted;
  refreshGiftUI();
  setMethodUI();
  planSelect.addEventListener('change', () => {
    refreshGiftUI();
    updateElementsAmount();
  });
  giftType.addEventListener('change', refreshGiftUI);

  document.querySelectorAll('.method-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      method = tab.dataset.method;
      document.querySelectorAll('.method-tab').forEach((t) => {
        t.classList.toggle('active', t === tab);
        t.classList.toggle('on', t === tab);
      });
      setMethodUI();
    });
  });

  cryptoList.innerHTML = (cfg.crypto || [])
    .map(
      (c) => `
      <div class="crypto-row">
        <div class="crypto-top">
          <strong>${c.symbol} · ${c.label}</strong>
          <span>${c.network}</span>
        </div>
        <div class="addr">${c.address}</div>
        <div class="crypto-actions">
          <button class="btn tiny ghost" type="button" data-copy="${c.address}">Copy address</button>
        </div>
      </div>`
    )
    .join('');

  cryptoList.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => ougiCopy(btn.dataset.copy));
  });

  document.getElementById('cardForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('cardStatus');
    status.className = 'status show';
    status.textContent = 'Processing secure payment…';
    paySubmit.disabled = true;

    if (!account) {
      status.classList.add('err');
      status.textContent = 'Sign in before paying.';
      paySubmit.disabled = false;
      return;
    }

    if (!stripe || !elements || !payConfig?.configured) {
      status.classList.add('err');
      status.textContent = 'Card / Apple Pay is not configured yet.';
      paySubmit.disabled = false;
      return;
    }

    const data = Object.fromEntries(new FormData(e.target).entries());

    try {
      await getCsrf();
      const plan = currentPlan();
      const intentRes = await fetch('/api/pay/create-intent', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({
          csrf,
          planId: plan?.id,
          name: data.name,
          server: data.server,
        }),
      });
      const intentJson = await intentRes.json();
      if (!intentRes.ok || !intentJson.ok) {
        throw new Error(intentJson.message || 'Could not start payment');
      }

      const { error: submitError } = await elements.submit();
      if (submitError) throw submitError;

      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret: intentJson.clientSecret,
        confirmParams: {
          return_url: `${location.origin}/receipt.html?paid=1&order=${encodeURIComponent(intentJson.orderId)}`,
          payment_method_data: {
            billing_details: {
              name: data.name || account.name,
              email: account.email,
            },
          },
        },
        redirect: 'if_required',
      });

      if (error) throw error;

      await getCsrf();
      const doneRes = await fetch('/api/pay/complete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({
          csrf,
          orderId: intentJson.orderId,
          paymentIntentId: paymentIntent?.id,
        }),
      });
      const doneJson = await doneRes.json();
      if (!doneRes.ok || !doneJson.ok || !doneJson.paid) {
        throw new Error(doneJson.message || 'Payment not completed');
      }

      goReceipt({
        orderId: doneJson.orderId,
        buyer: account.discord,
        method: paymentIntent?.payment_method_types?.includes('card')
          ? 'Card / Apple Pay'
          : 'Card / Apple Pay',
        cardLast4: doneJson.cardLast4,
        cardBrand: doneJson.cardBrand,
      });
    } catch (err) {
      status.classList.add('err');
      status.textContent = err.message || 'Payment failed';
      paySubmit.disabled = false;
    }
  });

  document.getElementById('giftNotify').addEventListener('click', async () => {
    const status = document.getElementById('giftStatus');
    if (!account) {
      status.className = 'status show err';
      status.textContent = 'Sign in before paying.';
      return;
    }
    const code = document.getElementById('giftCode').value.trim();
    if (!code || code.length < 4) {
      status.className = 'status show err';
      status.textContent = 'Paste your gift card code after you buy it.';
      return;
    }
    const g = currentGift();
    const plan = currentPlan();
    const { total, base, giftText } = totals();
    status.className = 'status show';
    status.textContent = 'Opening support chat…';
    try {
      const orderId = 'GC' + Date.now().toString(36).toUpperCase();
      await openSupportChat({
        orderId,
        planId: plan?.id,
        planName: plan?.name,
        amount: total,
        method: `Gift card (${g?.label || 'unknown'})`,
      });
      await ougiSendForm(
        {
          type: 'giftcard_paid',
          plan: plan?.id,
          planName: plan?.name,
          baseAmount: base,
          amountDue: total,
          giftRequirement: giftText,
          giftType: g?.id,
          giftLabel: g?.label,
          giftCode: code,
          discord: account.discord,
          email: account.email,
        },
        `Ougi gift card — ${plan?.name || 'plan'} — ${g?.label || ''}`
      );
      goReceipt({
        orderId,
        buyer: account.discord,
        method: `Gift card (${g?.label || ''})`,
        amount: total,
      });
    } catch (err) {
      status.classList.add('err');
      status.textContent = err.message || 'Failed';
    }
  });

  document.getElementById('cryptoNotify').addEventListener('click', async () => {
    const status = document.getElementById('cryptoStatus');
    if (!account) {
      status.className = 'status show err';
      status.textContent = 'Sign in before paying.';
      return;
    }
    const tx = document.getElementById('cryptoTx').value.trim();
    status.className = 'status show';
    status.textContent = 'Opening support chat…';
    const plan = currentPlan();
    try {
      const orderId = 'CR' + Date.now().toString(36).toUpperCase();
      await openSupportChat({
        orderId,
        planId: plan?.id,
        planName: plan?.name,
        amount: plan?.price,
        method: 'Crypto',
      });
      await ougiSendForm(
        {
          type: 'crypto_paid',
          plan: plan?.id,
          planName: plan?.name,
          amount: plan?.price,
          discord: account.discord,
          email: account.email,
          txid: tx,
          wallets: (cfg.crypto || []).map((c) => `${c.symbol}:${c.address}`).join(' | '),
        },
        `Ougi crypto payment — ${plan?.name || 'plan'}`
      );
      goReceipt({ buyer: account.discord, method: 'Crypto', orderId });
    } catch (err) {
      status.classList.add('err');
      status.textContent = err.message || 'Failed';
    }
  });

  requireAccount().then((ok) => {
    if (ok) initStripe();
  });
})();
