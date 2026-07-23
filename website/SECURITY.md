# Website security notes

## AI / engineering stance
Never assume code is secure because it works. Threat-model first, then implement.
If a requested change would weaken security, document the risk before applying it.
Insecure code found anywhere in the project should be called out with a secure fix.

## Website accounts
- Buyers must register/login before checkout (`/account.html`).
- Sessions: HttpOnly `ougi_user_sid`, bcrypt passwords, export/delete account.
- Support chat is tied to `userId`; after payment the server opens the thread and sets chat cookies.
- Chat access: account ownership **or** buyer HttpOnly cookies (never localStorage tokens).

## Card payments (Stripe)
- Checkout uses **Stripe Payment Element** (card number, expiry, CVC).
- Raw card data **never** hits Ougi servers or `data/` — rejected if posted (`assertNoCardData`).
- We only store order metadata + optional `cardBrand` / `cardLast4` after success.
- Keys: `STRIPE_PUBLISHABLE_KEY` + `STRIPE_SECRET_KEY` in `.env` (see `.env.example`).
- No `setup_future_usage` — we do **not** save cards on file.

## Implemented controls

| Area | Control | Why it helps |
|------|---------|--------------|
| Transport | Optional HTTPS redirect + HSTS (`OUGI_FORCE_HTTPS=1`) | Stops cookie/session theft on the wire |
| Headers | CSP, XFO DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP/CORP | Reduces XSS impact, clickjacking, MIME sniffing |
| Admin auth | bcrypt (12) password hash; HttpOnly `SameSite=Strict` session cookie | Resists offline hash cracking; blocks JS theft of session |
| Admin reauth | Password change requires current password + CSRF; session killed after change | Stops privilege persistence after credential change |
| Password policy | ≥12 chars, letters+numbers, common-password deny list; never truncate | Blocks weak admin secrets |
| Buyer auth | HttpOnly cookies (`ougi_buyer_tok` / `ougi_buyer_tid`), token hashed at rest | Prevents IDOR + XSS token theft (no localStorage JWT/token) |
| CSRF | Per-session / anonymous tokens on mutating APIs | Blocks cross-site state changes |
| Rate limits | Login, chat start/message, access, password change | Mitigates brute force and spam DoS |
| Validation | Length/allowlist on names, emails, thread IDs, messages | Stops injection and oversized payloads |
| Output | `textContent` DOM rendering; `safePublicThread` strips secrets | XSS + secret leakage resistance |
| Body limit | 32KB JSON max | Limits memory DoS |
| Path safety | `resolveSafePath` blocks `..` / absolute escapes | Stops static file traversal |
| Uploads | Dangerous ext + double-ext reject helper | Ready for future uploads without RCE vectors |
| Logging | Structured audit log (ts, ip, action, result); secrets stripped | Detection without leaking credentials |
| Retention | Chat threads pruned after 90 days | Privacy / data minimization |
| CORS | Trusted origin only (not `*`) | Blocks drive-by cross-origin API use |

## Permissions model
- **Buyer**: only their cookie-bound thread (read/write messages).
- **Staff**: session cookie required for inbox list + staff replies; must reauth to change password.
- **Public**: marketing pages + CSRF issue + access request (rate-limited). No public bot invite.

## Attack vectors considered
1. **IDOR on `/api/chat/thread/:id`** — mitigated by buyer token hash + cookie binding.
2. **XSS stealing chat token** — mitigated by moving token to HttpOnly cookie (removed localStorage).
3. **CSRF admin reply / logout / password** — CSRF + SameSite cookies.
4. **Brute-force admin login** — rate limit + bcrypt cost + generic 401.
5. **Session fixation** — new session id issued on login.
6. **Path traversal** — resolved under `website/public` only.
7. **Secret in repo** — admin hash in `data/` (gitignored); Discord `token.txt` must never be committed.
8. **Verbose errors** — clients get generic messages; details go to audit log without secrets.

## Validation rules (summary)
- Discord username: allowlisted charset / length via `isValidDiscordName`
- Messages: sanitized plain text ≤1000 chars
- Thread IDs: hex-only
- Admin password change: strength policy + current password

## Error cases
| Code | When |
|------|------|
| 401 | Missing/invalid admin session or password |
| 403 | CSRF fail, origin fail, buyer token mismatch |
| 404 | Unknown thread / API |
| 413 | Body too large |
| 429 | Rate limited |

## Env vars
- `OUGI_CHAT_SECRET` — preferred way to seed admin password before first run
- `OUGI_SITE_ORIGIN` — e.g. `https://your.domain` for CORS behind a proxy
- `OUGI_FORCE_HTTPS=1` — HSTS + HTTPS redirect
- `OUGI_SITE_PORT` / `OUGI_SITE_HOST`

## Out of scope (document tradeoffs)
- Full user accounts, GDPR export/delete UI, MFA, Stripe card vault, breached-password API (HaveIBeenPwned) — not built; site is marketing + pay instructions + support chat.
- Static GitHub Pages alone cannot run chat APIs — Node (`npm run site`) or a reverse proxy is required for live chat.
- Buyer “accounts” are cookie sessions, not durable logins across devices (security > convenience).

## Other project risks (outside website/)
- Discord bot `token.txt` / invite URL files are local secrets — never publish.
- Host panel (`127.0.0.1:7474`) is loopback-only by design; do not bind `0.0.0.0` without auth.

## Production checklist
1. Delete `data/ADMIN_PASSWORD_ONCE.txt` after saving the password.
2. Set a strong admin password via the inbox UI (reauth).
3. Put the site behind HTTPS; set `OUGI_FORCE_HTTPS=1` and `OUGI_SITE_ORIGIN`.
4. Disable debug / verbose errors (already default).
5. Confirm `data/` is not deployed publicly and not committed.
6. Back up `data/chats.json` + hash file; verify restore.
7. Run `npm run test:security` before release.

## Tests
```bash
npm run test:security
```
