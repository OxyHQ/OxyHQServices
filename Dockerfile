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

# Copy workspace root and override workspaces to only include api + core + contracts.
# `@oxyhq/api` depends on `@oxyhq/contracts` (workspace:*); core is retained for the
# admin scripts that import packages/core/src/* at runtime.
# Remove bun.lock since the workspace change invalidates it — bun will
# resolve fresh dependencies (still deterministic from package.json versions).
COPY package.json ./
RUN node -e "const p=require('./package.json'); p.workspaces=['packages/core','packages/contracts','packages/api']; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));"

# Copy package.json files for dependency resolution
COPY packages/api/package.json packages/api/
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/

# Install dependencies (no lockfile — workspace subset doesn't match the full monorepo lock)
RUN bun install

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

# Copy workspace root and override workspaces
COPY package.json ./
RUN node -e "const p=require('./package.json'); p.workspaces=['packages/core','packages/contracts','packages/api']; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));"
COPY packages/api/package.json packages/api/
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/

# Install production dependencies
RUN bun install --production

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
