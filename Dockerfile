FROM node:22-bookworm-slim AS builder

WORKDIR /app
ENV CI=true

RUN npm install -g pnpm@12.18.0 && npm cache clean --force

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build && test -f build/index.js && test -f build/migrate.js && test -f build/cli.js
RUN pnpm prune --prod

FROM node:22-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="Izgah" \
	org.opencontainers.image.description="Self-hosted shared link library for teams" \
	org.opencontainers.image.url="https://izgah.com" \
	org.opencontainers.image.source="https://github.com/gorkemio/izgah" \
	org.opencontainers.image.licenses="AGPL-3.0-only"

WORKDIR /app
ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	ADDRESS_HEADER=x-forwarded-for \
	XFF_DEPTH=1 \
	BODY_SIZE_LIMIT=6M \
	MEDIA_STORAGE_DIR=/data/thumbnails

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/drizzle ./drizzle
COPY --chmod=0755 scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh

RUN mkdir -p /data/thumbnails && chown -R node:node /data/thumbnails

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
