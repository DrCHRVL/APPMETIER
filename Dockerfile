# SIRAL — image serveur web
# Build : docker compose build   ·   Run : docker compose up -d

# ── Étape 1 : build Next.js ──
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# le .npmrc du dépôt pointe vers le proxy du ministère : on l'ignore dans l'image
RUN npm ci --no-audit --no-fund
COPY . .
RUN rm -f .npmrc && npm run build

# ── Étape 2 : image d'exécution minimale ──
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV SIRAL_DATA_DIR=/data
WORKDIR /app

# utilisateur non-root
RUN groupadd -r siral && useradd -r -g siral siral && mkdir -p /data && chown siral:siral /data

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER siral
EXPOSE 3000
VOLUME /data
CMD ["node", "server.js"]
