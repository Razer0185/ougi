(function () {
  const cfg = window.OUGI_SITE || {};
  const plans = cfg.plans || [];
  const gifts = cfg.giftCards || [];

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  const grid = document.getElementById('planGrid');
  if (grid) {
    grid.innerHTML = plans
      .map((p) => {
        const period = p.period === 'once' ? 'once' : '/' + p.period;
        const hot = p.featured ? 'hot' : '';
        const btn = p.featured ? 'primary' : 'ghost';
        const feats = (p.features || []).map((f) => `<li>${esc(f)}</li>`).join('');
        return `
      <article class="plan ${hot}">
        <h3>${esc(p.name)}</h3>
        <div class="price">$${Number(p.price)}<span> ${esc(period)}</span></div>
        <p class="muted">${esc(p.blurb || '')}</p>
        <ul>${feats}</ul>
        <a class="btn ${btn}" href="pay.html?plan=${encodeURIComponent(p.id)}">Buy ${esc(p.name)}</a>
      </article>`;
      })
      .join('');
  }

  const body = document.querySelector('#giftMatrix tbody');
  if (body) {
    body.innerHTML = gifts
      .map((g) => {
        const link = (id) => {
          const href = g.buyUrls?.[id] || g.buyUrl || '#';
          const label = g.requirement?.[id] || `$${g.amounts?.[id] || '—'}`;
          return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
        };
        return `<tr>
        <td><strong>${esc(g.label)}</strong></td>
        <td>${link('pc')}</td>
        <td>${link('starter')}</td>
        <td>${link('pc-lifetime')}</td>
        <td>${link('lifetime')}</td>
      </tr>`;
      })
      .join('');
  }
})();
