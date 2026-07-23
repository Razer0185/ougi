# Free hosting (Render) — website + Discord bot

Your PC does **not** need to stay on. Render runs both on their servers.

## Limits (free tier)
- Service **sleeps after ~15 minutes** with no website traffic — the Discord bot goes offline while asleep.
- Opening the website URL wakes it (takes ~30–60s). For a bot that must stay online 24/7, upgrade later or use a always-on host.

## One-time setup
1. Push this repo to GitHub.
2. [render.com](https://render.com) → **New** → **Blueprint** → select the repo.
3. In Render → Environment, add:
   - `DISCORD_TOKEN` = contents of your local `token.txt` (never commit that file)
   - `OUGI_SITE_ORIGIN` = `https://YOUR-SERVICE.onrender.com`
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (optional, for Google login)
   - `OUGI_CHAT_SECRET` = a strong admin password for staff chat
4. Update Google OAuth origins/redirects to the Render URL.
5. Optional: use a free uptime pinger (e.g. UptimeRobot) hitting `https://YOUR-SERVICE.onrender.com/api/health` every 5 minutes to reduce sleep.
