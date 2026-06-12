# Infrastructure

All Oxy production infrastructure runs on **AWS** in the **eu-west-1 (Ireland)** region under account `237343248947`. Terraform IaC lives in the `oxy-infra` repo (state in S3 `oxy-tf-state-237343248947`).

## Resources Overview

| Resource | Type | Identifier | Region | Purpose |
|----------|------|------------|--------|---------|
| `oxy-cluster` | ECS Fargate cluster | — | eu-west-1 | All 6 backend services as Fargate tasks (linux/arm64) |
| `oxy-alb` | Application Load Balancer | `oxy-alb-127633307.eu-west-1.elb.amazonaws.com` | eu-west-1 | HTTPS termination (ACM multi-SAN cert) + host-based routing |
| `oxy-valkey` | ElastiCache (Valkey) | — | eu-west-1 | Rate limiting + Socket.IO adapter |
| `oxy-mongo` | EC2 (MongoDB 8 self-hosted) | `i-0ce531a2b124b7c07` (EIP `18.203.144.124`) | eu-west-1 | Shared MongoDB for all Oxy apps. `/data` on a 100 GB gp3 EBS volume |
| `oxy-mongo-backups-237343248947` | S3 bucket | — | eu-west-1 | Daily `mongodump` archives under `daily/` (14-day retention) |
| `oxy-tf-state-237343248947` | S3 bucket | — | eu-west-1 | Terraform remote state |
| ECR | `237343248947.dkr.ecr.eu-west-1.amazonaws.com/oxy/<app>` | one per service | eu-west-1 | linux/arm64 images |
| `oxy-github-deploy` | IAM role | — | — | GitHub OIDC trust; no static AWS keys in repo secrets |
| SES | — | — | eu-west-1 | Outbound email + inbound via Cloudflare Email Routing |
| Cloudflare Pages | — | — | — | Static frontends (accounts, auth, console, inbox) |

### Backend services on `oxy-cluster`

| Service | Port | Hostnames |
|---------|------|-----------|
| `oxy-api` | 8080 | `api.oxy.so`, `api.website.oxy.so`, `website-api.oxy.so` |
| `mention` | 3000 | `api.mention.earth` |
| `alia` | 3001 | `api.alia.onl` |
| `homiio` | 4000 | `api.homiio.com` |
| `syra` | 3000 | `api.syra.oxy.so` |
| `allo` | 8080 | `api.allo.oxy.so` |

All tasks run with `assign_public_ip = true` (no NAT gateway).

### Non-AWS resources (intentional exclusions)

| Resource | Where | Why |
|----------|-------|-----|
| LiveKit | DigitalOcean droplet `134.122.53.230` (`livekit.oxy.so`) | Migration to AWS pending |
| Athina, FairCoin, TNP, OpenSearch (`genai-shark`) | DigitalOcean | Outside the Oxy ecosystem migration scope |

## Networking

- ALB listener on `:443` terminates TLS using an ACM multi-SAN certificate (DNS-validated via the Cloudflare API).
- HTTP `:80` redirects to `:443`.
- ALB target groups route by `Host:` header to the matching ECS service.
- Cloudflare DNS is **DNS-only** (grey cloud) for all API hostnames so the ALB sees real client IPs and ACM can complete DNS-01 validation.
- ECS tasks reach ElastiCache and the MongoDB EC2 instance over the default VPC.
- The MongoDB EC2 security group accepts `:27017` only from the ECS task ENIs (security-group-to-security-group rule). Ops access uses AWS SSM Session Manager — there are no SSH keys on disk.

## Database: MongoDB (self-hosted on EC2)

Self-hosted rather than DocumentDB so we can use the full driver feature set (transactions, change streams, full text search).

- Daily `mongodump --gzip --archive=…` cron job inside the instance.
- Archives uploaded to `s3://oxy-mongo-backups-237343248947/daily/<date>.gz`.
- 14-day retention via the bucket lifecycle policy.
- Restore runbook: `~/Oxy/oxy-infra/docs/runbooks/10-mongo-restore.md`.

Admin credentials live in SSM (`/oxy/mongo/admin_user`, `/oxy/mongo/admin_password`). Read by deploy jobs and the backup cron. Never committed.

### Database naming convention

```
{appName}-{NODE_ENV_suffix}
```

| `NODE_ENV` | Suffix |
|------------|--------|
| `production` | `prod` |
| `development` | `dev` |

Each app passes `dbName` to `mongoose.connect()`:

```typescript
const APP_NAME = "mention";
const ENV_DB_MAP = { production: 'prod', development: 'dev' } as const;
const envSuffix = ENV_DB_MAP[process.env.NODE_ENV] ?? process.env.NODE_ENV;
const dbName = `${APP_NAME}-${envSuffix}`;
mongoose.connect(process.env.MONGODB_URI, { dbName });
```

## Cache: ElastiCache Valkey

See [[Redis & Valkey]] for client wiring. Connection URL lives in SSM as a shared parameter (`/oxy/_shared/REDIS_URL`) and is injected into every ECS task definition.

## Secrets

GitHub Actions repo secrets are the **source of truth**. `.github/workflows/deploy-aws.yml` mirrors them to AWS SSM under `/oxy/<app>/*` and `/oxy/_shared/*` on every run. ECS task definitions reference SSM parameters via `secrets` mappings, so the container only ever sees the resolved value at task launch.

`/oxy/_shared/*` covers `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (for SES / app-level S3 usage where IAM roles aren't applied), `REDIS_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.

> Never commit secret values. Never put secret values in this wiki.

## Architecture Diagram

```
                          Internet
                              |
                              v
                +-------------+--------------+
                |  Cloudflare DNS (DNS only) |
                +-------------+--------------+
                              |
        +---------------------+---------------------+
        |                                           |
        v                                           v
+-------+--------+                       +----------+----------+
| Cloudflare    |                        |  ALB (oxy-alb)      |
| Pages         |                        |  ACM HTTPS          |
| (frontends:   |                        +----------+----------+
|  accounts,    |                                   |
|  auth, inbox, |                  Host-based routing per service
|  console)     |                                   |
+---------------+                                   v
                                       +------------+------------+
                                       |  ECS Fargate cluster    |
                                       |  oxy-cluster (arm64)    |
                                       |                         |
                                       |  oxy-api  mention  alia |
                                       |  homiio   syra    allo  |
                                       +-----+-------+-----+-----+
                                             |       |     |
                                             v       v     v
                                   +---------+----+ +-+---+----------+
                                   | ElastiCache  | |  MongoDB EC2   |
                                   |  Valkey      | |  + EBS         |
                                   |  oxy-valkey  | |  + EIP         |
                                   +--------------+ +----------------+
                                                          |
                                                          v
                                                 +--------+--------+
                                                 |  S3 backups     |
                                                 |  (daily, 14d)   |
                                                 +-----------------+
```
