# Ougi — Discord bot + website on one free Render service
FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY index.js ./
COPY intents.txt ./
COPY scripts ./scripts
COPY src ./src
COPY website ./website
COPY host ./host
COPY assets ./assets

ENV NODE_ENV=production
ENV OUGI_SITE_HOST=0.0.0.0
ENV OUGI_FORCE_HTTPS=1

EXPOSE 10000
CMD ["node", "scripts/start-hosted.js"]
