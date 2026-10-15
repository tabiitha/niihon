# syntax=docker/dockerfile:1
# Nihon API image. Build context: the repository root (see compose.yaml).
# Supported platforms: linux/amd64 and linux/arm64. Build stages run on the builder's own
# platform because they only produce JavaScript; the runtime stage follows the target platform.

FROM --platform=$BUILDPLATFORM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS bun

FROM bun AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
RUN bun install --frozen-lockfile --filter @nihon/api
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/
COPY apps/api/src apps/api/src
RUN bun run --cwd apps/api build

FROM bun AS production-dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
RUN bun install --frozen-lockfile --production --filter @nihon/api

FROM node:24.22.0-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS runtime
ENV NODE_ENV=production \
    NIHON_HOST=0.0.0.0 \
    NIHON_PORT=4000 \
    NIHON_DATA_DIR=/data
WORKDIR /app
COPY --from=production-dependencies /app/node_modules node_modules
COPY --from=production-dependencies /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/package.json apps/api/
# A named volume mounted on /data starts with this directory's ownership.
RUN mkdir /data && chown node:node /data
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=1s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.NIHON_PORT}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Exec form: Node runs as PID 1 and receives SIGTERM from `docker stop` directly.
CMD ["node", "dist/main.js"]
