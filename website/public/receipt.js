(function () {
  const cfg = window.OUGI_SITE || {};
  const invite = cfg.discordInvite || 'https://discord.gg/DgGNBzXCcq';
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
      planName: q.get('plan') || '—',
      amount: q.get('amount') || '—',
      method: q.get('method') || (q.get('paid') === '1' ? 'Card (Stripe)' : '—'),
      buyer: q.get('buyer') || '—',
    };
  }

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  function paint() {
    let method = receipt.method || '—';
    if (receipt.cardBrand && receipt.cardLast4) {
      method = `${receipt.cardBrand.toUpperCase()} •••• ${receipt.cardLast4}`;
    }
    set('rOrder', receipt.orderId || '—');
    set('rPlan', receipt.planName || '—');
    set(
      'rAmount',
      typeof receipt.amount === 'number' ? `$${receipt.amount}` : String(receipt.amount || '—')
    );
    set('rMethod', method);
    set('rBuyer', receipt.buyer || '—');
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
    if (typeof mountOugiChat === 'function') {
      mountOugiChat(document.getElementById('chatMount'), {
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
