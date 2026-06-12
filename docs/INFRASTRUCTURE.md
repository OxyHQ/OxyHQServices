# Infrastructure

All Oxy production infrastructure runs on **AWS** in the **eu-west-1 (Ireland)** region under account `237343248947`. Infrastructure-as-code lives in the `oxy-infra` repo (Terraform; state in S3 `oxy-tf-state-237343248947`).

## Resources Overview

| Resource | Type | Identifier | Region | Purpose |
|----------|------|------------|--------|---------|
| `oxy-cluster` | ECS Fargate cluster | — | eu-west-1 | Runs all 6 backend services as Fargate tasks (linux/arm64) |
| `oxy-alb` | Application Load Balancer | `oxy-alb-127633307.eu-west-1.elb.amazonaws.com` | eu-west-1 | HTTPS termination (ACM multi-SAN cert) + path/host routing to ECS services |
| `oxy-valkey` | ElastiCache (Valkey) | — | eu-west-1 | Rate limiting + Socket.IO adapter |
| `oxy-mongo` | EC2 (MongoDB 8 self-hosted) | `i-0ce531a2b124b7c07` (EIP `18.203.144.124`) | eu-west-1 | Shared MongoDB for all Oxy apps. `/data` on a 100 GB gp3 EBS volume |
| `oxy-mongo-backups-237343248947` | S3 bucket | — | eu-west-1 | Daily mongodump under `daily/` (14-day retention) |
| `oxy-tf-state-237343248947` | S3 bucket | — | eu-west-1 | Terraform remote state |
| ECR repos | `237343248947.dkr.ecr.eu-west-1.amazonaws.com/oxy/<app>` | one per service | eu-west-1 | linux/arm64 images for each backend |
| `oxy-github-deploy` | IAM role | — | — | Trust policy for GitHub OIDC; no static AWS keys in GitHub |
| SES | — | — | eu-west-1 | Outbound email |
| Cloudflare Pages | — | — | — | Static frontends (accounts, auth, console, inbox, os, syra, allo) |

### Services running on `oxy-cluster`

| Service | Container port | Hostnames (via ALB) |
|---------|----------------|---------------------|
| `oxy-api` | 8080 | `api.oxy.so`, `api.website.oxy.so`, `website-api.oxy.so` |
| `mention` | 3000 | `api.mention.earth` |
| `alia` | 3001 | `api.alia.onl` |
| `homiio` | 4000 | `api.homiio.com` |
| `syra` | 3000 | `api.syra.oxy.so` |
| `allo` | 8080 | `api.allo.oxy.so` |

All tasks run `assign_public_ip=true` so there is no NAT gateway in the path.

### Static frontends (Cloudflare Pages)

| Project | Hostnames |
|---------|-----------|
| `oxy-accounts` | accounts.oxy.so |
| `oxy-auth` | auth.oxy.so (FedCM IdP — deployed as `_worker.js`, see `packages/auth/server`) |
| `oxy-inbox` | inbox.oxy.so |
| `oxy-console` | console.oxy.so |

## Networking

- ALB listener on `:443` terminates TLS with the ACM multi-SAN cert (DNS-validated through the Cloudflare API). HTTP `:80` redirects to `:443`.
- ALB target groups route by `Host:` header to the matching ECS service.
- Cloudflare DNS is **DNS-only** (grey cloud) for the API hostnames so the ALB sees real client IPs and ACM can complete DNS-01 validation.
- ECS tasks talk to ElastiCache and the MongoDB EC2 instance over the default VPC inside `eu-west-1`.
- Security group on the MongoDB EC2 instance allows `:27017` only from the ECS task ENIs and from the ops bastion path (SSM Session Manager — no SSH key on disk).

## Database: MongoDB (self-hosted on EC2)

The MongoDB 8 instance is intentionally self-hosted rather than DocumentDB so we can use the full driver feature set (transactions, change streams, full text search). Backups are written nightly:

- Job: scheduled `mongodump --gzip --archive=…` running inside the instance.
- Destination: `s3://oxy-mongo-backups-237343248947/daily/<date>.gz`.
- Retention: 14 days via the bucket lifecycle policy.
- Restore runbook: `~/Oxy/oxy-infra/docs/runbooks/10-mongo-restore.md`.

Admin credentials live in SSM Parameter Store (`/oxy/mongo/admin_user`, `/oxy/mongo/admin_password`). They are read by deploy jobs and the backup job — never committed.

### Database naming convention

The `MONGODB_URI` is the cluster URI (no database name embedded). Each app passes `dbName` to `mongoose.connect()`:

```typescript
const APP_NAME = "mention";
const ENV_DB_MAP: Record<string, string> = { production: 'prod', development: 'dev' };
const envSuffix = ENV_DB_MAP[process.env.NODE_ENV] || process.env.NODE_ENV;
const dbName = `${APP_NAME}-${envSuffix}`;

mongoose.connect(process.env.MONGODB_URI, { dbName });
```

Examples: `oxy-prod`, `mention-production`, `alia-production`, `homiio-production`, `allo-production`.

## Cache: ElastiCache Valkey (`oxy-valkey`)

See [Redis & Valkey](REDIS.md) for the rate-limiter and Socket.IO adapter wiring. Connection string is published via SSM as a shared parameter (`/oxy/_shared/REDIS_URL`) and injected into every ECS task.

## Secrets

GitHub Actions repo secrets are the **source of truth**. The deploy workflow (`.github/workflows/deploy-aws.yml`) syncs them into SSM Parameter Store under `/oxy/<app>/*` and `/oxy/_shared/*` on every run. ECS task definitions inject the SSM parameters at task launch.

Shared parameters (`/oxy/_shared/*`) include `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (for app-level S3/SES access where IAM roles aren't used), `REDIS_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.

> Never commit secret values to git. Never put secret values in this document.

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
                                   | ElastiCache  | |  MongoDB on    |
                                   |  Valkey      | |  EC2 + EBS     |
                                   |  oxy-valkey  | |  (EIP)         |
                                   +--------------+ +----------------+
                                                          |
                                                          v
                                                 +--------+--------+
                                                 |  S3 backups     |
                                                 |  (daily, 14d)   |
                                                 +-----------------+
```
