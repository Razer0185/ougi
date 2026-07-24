# Ougi — Discord bot + website (Railway / Render)
FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY index.js ./
COPY index-free.js ./
COPY intents.txt ./
COPY scripts ./scripts
COPY src ./src
COPY website ./website
COPY host ./host
COPY assets ./assets

ENV NODE_ENV=production
ENV OUGI_SITE_HOST=0.0.0.0
ENV OUGI_FORCE_HTTPS=1
# Railway injects PORT at runtime — healthcheck hits /api/health on the website

EXPOSE 10000
CMD ["node", "scripts/start-hosted.js"]
