# Railway hosting (website + Pro + Free bots)

Live URL: `https://ougi-production.up.railway.app`

## Environment variables (Railway → Variables)

Required:
- `DISCORD_TOKEN` — Pro / paid bot
- `DISCORD_TOKEN_FREE` — Free / TikTok trial bot
- `OUGI_SITE_ORIGIN` — `https://ougi-production.up.railway.app`
- `OUGI_SITE_HOST` — `0.0.0.0`

Recommended:
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `STRIPE_PUBLISHABLE_KEY` / `STRIPE_SECRET_KEY` (card checkout)
- `OUGI_CHAT_SECRET` — staff inbox password
- `OUGI_DISCORD_INVITE` — used by support FAQ auto-replies

Sync from local `.env` (never prints values):

```bash
node scripts/sync-railway-secrets.js
```

## Discord token reset (do this when ready)

If a token was ever shown in logs/CLI:

1. [Discord Developer Portal](https://discord.com/developers/applications) → your app → **Bot** → **Reset Token**
2. Put the new token only in local `token.txt` (Pro) and/or `token-free.txt` (Free)
3. Push to Railway via stdin (do not paste into chat):

```powershell
Get-Content token.txt -Raw | npx @railway/cli@latest variable set DISCORD_TOKEN --stdin --service ougi
Get-Content token-free.txt -Raw | npx @railway/cli@latest variable set DISCORD_TOKEN_FREE --stdin --service ougi
```

## Google OAuth

Authorized JavaScript origins:
- `https://ougi-production.up.railway.app`
- `http://127.0.0.1:5050`

Authorized redirect URIs:
- `https://ougi-production.up.railway.app/api/account/google/callback`
- `http://127.0.0.1:5050/api/account/google/callback`

## Support FAQ auto-replies

Buyer chat auto-answers keywords like “where can I buy”, “activate”, “invite the bot” via `website/chat-faq.js`.
