# Authentication

## Overview

Oxy uses JWT-based authentication with server-side session validation. Tokens are issued on login and validated against the database on each request.

## Token Types

| Token | Lifetime | Storage | Validation |
|-------|----------|---------|------------|
| Access Token | Short-lived | Memory / `Authorization` header | Server-side session check |
| Refresh Token | Long-lived | httpOnly cookie | Database lookup |
| Service Token | 1 hour | Memory (cached) | Stateless JWT signature verification |
| FedCM Token | Short-lived | Browser FedCM API | Signed JWT |

## Authentication Flow

### 1. Login

```
Client -> POST /api/auth/login { username, password }
Server -> { accessToken, refreshToken, user }
```

### 2. Authenticated Request

```
Client -> GET /api/protected
          Authorization: Bearer <accessToken>
          X-CSRF-Token: <csrfToken>  (browser mode)
Server -> Validate session -> 200 OK
```

### 3. Token Refresh

```
Client -> POST /api/auth/refresh { refreshToken }
Server -> { accessToken, refreshToken }
```

## CSRF Protection

Implements the **double-submit cookie pattern** (stateless, no server-side session storage for CSRF).

### Browser Mode
1. Server sets `csrf_token` cookie (httpOnly, secure, sameSite)
2. Server exposes token via `X-CSRF-Token` response header
3. Client includes token in `X-CSRF-Token` request header
4. Server verifies cookie matches header (timing-safe comparison)

### Native App Mode
- Client sends `X-Native-App: true` header
- Only requires `X-CSRF-Token` header (no cookie matching)
- Must have `Authorization: Bearer` to prevent browser-based bypass

### CSRF Exemptions
- Safe methods: `GET`, `HEAD`, `OPTIONS`
- Service tokens (`type: 'service'` in JWT payload) — bearer-only, not vulnerable to CSRF

### Get CSRF Token

```bash
curl https://api.oxy.so/api/csrf-token
# Response: { "csrfToken": "..." }
# Also sets csrf_token cookie
```

## Auth Middleware (`oxy.auth()`)

The `@oxyhq/core` package provides Express middleware for protecting routes:

```typescript
import { OxyServices } from '@oxyhq/core';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

// Require authentication
app.use('/api/protected', oxy.auth());

// Optional auth (attach user if present, don't block)
app.use('/api/public', oxy.auth({ optional: true }));

// Load full user profile
app.use('/api/admin', oxy.auth({ loadUser: true }));
```

### Request Properties Set by Middleware

| Property | Type | Description |
|----------|------|-------------|
| `req.userId` | `string \| null` | User ID from token |
| `req.user` | `User \| null` | User object (minimal unless `loadUser: true`) |
| `req.accessToken` | `string` | The validated access token |
| `req.sessionId` | `string \| undefined` | Session ID (if session-based token) |
| `req.serviceApp` | `ServiceApp \| undefined` | Service app metadata (if service token) |

## Socket.IO Authentication

```typescript
// Server
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
  socket.user = { id: decoded.userId };
  next();
});

// Client
const socket = io('https://api.oxy.so', {
  auth: { token: accessToken }
});
```

## Rate Limiting

| Limiter | Window | Max Requests | Scope |
|---------|--------|-------------|-------|
| General | 15 min | 150 (prod) / 2000 (dev) | Per IP |
| Auth | 15 min | 50 (prod) / 500 (dev) | Per IP |
| User | 15 min | 200 (prod) / 2000 (dev) | Per user ID |
| Brute Force | 15 min | 100 before slowdown | Per IP, +500ms delay |

All rate limiters use Redis when `REDIS_URL` is configured (counters shared across instances, survive restarts). Falls back to in-memory otherwise.

## Security Headers (Helmet)

| Header | Value |
|--------|-------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `Content-Security-Policy` | `default-src 'self'; frame-ancestors 'none'` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Content-Type-Options` | `nosniff` |
