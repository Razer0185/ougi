'use strict';

/**
 * Stripe payments — card data NEVER touches this server.
 * Only PaymentIntent ids + order metadata are stored.
 */

const fs = require('fs');
const path = require('path');
const { sanitizePlainText, isValidEmail, isValidDiscordName, logSecure } = require('./security');

const { PROJECT_ROOT, dataFile } = require('../src/utils/data-paths');
const ORDERS_PATH = dataFile('orders.json');
const PLANS = {
  pc: { id: 'pc', name: 'License Monthly', amountCents: 1000, period: 'month', hostMode: 'pc' },
  starter: { id: 'starter', name: 'Hosted Monthly', amountCents: 1500, period: 'month', hostMode: 'cloud' },
  'pc-lifetime': {
    id: 'pc-lifetime',
    name: 'License Lifetime',
    amountCents: 3000,
    period: 'once',
    hostMode: 'pc',
  },
  lifetime: { id: 'lifetime', name: 'Hosted Lifetime', amountCents: 4500, period: 'once', hostMode: 'cloud' },
  // Legacy aliases
  pro: { id: 'starter', name: 'Hosted Monthly', amountCents: 1500, period: 'month', hostMode: 'cloud' },
};

const CARD_FIELD_RE =
  /^(card|pan|cvv|cvc|expiry|exp_month|exp_year|cardnumber|card_number|creditcard|ccnumber)$/i;

let stripeClient = null;

function loadEnvFile() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 0) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch (err) {
    logSecure('env_load_failed', { result: 'fail', error: err.code || 'read' });
  }
}

loadEnvFile();

function getPublishableKey() {
  return String(process.env.STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PK || '').trim();
}

function getSecretKey() {
  return String(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SK || '').trim();
}

function isConfigured() {
  const pk = getPublishableKey();
  const sk = getSecretKey();
  return Boolean(pk.startsWith('pk_') && sk.startsWith('sk_'));
}

function getStripe() {
  if (!isConfigured()) return null;
  if (!stripeClient) {
    // Lazy require so site still boots without the package in weird installs
    const Stripe = require('stripe');
    stripeClient = new Stripe(getSecretKey());
  }
  return stripeClient;
}

function ensureOrders() {
  const dir = path.dirname(ORDERS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(ORDERS_PATH)) {
    fs.writeFileSync(ORDERS_PATH, JSON.stringify({ orders: {} }, null, 2), { mode: 0o600 });
  }
}

function loadOrders() {
  ensureOrders();
  try {
    return JSON.parse(fs.readFileSync(ORDERS_PATH, 'utf8'));
  } catch (err) {
    logSecure('orders_load_failed', { result: 'fail', error: err.code || 'parse' });
    return { orders: {} };
  }
}

function saveOrders(data) {
  ensureOrders();
  fs.writeFileSync(ORDERS_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

/** Reject any payload that tries to send raw card data to us. */
function assertNoCardData(body) {
  if (!body || typeof body !== 'object') return;
  for (const key of Object.keys(body)) {
    if (CARD_FIELD_RE.test(key)) {
      throw Object.assign(new Error('Card details must not be sent to this server.'), {
        statusCode: 400,
      });
    }
  }
}

function resolvePlan(planId) {
  const id = sanitizePlainText(planId, 32).toLowerCase();
  return PLANS[id] || null;
}

function publicConfig() {
  return {
    configured: isConfigured(),
    publishableKey: isConfigured() ? getPublishableKey() : null,
    currency: 'usd',
    statement: 'Ougi Discord Bot',
    // Explicit: we never store PAN/CVV
    storesCardData: false,
    processor: 'stripe',
  };
}

async function createPaymentIntent({ planId, email, name, discord, server, userId }) {
  assertNoCardData(arguments[0] || {});
  const stripe = getStripe();
  if (!stripe) {
    throw Object.assign(new Error('Card payments are not configured yet.'), { statusCode: 503 });
  }

  const plan = resolvePlan(planId);
  if (!plan) {
    throw Object.assign(new Error('Invalid plan.'), { statusCode: 400 });
  }
  if (!isValidEmail(email)) {
    throw Object.assign(new Error('Valid email is required.'), { statusCode: 400 });
  }
  if (!isValidDiscordName(discord)) {
    throw Object.assign(new Error('Valid Discord username is required.'), { statusCode: 400 });
  }

  const cleanName = sanitizePlainText(name, 80) || 'Customer';
  const cleanServer = sanitizePlainText(server, 100) || '';
  const cleanEmail = sanitizePlainText(email, 120).toLowerCase();
  const cleanDiscord = sanitizePlainText(discord, 64);
  const cleanUserId = userId ? sanitizePlainText(userId, 64) : null;

  const intent = await stripe.paymentIntents.create({
    amount: plan.amountCents,
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    receipt_email: cleanEmail,
    description: `Ougi ${plan.name} (${plan.period === 'once' ? 'lifetime' : 'monthly'})`,
    metadata: {
      product: 'ougi',
      planId: plan.id,
      planName: plan.name,
      period: plan.period,
      discord: cleanDiscord,
      server: cleanServer.slice(0, 100),
      userId: cleanUserId || '',
    },
  });

  const orderId = 'OG' + Date.now().toString(36).toUpperCase() + intent.id.slice(-6).toUpperCase();
  const data = loadOrders();
  data.orders[orderId] = {
    orderId,
    paymentIntentId: intent.id,
    status: intent.status,
    planId: plan.id,
    planName: plan.name,
    amountCents: plan.amountCents,
    currency: 'usd',
    email: cleanEmail,
    name: cleanName,
    discord: cleanDiscord,
    server: cleanServer,
    userId: cleanUserId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveOrders(data);

  logSecure('payment_intent_created', {
    result: 'ok',
    orderId,
    planId: plan.id,
    amountCents: plan.amountCents,
    userId: cleanUserId || undefined,
  });

  return {
    orderId,
    clientSecret: intent.client_secret,
    amountCents: plan.amountCents,
    currency: 'usd',
    plan,
  };
}

async function finalizeOrder({ orderId, paymentIntentId }) {
  const stripe = getStripe();
  if (!stripe) {
    throw Object.assign(new Error('Card payments are not configured yet.'), { statusCode: 503 });
  }

  const data = loadOrders();
  const order = data.orders[sanitizePlainText(orderId, 64)];
  if (!order) {
    throw Object.assign(new Error('Order not found.'), { statusCode: 404 });
  }
  if (paymentIntentId && order.paymentIntentId !== sanitizePlainText(paymentIntentId, 64)) {
    throw Object.assign(new Error('Order mismatch.'), { statusCode: 403 });
  }

  const intent = await stripe.paymentIntents.retrieve(order.paymentIntentId);
  order.status = intent.status;
  order.updatedAt = Date.now();
  if (intent.status === 'succeeded') {
    order.paidAt = Date.now();
    // Store only last4 / brand from Stripe charge summary if present — never full PAN
    const pm = intent.payment_method;
    if (typeof pm === 'string') {
      try {
        const method = await stripe.paymentMethods.retrieve(pm);
        if (method.card) {
          order.cardBrand = method.card.brand || null;
          order.cardLast4 = method.card.last4 || null;
        }
      } catch (err) {
        logSecure('pm_retrieve_failed', { result: 'fail', error: err.code || 'stripe' });
      }
    }
  }
  saveOrders(data);

  logSecure('payment_finalize', {
    result: intent.status === 'succeeded' ? 'ok' : 'pending',
    orderId: order.orderId,
    status: intent.status,
  });

  return {
    orderId: order.orderId,
    status: order.status,
    paid: order.status === 'succeeded',
    planId: order.planId,
    planName: order.planName,
    amountCents: order.amountCents,
    email: order.email,
    discord: order.discord,
    cardBrand: order.cardBrand || null,
    cardLast4: order.cardLast4 || null,
  };
}

module.exports = {
  publicConfig,
  createPaymentIntent,
  finalizeOrder,
  assertNoCardData,
  isConfigured,
  PLANS,
};
