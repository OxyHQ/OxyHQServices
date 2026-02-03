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

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json ./

# Copy all package.json files for dependency resolution
COPY packages/api/package.json packages/api/
COPY packages/core/package.json packages/core/

# Install all workspace dependencies
RUN npm ci --ignore-scripts

# Copy source code
COPY packages/core/ packages/core/
COPY packages/api/ packages/api/

# Build core first (api depends on it), then api
RUN npm run build -w @oxyhq/core 2>/dev/null || true
RUN npm run build -w @oxyhq/api

# ── Production image ──────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Copy workspace root
COPY package.json package-lock.json ./
COPY packages/api/package.json packages/api/
COPY packages/core/package.json packages/core/

# Install production dependencies only
RUN npm ci --ignore-scripts --omit=dev

# Copy built artifacts
COPY --from=builder /app/packages/api/dist packages/api/dist
COPY --from=builder /app/packages/core/dist packages/core/dist

# Main API entry point (includes SMTP when SMTP_ENABLED=true)
CMD ["node", "packages/api/dist/server.js"]

# HTTP API + SMTP ports
EXPOSE 8080 25 587
