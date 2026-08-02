##
## Dockerfile for the Oxy API Server
##
## Runs the Express API. Inbound email is handled by Cloudflare Email
## Routing -> Worker -> /email/inbound in production. Do not expose public
## SMTP ports from this API container.
##
## Build:  docker build -t oxy-api .
## Run:    docker run --env-file .env -p 8080:8080 oxy-api
##

FROM node:20-alpine AS builder

RUN npm install -g bun

WORKDIR /app

# Copy workspace root and override workspaces to only include api + core +
# protocol + contracts + federation. `@oxyhq/api` depends on `@oxyhq/contracts` +
# `@oxyhq/protocol` + `@oxyhq/federation` (workspace:*); core is retained for the
# admin scripts that import packages/core/src/* at runtime (and core depends on
# protocol).
# Remove bun.lock since the workspace change invalidates it — bun will
# resolve fresh dependencies (still deterministic from package.json versions).
COPY package.json ./
RUN node -e "const p=require('./package.json'); const catalog=p.workspaces?.catalog; const packages=['packages/contracts','packages/protocol','packages/federation','packages/core','packages/api']; p.workspaces=catalog?{packages,catalog}:packages; delete p.patchedDependencies; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));"

# Copy package.json files for dependency resolution
COPY packages/api/package.json packages/api/
COPY packages/core/package.json packages/core/
COPY packages/protocol/package.json packages/protocol/
COPY packages/contracts/package.json packages/contracts/
COPY packages/federation/package.json packages/federation/

# Install dependencies (no lockfile — workspace subset doesn't match the full monorepo lock)
RUN bun install

# Copy source code
COPY packages/core/ packages/core/
COPY packages/protocol/ packages/protocol/
COPY packages/contracts/ packages/contracts/
COPY packages/federation/ packages/federation/
COPY packages/api/ packages/api/

# Build contracts first (api depends on it at runtime via dist/cjs), then
# protocol (the signed-record crypto base core + api consume), then federation
# (HTTP signatures for outbound ActivityPub fetches), then core (api imports
# @oxyhq/core/server — safeFetch etc.), then api.
RUN bun run --filter @oxyhq/contracts build
RUN bun run --filter @oxyhq/protocol build
RUN bun run --filter @oxyhq/core build
RUN bun run --filter @oxyhq/federation build
RUN bun run --filter @oxyhq/api build

# ── Production image ──────────────────────────────────────────────
FROM node:20-alpine

RUN apk add --no-cache python3 make g++ ffmpeg curl
RUN npm install -g bun

WORKDIR /app

# Copy workspace root and override workspaces
COPY package.json ./
RUN node -e "const p=require('./package.json'); const catalog=p.workspaces?.catalog; const packages=['packages/contracts','packages/protocol','packages/federation','packages/core','packages/api']; p.workspaces=catalog?{packages,catalog}:packages; delete p.patchedDependencies; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));"
COPY packages/api/package.json packages/api/
COPY packages/core/package.json packages/core/
COPY packages/protocol/package.json packages/protocol/
COPY packages/contracts/package.json packages/contracts/
COPY packages/federation/package.json packages/federation/

# Install production dependencies
RUN bun install --production

# Copy built artifacts
COPY --from=builder /app/packages/api/dist packages/api/dist
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/protocol/dist packages/protocol/dist
COPY --from=builder /app/packages/contracts/dist packages/contracts/dist
COPY --from=builder /app/packages/federation/dist packages/federation/dist

# Copy admin scripts + their src dependencies so one-shot ECS tasks can run them
# via `bun run packages/api/scripts/<name>.ts`. Scripts intentionally live outside
# tsconfig's rootDir; they are executed with bun (which interprets TS on the fly)
# and import from packages/api/src/* + packages/core/src/* at runtime.
COPY --from=builder /app/packages/api/scripts packages/api/scripts
COPY --from=builder /app/packages/api/src packages/api/src
COPY --from=builder /app/packages/core/src packages/core/src

# The SQL migrations + their journal. `dist/db/migrate.js` (built above) reads
# them from a path resolved relative to itself, so this directory has to sit at
# packages/api/drizzle exactly as it does in the repo. Applied by a one-shot ECS
# task — see .github/workflows/run-postgres-migrations.yml.
#
# The migrator is drizzle-orm's, NOT the drizzle-kit CLI: drizzle-kit is a
# devDependency that `bun install --production` above deliberately leaves out,
# because it depends on esbuild, whose arm64/alpine postinstall breaks this
# image (PR #261). drizzle-orm is already a runtime dependency and ships the
# migrator, so migrations run from the same image the service runs.
COPY --from=builder /app/packages/api/drizzle packages/api/drizzle

# Main API entry point
CMD ["node", "packages/api/dist/server.js"]

# HTTP API port
EXPOSE 8080
