# Redis & Valkey

The Oxy API uses DigitalOcean Managed Valkey (`db-valkey-ams3-04785`) for distributed rate limiting and Socket.IO cross-instance broadcasting. Valkey is a Redis-compatible in-memory data store.

## What It's Used For

| Feature | Without Redis | With Redis |
|---------|---------------|------------|
| Rate limiting | In-memory (resets on restart, per-instance) | Shared across instances, survives restarts |
| Socket.IO | Single-instance only (events don't cross processes) | Cross-instance broadcast via pub/sub |
| Health check | Reports `"not configured"` | Reports `"connected"` / `"disconnected"` |

## Architecture

```
┌─────────────┐     ┌─────────────┐
│ API Instance│     │ API Instance│
│    (pod 1)  │     │    (pod 2)  │
└──────┬──────┘     └──────┬──────┘
       │                   │
       └─────────┬─────────┘
                 │
          ┌──────┴──────┐
          │  db-valkey   │
          │ (Managed)    │
          │ Port 25061   │
          │ TLS enabled  │
          └─────────────┘
```

## Configuration

Set `REDIS_URL` in environment. If not set, everything falls back to in-memory (no breakage).

```bash
# Production (private VPC URI)
REDIS_URL=rediss://default:AVNS_xxx@private-db-valkey-ams3-04785-do-user-23621266-0.i.db.ondigitalocean.com:25061

# Local development (optional, not needed)
# REDIS_URL=redis://localhost:6379
```

- `rediss://` = TLS enabled (required for DigitalOcean Managed Databases)
- `redis://` = plaintext (local development only)
- Omit entirely = in-memory fallback

## Implementation

### Redis Client (`packages/api/src/config/redis.ts`)

```typescript
import Redis from 'ioredis';

export function getRedisClient(): Redis | null {
  if (!process.env.REDIS_URL) return null;  // Graceful fallback
  // Returns shared singleton, lazy-connects on first call
}

export async function closeRedis(): Promise<void> {
  // Called during graceful shutdown
}
```

### Rate Limiting (`packages/api/src/middleware/security.ts`)

Uses `rate-limit-redis` to back `express-rate-limit` with Redis:

```typescript
import { RedisStore } from 'rate-limit-redis';
import { getRedisClient } from '../config/redis';

function makeStore() {
  const redis = getRedisClient();
  if (!redis) return {};  // Falls back to in-memory
  return {
    store: new RedisStore({
      sendCommand: (...args: string[]) =>
        redis.call(args[0], ...args.slice(1)),
    }),
  };
}

const rateLimiter = rateLimit({
  ...makeStore(),
  windowMs: 15 * 60 * 1000,
  max: 150,
});
```

### Socket.IO Adapter (`packages/api/src/server.ts`)

Uses `@socket.io/redis-adapter` for cross-instance event broadcasting:

```typescript
import { createAdapter } from '@socket.io/redis-adapter';
import { getRedisClient } from './config/redis';

const redis = getRedisClient();
if (redis) {
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();
  io.adapter(createAdapter(pubClient, subClient));
}
```

This enables Socket.IO rooms and events to work across multiple API instances.

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `ioredis` | ^5.9 | Redis/Valkey client (Valkey is Redis-compatible) |
| `rate-limit-redis` | ^4.3 | Redis store for express-rate-limit |
| `@socket.io/redis-adapter` | ^8.3 | Socket.IO multi-instance adapter |

## Graceful Shutdown

Redis connection is closed during `SIGINT`:

```typescript
process.on('SIGINT', async () => {
  await closeRedis();
  await mongoose.connection.close();
  process.exit(0);
});
```

## Health Check

```bash
curl https://api.oxy.so/health
```

```json
{
  "status": "operational",
  "database": "connected",
  "redis": "connected"      // or "disconnected" or "not configured"
}
```

## Caching Strategy

The API has several in-memory caches that remain in-memory (not moved to Redis):

| Cache | Max Entries | TTL | Purpose |
|-------|-----------|-----|---------|
| sessionCache | 5,000 | 5 min | Session validation results |
| userCache | 10,000 | 5 min | User profile lookups |
| blockCache | 100,000 | 1 min | User block relationships |
| fileCache | 50,000 | 5 min | File metadata |
| locationCache | 1,000 | 24 hr | Location search results |

These work well as fast L1 caches. Redis serves as the distributed backbone for rate limiting and Socket.IO only. If horizontal scaling requires it, these caches can be migrated to Redis as L2 in the future.

## Firewall

`db-valkey-ams3-04785` is locked down to:
- Droplet `oxy-api-backend` (549107286)
- All 5 App Platform apps (oxy-api, mention, homiio, alia, allo)

No public access.
