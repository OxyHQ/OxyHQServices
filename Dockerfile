##
## Dockerfile for the Oxy API Server (with built-in email worker)
##
## Runs the full Express API + SMTP inbound/outbound on a single process.
## Set SMTP_ENABLED=true to activate the email server.
##
## Build:  docker build -t oxy-api .
## Run:    docker run --env-file .env -p 8080:8080 -p 25:25 -p 587:587 oxy-api
##

FROM node:20-alpine AS builder

RUN npm install -g bun

WORKDIR /app

# Copy the full workspace manifest set and committed lockfile before installing.
# Keeping the root workspaces unchanged lets `bun install --frozen-lockfile` use
# the reviewed, integrity-pinned versions from bun.lock instead of resolving
# mutable semver ranges during production Docker builds.
COPY package.json bun.lock ./
COPY packages/api/package.json packages/api/
COPY packages/auth/package.json packages/auth/
COPY packages/auth-sdk/package.json packages/auth-sdk/
COPY packages/accounts/package.json packages/accounts/
COPY packages/console/package.json packages/console/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/inbox/package.json packages/inbox/
COPY packages/services/package.json packages/services/
COPY packages/test-app-expo/package.json packages/test-app-expo/

# Install dependencies from the committed lockfile.
RUN bun install --frozen-lockfile

# Copy source code
COPY packages/core/ packages/core/
COPY packages/contracts/ packages/contracts/
COPY packages/api/ packages/api/

# Build contracts first (api depends on it at runtime via dist/cjs), then core
# (admin scripts), then api.
RUN bun run --filter @oxyhq/contracts build
RUN bun run --filter @oxyhq/core build 2>/dev/null || true
RUN bun run --filter @oxyhq/api build

# ── Production image ──────────────────────────────────────────────
FROM node:20-alpine

RUN apk add --no-cache python3 make g++ ffmpeg curl
RUN npm install -g bun

WORKDIR /app

# Copy the full workspace manifest set and committed lockfile before installing.
COPY package.json bun.lock ./
COPY packages/api/package.json packages/api/
COPY packages/auth/package.json packages/auth/
COPY packages/auth-sdk/package.json packages/auth-sdk/
COPY packages/accounts/package.json packages/accounts/
COPY packages/console/package.json packages/console/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/inbox/package.json packages/inbox/
COPY packages/services/package.json packages/services/
COPY packages/test-app-expo/package.json packages/test-app-expo/

# Install production dependencies from the committed lockfile.
RUN bun install --production --frozen-lockfile

# Copy built artifacts
COPY --from=builder /app/packages/api/dist packages/api/dist
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/contracts/dist packages/contracts/dist

# Copy admin scripts + their src dependencies so one-shot ECS tasks can run them
# via `bun run packages/api/scripts/<name>.ts`. Scripts intentionally live outside
# tsconfig's rootDir; they are executed with bun (which interprets TS on the fly)
# and import from packages/api/src/* + packages/core/src/* at runtime.
COPY --from=builder /app/packages/api/scripts packages/api/scripts
COPY --from=builder /app/packages/api/src packages/api/src
COPY --from=builder /app/packages/core/src packages/core/src

# Main API entry point (includes SMTP when SMTP_ENABLED=true)
CMD ["node", "packages/api/dist/server.js"]

# HTTP API + SMTP ports
EXPOSE 8080 25 587
