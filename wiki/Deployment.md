# Deployment

## Overview

The Oxy API runs in two environments:

| Environment | Platform | URL | How |
|-------------|----------|-----|-----|
| **API (production)** | Droplet (Docker) | `api.oxy.so` | Push to `main` -> GitHub Actions SSH deploy |
| **Auth/Accounts** | App Platform | `auth.oxy.so` / `accounts.oxy.so` | Push to `main` -> auto-deploy |
| **Other apps** | App Platform | Various | Push to `main` -> auto-deploy |

## Droplet Deployment (api.oxy.so)

### Stack

```
Caddy (reverse proxy, auto HTTPS)
  └── Express API (Node 20, port 8080)
        ├── SMTP inbound (port 25)
        ├── SMTP submission (port 587)
        └── Rspamd (spam filtering)
```

All services run via Docker Compose on a single Droplet at `/opt/oxy`.

### CI/CD Pipeline

`.github/workflows/deploy.yml` triggers on every push to `main`:

1. SSH into Droplet
2. `git fetch origin main && git reset --hard origin/main`
3. Inject `REDIS_URL` from GitHub secret (if not already in `.env`)
4. `docker compose build api`
5. `docker compose up -d`
6. `docker image prune -f`

### GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `DROPLET_HOST` | Droplet IP or hostname (e.g., `api.oxy.so`) |
| `DROPLET_USER` | SSH user (e.g., `deploy`) |
| `DROPLET_SSH_KEY` | Private SSH key for deploy user |
| `REDIS_URL` | Valkey connection string (private VPC URI) |

### Docker Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build: builder (compile TS) -> production (Node 20 Alpine) |
| `docker-compose.yml` | API + Rspamd + Caddy services |
| `Caddyfile` | Reverse proxy config, auto HTTPS |
| `.env` | Environment variables (not in git) |

### Dockerfile Build Process

```dockerfile
# Stage 1: Builder
FROM node:20-alpine AS builder
COPY packages/core/ packages/api/  # Only core + api needed
RUN npm ci --ignore-scripts
RUN npm run build -w @oxyhq/core
RUN npm run build -w @oxyhq/api

# Stage 2: Production
FROM node:20-alpine
RUN npm ci --omit=dev
COPY --from=builder /app/packages/api/dist packages/api/dist
COPY --from=builder /app/packages/core/dist packages/core/dist
CMD ["node", "packages/api/dist/server.js"]
```

## Environment Variables

### Required (API)

| Variable | Description | Example |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB cluster URI (no DB name) | `mongodb+srv://...` |
| `ACCESS_TOKEN_SECRET` | JWT signing secret for access tokens | Random 64+ char string |
| `REFRESH_TOKEN_SECRET` | JWT signing secret for refresh tokens | Random 64+ char string |
| `FEDCM_TOKEN_SECRET` | JWT secret for FedCM tokens | Random 64+ char string |
| `AWS_REGION` | S3/Spaces region | `ams3` |
| `AWS_S3_BUCKET` | Asset storage bucket | `oxy-bucket` |
| `AWS_ACCESS_KEY_ID` | S3/Spaces key | |
| `AWS_SECRET_ACCESS_KEY` | S3/Spaces secret | |
| `NODE_ENV` | Environment | `production` |
| `PORT` | API port | `8080` (Droplet) / `3001` (local) |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Valkey/Redis connection URI | Falls back to in-memory |
| `SMTP_ENABLED` | Enable SMTP inbound server | `false` |
| `EMAIL_DOMAIN` | Email domain | |
| `RSPAMD_URL` | Spam filter URL | |
| `AWS_ENDPOINT_URL` | S3-compatible endpoint | AWS default |

### Generating Secrets

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## App Platform Deployment

App Platform apps auto-deploy on push to `main`. Each app has its own spec with:

- GitHub repo + branch configuration
- Build and run commands
- Environment variables (encrypted secrets use `EV[1:...]` format)
- Database references (`${db-oxy.DATABASE_URL}`)
- VPC attachment for private networking

### App Platform Apps

| App | Service | Build Command |
|-----|---------|---------------|
| `oxy-api` | oxy-auth (Next.js) | `npm ci && npm run build -w @oxyhq/core && npm run build -w @oxyhq/auth && npm run build -w auth` |
| `oxy-api` | accounts-frontend (static) | `npm ci && npm run build -w @oxyhq/core && npm run build:js -w @oxyhq/services && npm run build -w accounts` |
| `mention-production` | mention | App-specific build |
| `homiio-frontend-app` | homiio | App-specific build |
| `alia-production` | alia | App-specific build |

## Health Check

```bash
curl https://api.oxy.so/health
```

Response:
```json
{
  "status": "operational",
  "timestamp": "2026-02-06T20:00:00.000Z",
  "database": "connected",
  "redis": "connected"
}
```

Redis status values: `"connected"`, `"disconnected"`, `"not configured"`
