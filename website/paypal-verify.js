'use strict';

/**
 * PayPal Friends & Family claims.
 * Buyers submit the PayPal email they sent from; staff match that in PayPal Activity and approve.
 * Optional Transaction ID + API auto-check when paypal-api.txt is configured.
 */

const fs = require('fs');
const path = require('path');
const { sanitizePlainText, isValidEmail, logSecure } = require('./security');
const { PLANS } = require('./payments');

const { PROJECT_ROOT, dataFile } = require('../src/utils/data-paths');
const ROOT = PROJECT_ROOT;
const CLAIMS_PATH = dataFile('paypal-claims.json');
const PAYPAL_TXT = path.join(ROOT, 'paypal-api.txt');

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 1) continue;
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
  } catch {
    /* ignore */
  }
}

/** Simple file: line1 = Client ID, line2 = Secret (or KEY=value lines). */
function loadPaypalTxt() {
  if (!fs.existsSync(PAYPAL_TXT)) return;
  try {
    const lines = fs
      .readFileSync(PAYPAL_TXT, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    const kv = {};
    const plain = [];
    for (const line of lines) {
      const i = line.indexOf('=');
      if (i > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(line.slice(0, i).trim())) {
        const key = line.slice(0, i).trim().toUpperCase();
        let val = line.slice(i + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        kv[key] = val;
      } else {
        plain.push(line);
      }
    }

    if (kv.PAYPAL_CLIENT_ID || kv.CLIENT_ID) {
      process.env.PAYPAL_CLIENT_ID = kv.PAYPAL_CLIENT_ID || kv.CLIENT_ID;
    }
    if (kv.PAYPAL_CLIENT_SECRET || kv.CLIENT_SECRET || kv.SECRET) {
      process.env.PAYPAL_CLIENT_SECRET =
        kv.PAYPAL_CLIENT_SECRET || kv.CLIENT_SECRET || kv.SECRET;
    }
    if (kv.PAYPAL_MODE || kv.MODE) {
      process.env.PAYPAL_MODE = kv.PAYPAL_MODE || kv.MODE;
    }

    // Two bare lines: id then secret
    if (!process.env.PAYPAL_CLIENT_ID && plain[0]) {
      process.env.PAYPAL_CLIENT_ID = plain[0];
    }
    if (!process.env.PAYPAL_CLIENT_SECRET && plain[1]) {
      process.env.PAYPAL_CLIENT_SECRET = plain[1];
    }
  } catch {
    /* ignore */
  }
}

function loadPaypalCreds() {
  loadEnvFile();
  loadPaypalTxt();
}

function ensure() {
  const dir = path.dirname(CLAIMS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(CLAIMS_PATH)) {
    fs.writeFileSync(CLAIMS_PATH, JSON.stringify({ claims: {} }, null, 2), { mode: 0o600 });
  }
}

function load() {
  ensure();
  try {
    const raw = JSON.parse(fs.readFileSync(CLAIMS_PATH, 'utf8'));
    return { claims: raw.claims && typeof raw.claims === 'object' ? raw.claims : {} };
  } catch {
    return { claims: {} };
  }
}

function save(data) {
  ensure();
  fs.writeFileSync(CLAIMS_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function paypalConfigured() {
  loadPaypalCreds();
  return Boolean(
    String(process.env.PAYPAL_CLIENT_ID || '').trim() &&
      String(process.env.PAYPAL_CLIENT_SECRET || '').trim()
  );
}

function paypalBase() {
  loadPaypalCreds();
  const mode = String(process.env.PAYPAL_MODE || 'live').toLowerCase();
  return mode === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
}

function normalizeTxId(raw) {
  const s = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  // PayPal TX IDs are typically 17 chars alphanumeric
  if (!/^[A-Z0-9]{13,24}$/.test(s)) return null;
  return s;
}

let cachedToken = { value: null, expiresAt: 0 };

async function getAccessToken() {
  loadPaypalCreds();
  const id = String(process.env.PAYPAL_CLIENT_ID || '').trim();
  const secret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim();
  if (!id || !secret) {
    throw Object.assign(new Error('PayPal API not configured'), { statusCode: 503 });
  }
  if (cachedToken.value && Date.now() < cachedToken.expiresAt - 30_000) {
    return cachedToken.value;
  }
  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    logSecure('paypal_token_failed', { result: 'fail', status: res.status });
    throw Object.assign(new Error('Could not authenticate with PayPal'), { statusCode: 502 });
  }
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (Number(json.expires_in) || 300) * 1000,
  };
  return cachedToken.value;
}

/**
 * Look up a transaction by ID in the last 31 days (API limit window).
 */
async function lookupTransaction(transactionId) {
  const token = await getAccessToken();
  const end = new Date();
  const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    transaction_id: transactionId,
    start_date: start.toISOString(),
    end_date: end.toISOString(),
    fields: 'all',
    page_size: '10',
  });
  const res = await fetch(`${paypalBase()}/v1/reporting/transactions?${params}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 403 || res.status === 401) {
    throw Object.assign(
      new Error(
        'PayPal API denied Transaction Search. Enable it on your PayPal app (Live) and use a Business account.'
      ),
      { statusCode: 502 }
    );
  }
  if (!res.ok) {
    logSecure('paypal_lookup_failed', { result: 'fail', status: res.status });
    throw Object.assign(new Error('PayPal lookup failed'), { statusCode: 502 });
  }
  const list = Array.isArray(json.transaction_details) ? json.transaction_details : [];
  return list[0] || null;
}

function normalizeSenderEmail(raw) {
  const v = sanitizePlainText(raw || '', 120).toLowerCase();
  if (!isValidEmail(v)) return null;
  return v;
}

function publicClaim(c) {
  if (!c) return null;
  return {
    id: c.id,
    orderId: c.orderId,
    status: c.status,
    planId: c.planId,
    planName: c.planName,
    amountCents: c.amountCents,
    amount: (c.amountCents || 0) / 100,
    discord: c.discord,
    email: c.email,
    paypalSenderEmail: c.paypalSenderEmail || null,
    userId: c.userId,
    transactionId: c.transactionId || null,
    createdAt: c.createdAt,
    verifiedAt: c.verifiedAt || null,
    verifySource: c.verifySource || null,
    verifyNote: c.verifyNote || null,
    paypalStatus: c.paypalStatus || null,
    paypalAmount: c.paypalAmount || null,
  };
}

function createClaim({
  userId,
  email,
  discord,
  planId,
  paypalSenderEmail,
  transactionId,
  note,
}) {
  const plan = PLANS[planId] || PLANS[String(planId || '').toLowerCase()];
  if (!plan) {
    throw Object.assign(new Error('Invalid plan'), { statusCode: 400 });
  }
  const sender = normalizeSenderEmail(paypalSenderEmail);
  if (!sender) {
    throw Object.assign(
      new Error('Enter the PayPal email you sent the money from.'),
      { statusCode: 400 }
    );
  }
  const txRaw = String(transactionId || '').trim();
  const tx = txRaw ? normalizeTxId(txRaw) : null;
  if (txRaw && !tx) {
    throw Object.assign(
      new Error('Transaction ID looks invalid (optional — leave blank if you do not have it).'),
      { statusCode: 400 }
    );
  }

  const data = load();
  if (tx) {
    for (const c of Object.values(data.claims)) {
      if (c.transactionId === tx && (c.status === 'verified' || c.status === 'pending')) {
        if (String(c.userId) === String(userId) && c.status === 'pending') {
          c.paypalSenderEmail = sender;
          save(data);
          return publicClaim(c);
        }
        throw Object.assign(new Error('That Transaction ID was already submitted.'), {
          statusCode: 409,
        });
      }
    }
  }

  // One pending claim per user — update email / plan if they resubmit
  const existingPending = Object.values(data.claims).find(
    (c) => String(c.userId) === String(userId) && c.status === 'pending'
  );
  if (existingPending) {
    existingPending.paypalSenderEmail = sender;
    existingPending.planId = plan.id;
    existingPending.planName = plan.name;
    existingPending.amountCents = plan.amountCents;
    if (tx) existingPending.transactionId = tx;
    existingPending.note = sanitizePlainText(note || existingPending.note || '', 200);
    existingPending.discord = sanitizePlainText(discord, 64);
    existingPending.email = sanitizePlainText(email, 120);
    save(data);
    logSecure('paypal_claim_updated', {
      result: 'ok',
      claimId: existingPending.id,
      userId: String(userId),
      planId: plan.id,
    });
    return publicClaim(existingPending);
  }

  const id = 'PPC' + Date.now().toString(36).toUpperCase();
  const orderId = 'PP' + Date.now().toString(36).toUpperCase();
  const claim = {
    id,
    orderId,
    status: 'pending',
    planId: plan.id,
    planName: plan.name,
    amountCents: plan.amountCents,
    userId: String(userId),
    email: sanitizePlainText(email, 120),
    discord: sanitizePlainText(discord, 64),
    paypalSenderEmail: sender,
    transactionId: tx,
    note: sanitizePlainText(note || '', 200),
    createdAt: Date.now(),
    verifiedAt: null,
    verifySource: null,
    verifyNote: null,
    paypalStatus: null,
    paypalAmount: null,
  };
  data.claims[id] = claim;
  save(data);
  logSecure('paypal_claim_created', {
    result: 'ok',
    claimId: id,
    userId: String(userId),
    planId: plan.id,
  });
  return publicClaim(claim);
}

async function verifyClaimWithPaypal(claimId) {
  const data = load();
  const claim = data.claims[claimId];
  if (!claim) {
    throw Object.assign(new Error('Claim not found'), { statusCode: 404 });
  }
  if (claim.status === 'verified') return { claim: publicClaim(claim), already: true };

  if (!claim.transactionId) {
    throw Object.assign(
      new Error('This claim has no Transaction ID — match the sender email in PayPal Activity, then Confirm & activate.'),
      { statusCode: 400 }
    );
  }

  if (!paypalConfigured()) {
    throw Object.assign(
      new Error('Add Client ID + Secret to paypal-api.txt (project root) to auto-check.'),
      { statusCode: 503 }
    );
  }

  const detail = await lookupTransaction(claim.transactionId);
  if (!detail) {
    claim.verifyNote = 'No matching PayPal transaction found for that ID (check ID / wait a few minutes).';
    claim.paypalStatus = 'not_found';
    save(data);
    return { claim: publicClaim(claim), matched: false, reason: claim.verifyNote };
  }

  const info = detail.transaction_info || {};
  const status = String(info.transaction_status || '').toUpperCase();
  const value = Number(info.transaction_amount?.value || 0);
  const currency = info.transaction_amount?.currency_code || 'USD';
  const expected = (claim.amountCents || 0) / 100;

  claim.paypalStatus = status || 'unknown';
  claim.paypalAmount = `${value} ${currency}`;

  const okStatus = !status || status === 'S' || status === 'SUCCESS' || status === 'COMPLETED';
  const amountOk = Math.abs(Math.abs(value) - expected) < 0.02;

  if (okStatus && amountOk) {
    claim.status = 'verified';
    claim.verifiedAt = Date.now();
    claim.verifySource = 'paypal_api';
    claim.verifyNote = `Matched PayPal TX ${claim.transactionId} · ${claim.paypalAmount}`;
    save(data);
    logSecure('paypal_claim_verified_api', { result: 'ok', claimId, userId: claim.userId });
    return { claim: publicClaim(claim), matched: true, autoVerified: true };
  }

  claim.verifyNote = amountOk
    ? `Found TX but status is ${status || 'unknown'} — confirm in PayPal activity.`
    : `Found TX amount ${claim.paypalAmount}, expected $${expected} — confirm manually.`;
  save(data);
  return { claim: publicClaim(claim), matched: true, autoVerified: false, reason: claim.verifyNote };
}

function confirmClaimManual(claimId, staffName) {
  const data = load();
  const claim = data.claims[claimId];
  if (!claim) {
    throw Object.assign(new Error('Claim not found'), { statusCode: 404 });
  }
  if (claim.status === 'verified') return publicClaim(claim);
  claim.status = 'verified';
  claim.verifiedAt = Date.now();
  claim.verifySource = 'manual';
  claim.verifyNote = `Confirmed in PayPal by ${sanitizePlainText(staffName || 'Staff', 32)}`;
  save(data);
  logSecure('paypal_claim_verified_manual', {
    result: 'ok',
    claimId,
    userId: claim.userId,
    staff: sanitizePlainText(staffName || 'Staff', 32),
  });
  return publicClaim(claim);
}

function rejectClaim(claimId, staffName, reason) {
  const data = load();
  const claim = data.claims[claimId];
  if (!claim) {
    throw Object.assign(new Error('Claim not found'), { statusCode: 404 });
  }
  claim.status = 'rejected';
  claim.verifiedAt = Date.now();
  claim.verifySource = 'manual';
  claim.verifyNote = sanitizePlainText(reason || `Rejected by ${staffName || 'Staff'}`, 200);
  save(data);
  return publicClaim(claim);
}

function listClaims({ status } = {}) {
  const all = Object.values(load().claims).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const filtered = status ? all.filter((c) => c.status === status) : all;
  return filtered.slice(0, 100).map(publicClaim);
}

function activateFromClaim(claim) {
  const subs = require('../src/utils/subscriptions');
  if (!claim?.userId) {
    throw Object.assign(new Error('Claim missing user'), { statusCode: 400 });
  }
  return subs.grantFromPayment({
    userId: claim.userId,
    planId: claim.planId,
    planName: claim.planName,
    orderId: claim.orderId || claim.id,
    email: claim.email,
  });
}

module.exports = {
  paypalConfigured,
  normalizeTxId,
  normalizeSenderEmail,
  createClaim,
  verifyClaimWithPaypal,
  confirmClaimManual,
  rejectClaim,
  listClaims,
  activateFromClaim,
  publicClaim,
};
