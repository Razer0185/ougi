'use strict';

/**
 * Keyword FAQ auto-replies for buyer support chat.
 * Replies as Ougi Support with buy / activate / invite links.
 */

const COOLDOWN_MS = 3 * 60 * 1000;

/** @type {Map<string, Map<string, number>>} threadId -> intent -> lastAt */
const lastByThread = new Map();

function siteOrigin() {
  const o = String(
    process.env.OUGI_SITE_ORIGIN ||
      (process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : 'https://ougi-production.up.railway.app')
  ).replace(/\/$/, '');
  return o || 'https://ougi-production.up.railway.app';
}

function discordInvite() {
  return String(process.env.OUGI_DISCORD_INVITE || 'https://discord.gg/AMaPQfQXGb').trim();
}

function links() {
  const base = siteOrigin();
  return {
    pricing: `${base}/pricing.html`,
    pay: `${base}/pay.html`,
    host: `${base}/host.html`,
    account: `${base}/account.html`,
    discord: discordInvite(),
  };
}

const RULES = [
  {
    id: 'buy',
    test: /\b(where\s+can\s+i\s+buy|how\s+(do\s+i\s+)?buy|purchase|pricing|price|checkout|cost|how\s+much|order|pay\b|payment|subscribe|subscription)\b/i,
    build(L) {
      return (
        `You can buy Ougi here:\n` +
        `→ Prices: ${L.pricing}\n` +
        `→ Checkout: ${L.pay}\n\n` +
        `Pick Hosted (we run the bot) or License (you run it on your PC). ` +
        `Card, PayPal, gift card, or crypto. You never get the source code.\n\n` +
        `Need help from staff? Discord: ${L.discord}`
      );
    },
  },
  {
    id: 'activate',
    test: /\b(activat\w*|how\s+do\s+i\s+(start|setup|set\s*up)|whitelist|link\s+(my\s+)?server|host(?:ing)?\s+(page|dashboard)|after\s+(?:i\s+)?pay)\b/i,
    build(L) {
      return (
        `After you pay:\n` +
        `1. Sign in: ${L.account}\n` +
        `2. Open Host: ${L.host}\n` +
        `3. Paste your Discord server ID (Developer Mode → right-click server → Copy Server ID)\n` +
        `4. Click Activate hosting\n` +
        `5. Use the invite link on that page to add our bot\n\n` +
        `Monthly plans expire automatically — renew on Checkout: ${L.pay}`
      );
    },
  },
  {
    id: 'invite',
    test: /\b(invite|add\s+(the\s+)?bot|bot\s+invite|how\s+do\s+i\s+add|get\s+(the\s+)?bot|bring\s+(the\s+)?bot)\b/i,
    build(L) {
      return (
        `Invite the bot only after Activate hosting:\n` +
        `→ Host page: ${L.host}\n` +
        `While your plan is active, the invite link appears there.\n\n` +
        `If you have not paid yet: ${L.pay}\n` +
        `Community Discord: ${L.discord}`
      );
    },
  },
  {
    id: 'google',
    test: /\b(google\s+(login|sign|auth)|sign\s+in\s+with\s+google|continue\s+with\s+google)\b/i,
    build(L) {
      return (
        `Google sign-in is on the Account page:\n` +
        `→ ${L.account}\n\n` +
        `Use the same Google account every time so your Host seat stays linked.`
      );
    },
  },
  {
    id: 'source',
    test: /\b(source\s*code|download\s+(the\s+)?bot|self[- ]?host\s+files|give\s+me\s+(the\s+)?(files|zip|exe)|github\s+repo)\b/i,
    build(L) {
      return (
        `We do not ship source code, zips, or a downloadable bot.\n` +
        `Hosted: we run Ougi for your Discord server after you Activate on Host.\n` +
        `License: you run Ougi via the Host app on your PC while subscribed.\n\n` +
        `Buy / renew: ${L.pay}`
      );
    },
  },
  {
    id: 'help',
    test: /\b(help|support|what\s+is\s+ougi|how\s+does\s+(this|it)\s+work)\b/i,
    build(L) {
      return (
        `Ougi is Discord bot hosting — we run it for you (Hosted) or you run it on your PC (License).\n\n` +
        `→ Buy: ${L.pay}\n` +
        `→ Prices: ${L.pricing}\n` +
        `→ Activate / invite: ${L.host}\n` +
        `→ Discord: ${L.discord}\n\n` +
        `Ask about buy, activate, or invite and I’ll send the exact steps.`
      );
    },
  },
];

function matchIntent(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 1000) return null;
  for (const rule of RULES) {
    if (rule.test.test(t)) return rule;
  }
  return null;
}

function cooledDown(threadId, intentId) {
  const tid = String(threadId || '');
  const map = lastByThread.get(tid);
  if (!map) return true;
  const at = map.get(intentId) || 0;
  return Date.now() - at >= COOLDOWN_MS;
}

function markSent(threadId, intentId) {
  const tid = String(threadId || '');
  let map = lastByThread.get(tid);
  if (!map) {
    map = new Map();
    lastByThread.set(tid, map);
  }
  map.set(intentId, Date.now());
  // Cap map size
  if (lastByThread.size > 500) {
    const first = lastByThread.keys().next().value;
    lastByThread.delete(first);
  }
}

/**
 * @returns {{ intent: string, text: string } | null}
 */
function maybeAutoReply(threadId, buyerText) {
  const rule = matchIntent(buyerText);
  if (!rule) return null;
  if (!cooledDown(threadId, rule.id)) return null;
  const text = rule.build(links());
  markSent(threadId, rule.id);
  return { intent: rule.id, text };
}

module.exports = {
  maybeAutoReply,
  matchIntent,
  links,
  RULES,
};
