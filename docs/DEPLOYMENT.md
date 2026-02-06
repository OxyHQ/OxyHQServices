# Deployment

## Overview

| Environment | Platform | URL | Trigger |
|-------------|----------|-----|---------|
| **API** | Droplet (Docker) | `api.oxy.so` | Push to `main` -> GitHub Actions SSH |
| **Auth/Accounts** | App Platform | `auth.oxy.so` / `accounts.oxy.so` | Push to `main` -> auto-deploy |
| **Other apps** | App Platform | Various | Push to `main` -> auto-deploy |

## Droplet Deployment (api.oxy.so)

### Stack

```
Caddy (reverse proxy, auto HTTPS)
  +-- Express API (Node 20, port 8080)
        +-- SMTP inbound (port 25)
        +-- SMTP submission (port 587)
        +-- Rspamd (spam filtering)
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

### GitHub Secrets

| Secret | Description |
|--------|-------------|
| `DROPLET_HOST` | Droplet IP or hostname (e.g., `api.oxy.so`) |
| `DROPLET_USER` | SSH user (e.g., `deploy`) |
| `DROPLET_SSH_KEY` | Private SSH key for deploy user |
| `REDIS_URL` | Valkey connection string (private VPC URI) |

### Dockerfile (multi-stage)

```
Stage 1 (builder): node:20-alpine
  - npm ci, build @oxyhq/core, build @oxyhq/api

Stage 2 (production): node:20-alpine
  - npm ci --omit=dev
  - Copy compiled dist/ from builder
  - CMD: node packages/api/dist/server.js
```

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB cluster URI (no DB name — uses `dbName` option) |
| `ACCESS_TOKEN_SECRET` | JWT signing secret for access tokens |
| `REFRESH_TOKEN_SECRET` | JWT signing secret for refresh tokens |
| `FEDCM_TOKEN_SECRET` | JWT secret for FedCM tokens |
| `AWS_REGION` | S3/Spaces region (`ams3`) |
| `AWS_S3_BUCKET` | Asset storage bucket |
| `AWS_ACCESS_KEY_ID` | S3/Spaces key |
| `AWS_SECRET_ACCESS_KEY` | S3/Spaces secret |
| `NODE_ENV` | `production` or `development` |
| `PORT` | `8080` (Droplet) / `3001` (local) |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Valkey/Redis connection URI | Falls back to in-memory |
| `SMTP_ENABLED` | Enable SMTP inbound server | `false` |
| `EMAIL_DOMAIN` | Email domain (e.g., `oxy.so`) | — |
| `RSPAMD_URL` | Spam filter URL | — |
| `AWS_ENDPOINT_URL` | S3-compatible endpoint | AWS default |

### Generating Secrets

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## App Platform

App Platform apps auto-deploy on push to `main`. Each app spec includes:

- GitHub repo + branch
- Build and run commands
- Environment variables (secrets encrypted as `EV[1:...]`)
- Database references (`${db-oxy.DATABASE_URL}`)
- VPC for private networking

### Apps

| App | Components | URL |
|-----|-----------|-----|
| `oxy-api` | oxy-auth (Next.js), accounts-frontend (static), inbox-app (static) | auth.oxy.so, accounts.oxy.so, inbox.oxy.so |
| `mention-production` | mention | mention.earth |
| `homiio-frontend-app` | homiio | homiio.com |
| `alia-production` | alia | alia.onl |
| `allo-app` | allo | allo-app-invbl.ondigitalocean.app |

## Health Check

```bash
curl https://api.oxy.so/health
```

```json
{
  "status": "operational",
  "timestamp": "2026-02-06T20:00:00.000Z",
  "database": "connected",
  "redis": "connected"
}
```

Redis status: `"connected"` | `"disconnected"` | `"not configured"`
