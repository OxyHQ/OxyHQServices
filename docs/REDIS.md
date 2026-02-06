# Redis & Valkey

The Oxy API uses DigitalOcean Managed Valkey (`db-valkey-ams3-04785`) for distributed rate limiting and Socket.IO cross-instance broadcasting. Valkey is a Redis-compatible in-memory data store.

## What It's Used For

| Feature | Without Redis | With Redis |
|---------|---------------|------------|
| Rate limiting | In-memory (resets on restart, per-instance) | Shared across instances, survives restarts |
| Socket.IO | Single-instance only | Cross-instance broadcast via pub/sub |
| Health check | Reports `"not configured"` | Reports `"connected"` / `"disconnected"` |

## Configuration

Set `REDIS_URL` in environment. Omit to fall back to in-memory (no breakage).

```bash
# Production (private VPC URI)
REDIS_URL=rediss://default:password@private-db-valkey-ams3-04785-do-user-23621266-0.i.db.ondigitalocean.com:25061

# Local development (optional)
# REDIS_URL=redis://localhost:6379
```

- `rediss://` = TLS (required for DO Managed Databases)
- `redis://` = plaintext (local only)
- Omit = in-memory fallback

## Implementation

### Redis Client (`packages/api/src/config/redis.ts`)

Shared singleton with lazy connection and graceful null fallback:

```typescript
import Redis from 'ioredis';

export function getRedisClient(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  // Returns shared instance, lazy-connects on first call
}

export async function closeRedis(): Promise<void> {
  // Called during graceful shutdown
}
```

### Rate Limiting (`packages/api/src/middleware/security.ts`)

All rate limiters (`rateLimiter`, `authRateLimiter`, `userRateLimiter`) use `RedisStore` when available:

```typescript
import { RedisStore } from 'rate-limit-redis';

function makeStore() {
  const redis = getRedisClient();
  if (!redis) return {};  // In-memory fallback
  return {
    store: new RedisStore({
      sendCommand: (...args: string[]) =>
        redis.call(args[0], ...args.slice(1)),
    }),
  };
}
```

### Socket.IO Adapter (`packages/api/src/server.ts`)

Uses `@socket.io/redis-adapter` for cross-instance event broadcasting:

```typescript
import { createAdapter } from '@socket.io/redis-adapter';

const redis = getRedisClient();
if (redis) {
  io.adapter(createAdapter(redis.duplicate(), redis.duplicate()));
}
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `ioredis` | Redis/Valkey client |
| `rate-limit-redis` | Redis store for express-rate-limit |
| `@socket.io/redis-adapter` | Socket.IO multi-instance adapter |

## Caching Strategy

The API has several in-memory caches that remain in-memory (not moved to Redis):

| Cache | Max Entries | TTL | Purpose |
|-------|-----------|-----|---------|
| sessionCache | 5,000 | 5 min | Session validation results |
| userCache | 10,000 | 5 min | User profile lookups |
| blockCache | 100,000 | 1 min | User block relationships |
| fileCache | 50,000 | 5 min | File metadata |
| locationCache | 1,000 | 24 hr | Location search results |

These work well as fast L1 caches. Redis serves as the distributed backbone for rate limiting and Socket.IO only.

## Firewall

`db-valkey-ams3-04785` is restricted to the Droplet + all 5 App Platform apps. No public access.
