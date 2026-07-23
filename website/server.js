const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const {
  addAccessRequest,
  loadAccess,
  isPrivateMode,
} = require('../src/utils/access');
const chat = require('./chat-store');
const payments = require('./payments');
const users = require('./users');
const googleAuth = require('./google-auth');
const sec = require('./security');

const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || process.env.OUGI_SITE_PORT || 5050);
// Hosted platforms (Railway) must bind all interfaces. Ignore bad HOST values like URLs.
const rawHost = String(process.env.OUGI_SITE_HOST || '0.0.0.0').trim();
const HOST = !rawHost || rawHost.includes('://') || rawHost.includes('/') ? '0.0.0.0' : rawHost;
const TRUSTED_ORIGIN =
  process.env.OUGI_SITE_ORIGIN ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://127.0.0.1:${PORT}`);

function mime(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.ico')) return 'image/x-icon';
  return 'application/octet-stream';
}

function sendJson(res, code, data, req) {
  sec.securityHeaders(res, {
    isAdminPage: req?.url?.includes('admin') || false,
  });
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function redirect(res, location, req) {
  sec.securityHeaders(res, {
    isAdminPage: req?.url?.includes('admin') || false,
  });
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
  });
  res.end();
}

function genericError(res, req, err) {
  const code = err.statusCode || 400;
  const publicMsg =
    code === 401
      ? 'Unauthorized'
      : code === 403
        ? 'Forbidden'
        : code === 404
          ? 'Not found'
          : code === 413
            ? 'Payload too large'
            : code === 429
              ? 'Too many requests'
              : 'Request could not be completed';
  sec.logSecure('request_error', {
    code,
    path: req.url,
    message: err.message,
    ip: sec.clientIp(req),
  });
  return sendJson(res, code, { ok: false, message: publicMsg }, req);
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin navigations / no CORS
  try {
    const allowed = new URL(TRUSTED_ORIGIN);
    const got = new URL(origin);
    return allowed.host === got.host;
  } catch {
    return false;
  }
}

function requireOrigin(req, res) {
  if (!originAllowed(req)) {
    throw Object.assign(new Error('Origin not allowed'), { statusCode: 403 });
  }
}

function enforceHttps(req, res) {
  if (process.env.OUGI_FORCE_HTTPS !== '1') return false;
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (proto && proto !== 'https') {
    const host = req.headers.host || 'localhost';
    res.writeHead(301, { Location: `https://${host}${req.url}` });
    res.end();
    return true;
  }
  return false;
}

function serveStatic(req, res, pathname) {
  const full = sec.resolveSafePath(PUBLIC, pathname);
  if (!full) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad request');
  }
  let filePath = full;
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC, 'index.html');
  }
  const isAdmin = /admin-chat\.html$/i.test(filePath);
  sec.securityHeaders(res, { isAdminPage: isAdmin });
  const data = fs.readFileSync(filePath);
  const headers = {
    'Content-Type': mime(filePath),
    'Content-Length': data.length,
  };
  if (isAdmin) headers['Cache-Control'] = 'no-store';
  else if (filePath.endsWith('.html') || filePath.endsWith('.css') || filePath.endsWith('.js')) {
    headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
    headers['Pragma'] = 'no-cache';
  } else headers['Cache-Control'] = 'public, max-age=3600';
  res.writeHead(200, headers);
  res.end(data);
}

chat.ensure();
users.ensure();

const server = http.createServer(async (req, res) => {
  if (enforceHttps(req, res)) return;

  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const pathname = url.pathname;
  const ip = sec.clientIp(req);

  // Global rate limit
  const global = sec.rateLimit(`ip:${ip}`, { limit: 120, windowMs: 60_000 });
  if (!global.ok) {
    res.setHeader('Retry-After', String(Math.ceil((global.retryAfterMs || 60000) / 1000)));
    return sendJson(res, 429, { ok: false, message: 'Too many requests' }, req);
  }

  if (req.method === 'OPTIONS') {
    if (!originAllowed(req)) return sendJson(res, 403, { ok: false, message: 'Forbidden' }, req);
    sec.securityHeaders(res);
    res.writeHead(204, {
      'Access-Control-Allow-Origin': TRUSTED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, X-Buyer-Token',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '600',
    });
    return res.end();
  }

  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(
        res,
        200,
        {
          ok: true,
          product: 'Ougi',
          privateMode: isPrivateMode(),
          chat: true,
          stripe: payments.isConfigured(),
          google: googleAuth.isConfigured(),
        },
        req
      );
    }

    // Public CSRF bootstrap for buyers (no session)
    if (req.method === 'GET' && pathname === '/api/csrf') {
      const rl = sec.rateLimit(`csrf:${ip}`, { limit: 20, windowMs: 60_000 });
      if (!rl.ok) return sendJson(res, 429, { ok: false, message: 'Too many requests' }, req);
      const auth = users.getSession(req);
      const token = sec.issueCsrf(auth?.session?.id || null);
      return sendJson(res, 200, { ok: true, csrf: token }, req);
    }

    // ---- Website accounts ----
    if (req.method === 'POST' && pathname === '/api/account/register') {
      requireOrigin(req, res);
      const rl = sec.rateLimit(`register:${ip}`, { limit: 5, windowMs: 15 * 60_000 });
      if (!rl.ok) return sendJson(res, 429, { ok: false, message: 'Too many requests' }, req);
      const body = await sec.readBodyLimited(req);
      if (!sec.validateCsrf(body.csrf || req.headers['x-csrf-token'])) {
        return sendJson(res, 403, { ok: false, message: 'Forbidden' }, req);
      }
      const user = await users.register({
        email: body.email,
        password: body.password,
        name: body.name,
        discord: body.discord,
      });
      const sid = users.createSession(user.id, { ip });
      users.setUserCookie(res, sid);
      sec.consumeCsrf(body.csrf || req.headers['x-csrf-token']);
      const csrf = sec.issueCsrf(sid);
      sec.logSecure('user_register_ok', { ip, userId: user.id, result: 'ok' });
      return sendJson(res, 200, { ok: true, user, csrf }, req);
    }

    if (req.method === 'POST' && pathname === '/api/account/login') {
      requireOrigin(req, res);
      const rl = sec.rateLimit(`userlogin:${ip}`, { limit: 8, windowMs: 15 * 60_000 });
      if (!rl.ok) return sendJson(res, 429, { ok: false, message: 'Too many requests' }, req);
      const body = await sec.readBodyLimited(req);
      if (!sec.validateCsrf(body.csrf || req.headers['x-csrf-token'])) {
        return sendJson(res, 403, { ok: false, message: 'Forbidden' }, req);
      }
      const user = await users.verifyLogin(body.email, body.password);
      if (!user) {
        await new Promise((r) => setTimeout(r, 400));
        sec.logSecure('user_login_failed', { ip, result: 'fail' });
        return sendJson(res, 401, { ok: false, message: 'Invalid email or password' }, req);
      }
      const sid = users.createSession(user.id, { ip });
      users.setUserCookie(res, sid);
      sec.consumeCsrf(body.csrf || req.headers['x-csrf-token']);
      const csrf = sec.issueCsrf(sid);
      sec.logSecure('user_login_ok', { ip, userId: user.id, result: 'ok' });
      return sendJson(res, 200, { ok: true, user: users.publicUser(user), csrf }, req);
    }

    if (req.method === 'POST' && pathname === '/api/account/logout') {
      requireOrigin(req, res);
      const auth = users.getSession(req);
      if (auth) {
        const body = await sec.readBodyLimited(req).catch(() => ({}));
        if (!sec.validateCsrf(body.csrf || req.headers['x-csrf-token'], auth.session.id)) {
          return sendJson(res, 403, { ok: false, message: 'Forbidden' }, req);
        }
      }
      users.destroySession(req, res);
      return sendJson(res, 200, { ok: true }, req);
    }

    if (req.method === 'GET' && pathname === '/api/account/me') {
      const auth = users.getSession(req);
      if (!auth) return sendJson(res, 401, { ok: false, message: 'Unauthorized' }, req);
      const csrf = sec.issueCsrf(auth.session.id);
      return sendJson(res, 200, { ok: true, user: users.publicUser(auth.user), csrf }, req);
    }

    if (req.method === 'GET' && pathname === '/api/account/auth-config') {
      return sendJson(res, 200, { ok: true, ...googleAuth.publicConfig() }, req);
    }

    if (req.method === 'POST' && pathname === '/api/account/google') {
      requireOrigin(req, res);
      const rl = sec.rateLimit(`googleid:${ip}`, { limit: 20, windowMs: 15 * 60_000 });
      if (!rl.ok) return sendJson(res, 429, { ok: false, message: 'Too many requests' }, req);
      const body = await sec.readBodyLimited(req);
      if (!sec.validateCsrf(body.csrf || req.headers['x-csrf-token'])) {
        return sendJson(res, 403, { ok: false, message: 'Forbidden' }, req);
      }
      try {
        const profile = await googleAuth.verifyIdToken(body.credential || body.idToken);
        const user = users.upsertFromGoogle(profile);
        const sid = users.createSession(user.id, { ip });
        users.setUserCookie(res, sid);
        sec.consumeCsrf(body.csrf || req.headers['x-csrf-token']);
        const csrf = sec.issueCsrf(sid);
        sec.logSecure('user_google_ok', { ip, userId: user.id, result: 'ok' });
        return sendJson(res, 200, { ok: true, user, csrf }, req);
      } catch (err) {
        return genericError(res, req, err);
      }
    }

    if (req.method === 'GET' && pathname === '/api/account/google/start') {
      const rl = sec.rateLimit(`googlestart:${ip}`, { limit: 20, windowMs: 15 * 60_000 });
      if (!rl.ok) return sendJson(res, 429, { ok: false, message: 'Too many requests' }, req);
      if (!googleAuth.hasSecret()) {
        return redirect(res, 'account.html?authError=google_off', req);
      }
      const next = url.searchParams.get('next') || 'pay.html';
      try {
        const { url: authUrl } = googleAuth.buildAuthUrl(TRUSTED_ORIGIN, next);
        return redirect(res, authUrl, req);
      } catch (err) {
        sec.logSecure('google_start_failed', { ip, result: 'fail', error: err.message });
        return redirect(res, 'account.html?authError=google_start', req);
      }
    }

    if (req.method === 'GET' && pathname === '/api/account/google/callback') {
      const rl = sec.rateLimit(`googlecb:${ip}`, { limit: 30, windowMs: 15 * 60_000 });
      if (!rl.ok) return sendJson(res, 429, { ok: false, message: 'Too many requests' }, req);
      const errParam = url.searchParams.get('error');
      if (errParam) {
        sec.logSecure('google_oauth_denied', { ip, result: 'fail', error: errParam });
        return redirect(res, 'account.html?authError=google_denied', req);
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const pending = googleAuth.consumeState(state);
      if (!code || !pending) {
        return redirect(res, 'account.html?authError=google_state', req);
      }
      try {
        const tokens = await googleAuth.exchangeCode(code, TRUSTED_ORIGIN);
        const profile = await googleAuth.fetchProfile(tokens.access_token);
        const user = users.upsertFromGoogle(profile);
        const sid = users.createSession(user.id, { ip });
        users.setUserCookie(res, sid);
        sec.logSecure('user_google_ok', { ip, userId: user.id, result: 'ok' });
        const dest = googleAuth.sanitizeNext(pending.next);
        return redirect(res, dest, req);
      } catch (err) {
        sec.logSecure('google_callback_failed', {
          ip,
          result: 'fail',
          error: err.message || 'fail',
        });
        return redirect(res, 'account.html?authError=google_fail', req);
      }
    }

    if (req.method === 'GET' && pathname === '/api/account/export') {
      const auth = users.requireUser(req);
      return sendJson(res, 200, { ok: true, data: users.exportUserData(auth.user.id) }, req);
    }

    if (req.method === 'POST' && pathname === '/api/account/delete') {
      requireOrigin(req, res);
      const auth = users.requireUser(req);
      const body = await sec.readBodyLimited(req);
      if (!sec.validateCsrf(body.csrf || req.headers['x-csrf-token'], auth.session.id)) {
        return sendJson(res, 403, { ok: false, message: 'Forbidden' }, req);
      }
      await users.deleteAccount(auth.user.id, body.password, {
        confirmDelete: body.confirmDelete,
      });
      users.destroySession(req, res);
      sec.clearBuyerCookies(res);
      return sendJson(res, 200, { ok: true }, req);
    }

    // ---- Stripe card checkout (PAN/CVV never hit this server) ----
    if (req.method === 'GET' && pathname === '/api/pay/config') {
      return sendJson(res, 200, { ok: true, ...payments.publicConfig() }, req);
    }

    if (req.method === 'POST' && pathname === '/api/pay/create-intent') {
      requireOrigin(req, res);
      const auth = users.requireUser(req);
      const rl = sec.rateLimit(`paycreate:${ip}`, { limit: 10, windowMs: 15 * 60_000 });
      if (!rl.ok) return sendJson(res, 429, { ok: false, message: 'Too many requests' }, req);
      const body = await sec.readBodyLimited(req);
      payments.assertNoCardData(body);
      if (!sec.validateCsrf(body.csrf || req.headers['x-csrf-token'], auth.session.id)) {
        return sendJson(res, 403, { ok: false, message: 'Forbidden' }, req);
      }
      const result = await payments.createPaymentIntent({
        planId: body.planId || body.plan,
        email: auth.user.email,
        name: body.name || auth.user.name,
        discord: auth.user.discord,
        server: body.server,
        userId: auth.user.id,
      });
      sec.consumeCsrf(body.csrf || req.headers['x-csrf-token']);
      return sendJson(
        res,
        200,
        {
          ok: true,
          orderId: result.orderId,
          clientSecret: result.clientSecret,
          amountCents: result.amountCents,
          currency: result.currency,
          plan: result.plan,
        },
        req
      );
    }

    if (req.method === 'POST' && pathname === '/api/pay/complete') {
      requireOrigin(req, res);
      const auth = users.requireUser(req);
      const rl = sec.rateLimit(`paydone:${ip}`, { limit: 20, windowMs: 15 * 60_000 });
      if (!rl.ok) return sendJson(res, 429, { ok: false, message: 'Too many requests' }, req);
      const body = await sec.readBodyLimited(req);
      payments.assertNoCardData(body);
      if (!sec.validateCsrf(body.csrf || req.headers['x-csrf-token'], auth.session.id)) {
        return sendJson(res, 403, { ok: false, message: 'Forbidden' }, req);
      }
      const result = await payments.finalizeOrder({
        orderId: body.orderId,
        paymentIntentId: body.paymentIntentId,
      });
      // Open support chat immediately after successful payment
      if (result.paid) {
        const { thread, buyerToken } = chat.createThread({
          buyerName: auth.user.discord,
          userId: auth.user.id,
          order: {
            orderId: result.orderId,
            planId: result.planId,
            planName: result.planName,
            amount: result.amountCents / 100,
            method: 'Card (Stripe)',
          },
        });
        sec.setBuyerCookies(res, { threadId: thread.id, buyerToken });
        result.threadId = thread.id;
        result.discord = auth.user.discord;
      }
      return sendJson(res, 200, { ok: true, ...result }, req);
    }

    if (req.method === 'POST' && pathname === '/api/access/request') {
      requireOrigin(req, res);
      const rl = sec.rateLimit(`access:${ip}`, { limit: 8, windowMs: 15 * 60_000 });
      if (!rl.ok) return sendJson(res, 429, { ok: false, message: 'Too many requests' }, req);
      const body = await sec.readBodyLimited(req);
      payments.assertNoCardData(body);
      if (!sec.validateCsrf(body.csrf || req.headers['x-csrf-token'])) {
        return sendJson(res, 403, { ok: false, message: 'Forbidden' }, req);
      }
      const discord = sec.sanitizePlainText(body.discord, 64);
      const email = sec.sanitizePlainText(body.email, 120);
      if (!discord && !email) {
        return sendJson(res, 400, { ok: false, message: 'Discord or email required' }, req);
      }
      if (discord && !sec.isValidDiscordName(discord)) {
        return sendJson(res, 400, { ok: false, message: 'Invalid Discord username' }, req);
      }
      if (email && !sec.isValidEmail(email)) {
        return sendJson(res, 400, { ok: false, message: 'Invalid email' }, req);
      }
      const request = addAccessRequest({
        discord,
        email,
        server: sec.sanitizePlainText(body.server, 100),
        note: sec.sanitizePlainText(body.note, 500),
        type: sec.sanitizePlainText(body.type, 40),
      });
      sec.consumeCsrf(body.csrf || req.headers['x-csrf-token']);
      sec.logSecure('access_request', { id: request.id, ip });
      return sendJson(
        res,
        200,
        { ok: true, id: request.id, message: 'If your request is valid, we will follow up.' },
        req
      );
    }

    if (req.method === 'GET' && pathname === '/api/access/public') {
      const cfg = loadAccess();
      return sendJson(
        res,
        200,
        {
          privateMode: !!cfg.privateMode,
          publicInvite: false,
          message: 'Ougi is invite-only.',
        },
        req
      );
    }

    // ---- Admin auth ----
    if (req.method === 'POST' && pathname === '/api/chat/admin/login') {
      requireOrigin(req, res);
      const rl = sec.rateLimit(`adminlogin:${ip}`, { limit: 5, windowMs: 15 * 60_000 });
      if (!rl.ok) return sendJson(res, 429, { ok: false, message: 'Too many requests' }, req);
      const body = await sec.readBodyLimited(req);
      const ok = await chat.verifyAdminPassword(body.password);
      if (!ok) {
        sec.logSecure('admin_login_failed', { ip, result: 'fail' });
        // constant-ish delay
        await new Promise((r) => setTimeout(r, 400));
        return sendJson(res, 401, { ok: false, message: 'Unauthorized' }, req);
      }
      const sid = sec.createAdminSession({
        staffName: body.staffName,
        ip,
      });
      sec.setCookie(res, sec.COOKIE_NAME, sid, { maxAgeSec: 8 * 3600, sameSite: 'Strict' });
      const csrf = sec.issueCsrf(sid);
      sec.logSecure('admin_login_ok', { ip, result: 'ok', staffName: sec.sanitizePlainText(body.staffName || 'Staff', 32) });
      return sendJson(res, 200, { ok: true, csrf, staffName: sec.sanitizePlainText(body.staffName || 'Staff', 32) }, req);
    }

    if (req.method === 'POST' && pathname === '/api/chat/admin/logout') {
      requireOrigin(req, res);
      const session = sec.getAdminSession(req);
      if (session) {
        const body = await sec.readBodyLimited(req).catch(() => ({}));
        if (!sec.validateCsrf(body.csrf || req.headers['x-csrf-token'], session.id)) {
          return sendJson(res, 403, { ok: false, message: 'Forbidden' }, req);
        }
      }
      sec.destroyAdminSession(req, res);
      sec.logSecure('admin_logout', { ip, result: 'ok' });
      return sendJson(res, 200, { ok: true }, req);
    }

    if (req.method === 'GET' && pathname === '/api/chat/admin/session') {
      const session = sec.getAdminSession(req);
      if (!session) return sendJson(res, 401, { ok: false, message: 'Unauthorized' }, req);
      const csrf = sec.issueCsrf(session.id);
      return sendJson(res, 200, { ok: true, csrf, staffName: session.staffName }, req);
    }

    // Reauth required — sensitive admin action
    if (req.method === 'POST' && pathname === '/api/chat/admin/password') {
      requireOrigin(req, res);
      const session = sec.getAdminSession(req);
      if (!session) return sendJson(res, 401, { ok: false, message: 'Unauthorized' }, req);
      const rl = sec.rateLimit(`adminpw:${ip}`, { limit: 5, windowMs: 15 * 60_000 });
      if (!rl.ok) return sendJson(res, 429, { ok: false, message: 'Too many requests' }, req);
      const body = await sec.readBodyLimited(req);
      if (!sec.validateCsrf(body.csrf || req.headers['x-csrf-token'], session.id)) {
        return sendJson(res, 403, { ok: false, message: 'Forbidden' }, req);
      }
      try {
        await chat.setAdminPassword({
          currentPassword: body.currentPassword,
          newPassword: body.newPassword,
        });
        sec.consumeCsrf(body.csrf || req.headers['x-csrf-token']);
        sec.destroyAdminSession(req, res);
        sec.logSecure('admin_password_change', { ip, userId: session.staffName, result: 'ok' });
        return sendJson(res, 200, { ok: true, message: 'Password updated. Log in again.' }, req);
      } catch (err) {
        sec.logSecure('admin_password_change', { ip, result: 'fail' });
        throw err;
      }
    }

    // ---- Buyer chat ----
    if (req.method === 'POST' && pathname === '/api/chat/ensure') {
      requireOrigin(req, res);
      const userAuth = users.requireUser(req);
      const rl = sec.rateLimit(`chatensure:${ip}`, { limit: 20, windowMs: 15 * 60_000 });
      if (!rl.ok) return sendJson(res, 429, { ok: false, message: 'Too many requests' }, req);
      const body = await sec.readBodyLimited(req).catch(() => ({}));
      if (!sec.validateCsrf(body.csrf || req.headers['x-csrf-token'], userAuth.session.id)) {
        return sendJson(res, 403, { ok: false, message: 'Forbidden' }, req);
      }
      const { thread, buyerToken } = chat.createThread({
        buyerName: userAuth.user.discord,
        userId: userAuth.user.id,
        order: body.order || null,
      });
      sec.setBuyerCookies(res, { threadId: thread.id, buyerToken });
      sec.logSecure('chat_ensure', { threadId: thread.id, userId: userAuth.user.id, ip, result: 'ok' });
      return sendJson(res, 200, { ok: true, thread: sec.safePublicThread(thread) }, req);
    }

    if (req.method === 'POST' && pathname === '/api/chat/start') {
      requireOrigin(req, res);
      const userAuth = users.getSession(req);
      if (!userAuth) {
        return sendJson(res, 401, { ok: false, message: 'Create an account to chat with support' }, req);
      }
      const rl = sec.rateLimit(`chatstart:${ip}`, { limit: 10, windowMs: 15 * 60_000 });
      if (!rl.ok) return sendJson(res, 429, { ok: false, message: 'Too many requests' }, req);
      const body = await sec.readBodyLimited(req);
      if (!sec.validateCsrf(body.csrf || req.headers['x-csrf-token'], userAuth.session.id)) {
        return sendJson(res, 403, { ok: false, message: 'Forbidden' }, req);
      }
      const { thread, buyerToken } = chat.createThread({
        buyerName: userAuth.user.discord,
        userId: userAuth.user.id,
        order: body.order || null,
      });
      sec.consumeCsrf(body.csrf || req.headers['x-csrf-token']);
      sec.setBuyerCookies(res, { threadId: thread.id, buyerToken });
      sec.logSecure('chat_start', { threadId: thread.id, userId: userAuth.user.id, ip, result: 'ok' });
      return sendJson(res, 200, { ok: true, thread: sec.safePublicThread(thread) }, req);
    }

    if (req.method === 'GET' && pathname === '/api/chat/current') {
      const userAuth = users.getSession(req);
      const buyer = sec.getBuyerAuth(req);

      if (userAuth) {
        let thread = chat.getThreadByUserId(userAuth.user.id);
        if (!thread && buyer.threadId) thread = chat.getThread(buyer.threadId);
        if (thread && (chat.assertUserOwnsThread(thread, userAuth.user.id) || chat.assertBuyerAccess(thread, buyer.buyerToken))) {
          return sendJson(res, 200, { ok: true, thread: sec.safePublicThread(thread) }, req);
        }
      }

      if (buyer.threadId && buyer.buyerToken) {
        if (!sec.isValidThreadId(buyer.threadId)) {
          return sendJson(res, 400, { ok: false, message: 'Bad request' }, req);
        }
        const thread = chat.getThread(buyer.threadId);
        if (thread && chat.assertBuyerAccess(thread, buyer.buyerToken)) {
          return sendJson(res, 200, { ok: true, thread: sec.safePublicThread(thread) }, req);
        }
        sec.clearBuyerCookies(res);
      }
      return sendJson(res, 404, { ok: false, message: 'Not found' }, req);
    }

    if (req.method === 'GET' && pathname.startsWith('/api/chat/thread/')) {
      const id = pathname.split('/').pop();
      if (!sec.isValidThreadId(id)) return sendJson(res, 400, { ok: false, message: 'Bad request' }, req);
      const thread = chat.getThread(id);
      if (!thread) return sendJson(res, 404, { ok: false, message: 'Not found' }, req);

      const adminSession = sec.getAdminSession(req);
      const buyer = sec.getBuyerAuth(req);
      const userAuth = users.getSession(req);
      const allowed =
        !!adminSession ||
        chat.assertUserOwnsThread(thread, userAuth?.user?.id) ||
        (chat.assertBuyerAccess(thread, buyer.buyerToken) && (!buyer.threadId || buyer.threadId === id));
      if (!allowed) return sendJson(res, 403, { ok: false, message: 'Forbidden' }, req);
      return sendJson(res, 200, { ok: true, thread: sec.safePublicThread(thread) }, req);
    }

    if (req.method === 'POST' && pathname.startsWith('/api/chat/thread/') && pathname.endsWith('/message')) {
      requireOrigin(req, res);
      const rl = sec.rateLimit(`chatmsg:${ip}`, { limit: 40, windowMs: 60_000 });
      if (!rl.ok) return sendJson(res, 429, { ok: false, message: 'Too many requests' }, req);
      const id = pathname.split('/')[4];
      if (!sec.isValidThreadId(id)) return sendJson(res, 400, { ok: false, message: 'Bad request' }, req);
      const body = await sec.readBodyLimited(req);
      const userAuth = users.getSession(req);
      const sessionId = userAuth?.session?.id || null;
      if (!sec.validateCsrf(body.csrf || req.headers['x-csrf-token'], sessionId)) {
        return sendJson(res, 403, { ok: false, message: 'Forbidden' }, req);
      }
      const thread = chat.getThread(id);
      if (!thread) return sendJson(res, 404, { ok: false, message: 'Not found' }, req);
      const buyer = sec.getBuyerAuth(req);
      const allowed =
        chat.assertUserOwnsThread(thread, userAuth?.user?.id) ||
        (chat.assertBuyerAccess(thread, buyer.buyerToken) && (!buyer.threadId || buyer.threadId === id));
      if (!allowed) return sendJson(res, 403, { ok: false, message: 'Forbidden' }, req);
      const result = chat.addMessage(id, {
        from: 'buyer',
        name: thread.buyerName,
        text: body.text,
      });
      return sendJson(res, 200, { ok: true, thread: sec.safePublicThread(result.thread) }, req);
    }

    // ---- Admin chat ----
    if (req.method === 'GET' && pathname === '/api/chat/admin/threads') {
      const session = sec.getAdminSession(req);
      if (!session) return sendJson(res, 401, { ok: false, message: 'Unauthorized' }, req);
      return sendJson(res, 200, { ok: true, threads: chat.listThreads() }, req);
    }

    if (req.method === 'POST' && pathname.startsWith('/api/chat/admin/thread/') && pathname.endsWith('/message')) {
      requireOrigin(req, res);
      const session = sec.getAdminSession(req);
      if (!session) return sendJson(res, 401, { ok: false, message: 'Unauthorized' }, req);
      const rl = sec.rateLimit(`adminmsg:${ip}`, { limit: 60, windowMs: 60_000 });
      if (!rl.ok) return sendJson(res, 429, { ok: false, message: 'Too many requests' }, req);
      const id = pathname.split('/')[5];
      if (!sec.isValidThreadId(id)) return sendJson(res, 400, { ok: false, message: 'Bad request' }, req);
      const body = await sec.readBodyLimited(req);
      if (!sec.validateCsrf(body.csrf || req.headers['x-csrf-token'], session.id)) {
        return sendJson(res, 403, { ok: false, message: 'Forbidden' }, req);
      }
      const result = chat.addMessage(id, {
        from: 'staff',
        name: session.staffName || body.name || 'Staff',
        text: body.text,
      });
      sec.logSecure('admin_reply', { threadId: id, ip });
      return sendJson(res, 200, { ok: true, thread: sec.safePublicThread(result.thread) }, req);
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { ok: false, message: 'Not found' }, req);
    }

    return serveStatic(req, res, pathname);
  } catch (err) {
    return genericError(res, req, err);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Ougi website (hardened) → http://${HOST}:${PORT}`);
  console.log(`Staff inbox → http://${HOST}:${PORT}/admin-chat.html`);
  console.log('Admin password: see data/ADMIN_PASSWORD_ONCE.txt (delete after saving) or set OUGI_CHAT_SECRET');
});
