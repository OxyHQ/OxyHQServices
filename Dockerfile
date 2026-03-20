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

# Copy workspace root files and override workspaces to only include api + core
COPY package.json bun.lock ./
RUN node -e "const p=require('./package.json'); p.workspaces=['packages/core','packages/api']; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));"

# Copy all package.json files for dependency resolution
COPY packages/api/package.json packages/api/
COPY packages/core/package.json packages/core/

# Install all workspace dependencies
RUN BUN_INSTALL_FROZEN_LOCKFILE=false bun install

# Copy source code
COPY packages/core/ packages/core/
COPY packages/api/ packages/api/

# Build core first (api depends on it), then api
RUN bun run --filter @oxyhq/core build 2>/dev/null || true
RUN bun run --filter @oxyhq/api build

# ── Production image ──────────────────────────────────────────────
FROM node:20-alpine

RUN apk add --no-cache python3 make g++ ffmpeg
RUN npm install -g bun

WORKDIR /app

# Copy workspace root and override workspaces to only include api + core
COPY package.json bun.lock ./
RUN node -e "const p=require('./package.json'); p.workspaces=['packages/core','packages/api']; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));"
COPY packages/api/package.json packages/api/
COPY packages/core/package.json packages/core/

# Install production dependencies
RUN BUN_INSTALL_FROZEN_LOCKFILE=false bun install --production

# Copy built artifacts
COPY --from=builder /app/packages/api/dist packages/api/dist
COPY --from=builder /app/packages/core/dist packages/core/dist

# Main API entry point (includes SMTP when SMTP_ENABLED=true)
CMD ["node", "packages/api/dist/server.js"]

# HTTP API + SMTP ports
EXPOSE 8080 25 587
