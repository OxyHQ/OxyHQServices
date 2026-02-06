# Infrastructure

All Oxy production infrastructure runs on DigitalOcean in the **AMS3 (Amsterdam)** region.

## Resources Overview

| Resource | Type | ID | Region | Purpose |
|----------|------|----|--------|---------|
| `oxy-api-backend` | Droplet | `549107286` | ams3 | Express API + SMTP (Docker) |
| `db-oxy` | Managed MongoDB 8 | `6a922a33` | ams3 | Shared MongoDB for all Oxy apps |
| `db-valkey-ams3-04785` | Managed Valkey 8 | `84abd7c5` | ams3 | Rate limiting + Socket.IO adapter |
| `oxy-api` | App Platform | `f5771b57` | ams | Auth (Next.js) + Accounts + Inbox |
| `mention-production` | App Platform | `f9d51c96` | ams | mention.earth |
| `homiio-frontend-app` | App Platform | `ea648ca3` | ams | homiio.com |
| `alia-production` | App Platform | `47f815eb` | ams | alia.onl |
| `allo-app` | App Platform | `2f3b7da0` | **nyc** | allo app (different region) |

## VPC (Virtual Private Cloud)

All AMS3 resources share the VPC `default-ams3` (`983f1e72-442d-4a5c-b7c2-22a422f88a19`).

| Resource | In VPC? |
|----------|---------|
| Droplet `oxy-api-backend` | Yes |
| `db-oxy` | Yes |
| `db-valkey-ams3-04785` | Yes |
| `mention-production` | Yes |
| `homiio-frontend-app` | Yes |
| `alia-production` | Yes |
| `oxy-api` (auth/accounts) | Yes |
| `allo-app` | No (NYC region — cannot join AMS3 VPC) |

VPC enables private networking between resources. Database connections resolve to private IPs automatically when apps are in the same VPC.

## Database: db-oxy (MongoDB)

Shared MongoDB cluster for all Oxy ecosystem apps. Each app uses its own database within the cluster.

### Database Naming Convention

```
{appName}-{envSuffix}
```

| `NODE_ENV` | Suffix |
|------------|--------|
| `production` | `prod` |
| `development` | `dev` |

Examples: `oxy-prod`, `mention-production`, `alia-production`, `homiio-production`, `allo-production`

### Connection Pattern

The `MONGODB_URI` is the cluster URI (no database name embedded). Each app passes `dbName` to `mongoose.connect()`:

```typescript
const APP_NAME = "mention";
const ENV_DB_MAP: Record<string, string> = { production: 'prod', development: 'dev' };
const envSuffix = ENV_DB_MAP[process.env.NODE_ENV] || process.env.NODE_ENV;
const dbName = `${APP_NAME}-${envSuffix}`;

mongoose.connect(process.env.MONGODB_URI, { dbName });
```

### Firewall Rules (db-oxy)

| Type | Value | Description |
|------|-------|-------------|
| droplet | `549107286` | oxy-api-backend |
| app | `f5771b57-6840-475a-a5a0-2acd5d788837` | oxy-api (auth/accounts) |
| app | `f9d51c96-6dc1-4dbe-b878-8ac93e40ac78` | mention-production |
| app | `47f815eb-e095-44c9-a0a4-c315307dac22` | alia-production |
| app | `ea648ca3-3d17-4bfd-8778-fc96f3bf15c0` | homiio-frontend-app |
| app | `2f3b7da0-d3be-48bc-8e5a-8bbccd721b37` | allo-app |

## Database: db-valkey (Redis/Valkey)

See [Redis & Valkey](REDIS.md) for implementation details.

Firewall rules mirror db-oxy: Droplet + all 5 App Platform apps.

## Cloud Firewall (Droplet)

The Droplet `oxy-api-backend` has a cloud firewall restricting inbound traffic to:

| Port | Source | Purpose |
|------|--------|---------|
| 22 | Restricted IPs | SSH |
| 80, 443 | All | HTTP/HTTPS (Caddy) |
| 25 | All | SMTP inbound |
| 587 | All | SMTP submission |

## Architecture Diagram

```
                        Internet
                           |
              +------------+------------+
              |            |            |
         api.oxy.so   auth.oxy.so  mention.earth
              |            |            |
         +----+       +----+       +----+
         |            |            |
    +---------+  +---------+  +---------+
    | Droplet |  | App     |  | App     |
    | (Docker)|  | Platform|  | Platform|
    | Caddy + |  | Next.js |  | Next.js |
    | Express |  | Auth    |  | Mention |
    +----+----+  +----+----+  +----+----+
         |            |            |
         +------+-----+------------+
                |        VPC
         +------+------+
         |             |
    +---------+  +----------+
    | db-oxy  |  | db-valkey|
    | MongoDB |  | Valkey   |
    +---------+  +----------+
```
