# syntax=docker/dockerfile:1
# Nihon image: the API, serving the built Web interface on the same origin. Build context: the
# repository root (see compose.yaml). Supported platforms: linux/amd64 and linux/arm64. The build
# stages run on the builder's own platform because they only produce JavaScript, HTML, and CSS; the
# production dependencies and the runtime stage follow the target platform, because better-sqlite3
# ships a native SQLite binary for it.

FROM --platform=$BUILDPLATFORM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS bun
FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS bun-target
FROM node:24.22.0-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS node

FROM bun AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
# Compiling needs no native binary or Prisma engine: skip their install scripts.
RUN bun install --frozen-lockfile --ignore-scripts --filter @nihon/api
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma/schema apps/api/prisma/schema
COPY apps/api/src apps/api/src
RUN bun run --cwd apps/api build

FROM bun AS web-build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY contracts/typescript/package.json contracts/typescript/
RUN bun install --frozen-lockfile --filter @nihon/web
COPY contracts/typescript/src contracts/typescript/src
COPY resources/themes resources/themes
COPY apps/web/build.ts apps/web/
COPY apps/web/src apps/web/src
RUN bun run --cwd apps/web build

# On the target platform with the runtime's Node.js, so better-sqlite3 installs the binary matching
# the runtime's architecture, C library, and Node.js ABI.
FROM node AS production-dependencies
COPY --from=bun-target /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
RUN bun install --frozen-lockfile --production --omit=peer --filter @nihon/api \
  && cd apps/api && node -e "new (require('better-sqlite3'))(':memory:').close()"

FROM node AS runtime
ENV NODE_ENV=production \
    NIHON_HOST=0.0.0.0 \
    NIHON_PORT=4000 \
    NIHON_DATA_DIR=/data \
    NIHON_WEB_DIR=/app/apps/web/dist
WORKDIR /app
COPY --from=production-dependencies /app/node_modules node_modules
COPY --from=production-dependencies /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=web-build /app/apps/web/dist apps/web/dist
COPY apps/api/package.json apps/api/
COPY apps/api/prisma/migrations apps/api/prisma/migrations
# A named volume mounted on /data starts with this directory's ownership and mode: only the server's
# user reads the database and its snapshots.
RUN mkdir /data && chown node:node /data && chmod 700 /data
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=1s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.NIHON_PORT}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Exec form: Node runs as PID 1 and receives SIGTERM from `docker stop` directly.
CMD ["node", "dist/main.js"]
