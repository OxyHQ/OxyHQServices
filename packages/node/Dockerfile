##
## Dockerfile for the Oxy personal data node (@oxyhq/node).
##
## A small, self-hostable server that stores and serves a user's OWN signed
## records (their personal repo). Reuses @oxyhq/core for verification, so a
## record signed on the node verifies in Oxy with no new code.
##
## Build context is the MONOREPO ROOT (it copies @oxyhq/core + @oxyhq/contracts
## as workspace deps). Mirrors the api Dockerfile: node:20-alpine + bun, a lean
## workspace subset (core + contracts + node only), build-from-source.
##
## Build (arm64):
##   docker build --platform linux/arm64 -f packages/node/Dockerfile -t oxy-node .
## Run:
##   docker run --env-file .env -p 4000:4000 -v oxy-node-data:/data oxy-node
##

FROM node:20-alpine AS builder

# python3/make/g++: better-sqlite3 compiles a native addon at install time.
RUN apk add --no-cache python3 make g++
RUN npm install -g bun

WORKDIR /app

# Narrow the workspaces to the lean subset this image needs, then drop the
# monorepo lockfile (the subset does not match the full-repo lock — bun resolves
# deterministically from the package.json versions). Mirrors the api Dockerfile.
COPY package.json ./
RUN node -e "const p=require('./package.json'); p.workspaces=['packages/contracts','packages/protocol','packages/core','packages/node']; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));"

# package.json files first for dependency resolution caching
COPY packages/node/package.json packages/node/
COPY packages/core/package.json packages/core/
COPY packages/protocol/package.json packages/protocol/
COPY packages/contracts/package.json packages/contracts/

RUN bun install

# Source
COPY packages/core/ packages/core/
COPY packages/protocol/ packages/protocol/
COPY packages/contracts/ packages/contracts/
COPY packages/node/ packages/node/

# Build contracts, then protocol (the signed-record crypto base node verifies
# with), then core (node consumes their dist), then node.
RUN bun run --filter @oxyhq/contracts build
RUN bun run --filter @oxyhq/protocol build
RUN bun run --filter @oxyhq/core build
RUN cd packages/node && bunx tsc

# ── Production image ──────────────────────────────────────────────
FROM node:20-alpine

RUN apk add --no-cache python3 make g++ curl
RUN npm install -g bun

WORKDIR /app

COPY package.json ./
RUN node -e "const p=require('./package.json'); p.workspaces=['packages/contracts','packages/protocol','packages/core','packages/node']; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));"
COPY packages/node/package.json packages/node/
COPY packages/core/package.json packages/core/
COPY packages/protocol/package.json packages/protocol/
COPY packages/contracts/package.json packages/contracts/

RUN bun install --production

# Built artifacts
COPY --from=builder /app/packages/node/dist packages/node/dist
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/protocol/dist packages/protocol/dist
COPY --from=builder /app/packages/contracts/dist packages/contracts/dist

# Default data directory (mount a volume here to persist the SQLite DB + blobs).
ENV OXY_NODE_DATA_DIR=/data
VOLUME ["/data"]

# Container liveness — the node's own well-known liveness endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${OXY_NODE_PORT:-4000}/health" || exit 1

CMD ["node", "packages/node/dist/index.js"]

EXPOSE 4000
