# Service Tokens

Internal Oxy ecosystem apps authenticate with each other using short-lived service JWTs (OAuth2 Client Credentials pattern).

## Flow

```
1. Register DeveloperApp with isInternal: true (DB-only)
2. Service exchanges apiKey + apiSecret
   -> POST /api/auth/service-token
   -> Returns 1-hour JWT with type: 'service'
3. Service sends JWT as Authorization: Bearer <token>
   + X-Oxy-User-Id: <userId> for user delegation
4. auth() middleware recognizes type: 'service' JWTs
   (stateless — no session DB lookup)
```

## Setup

Register an internal service app directly in the database:

```javascript
db.developerapps.insertOne({
  name: "mention-backend",
  isInternal: true,
  apiKey: "oxy_dk_...",
  apiSecret: "oxy_ds_...", // hashed at rest
  createdAt: new Date(),
})
```

## Usage

### Get a Service Token

```typescript
import { OxyServices } from '@oxyhq/core';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
oxy.configureServiceAuth('oxy_dk_...', 'oxy_ds_...');

// Auto-cached, auto-refreshed (cached until expiry minus buffer)
const token = await oxy.getServiceToken();
```

### Delegated Requests

Act on behalf of a user:

```typescript
const result = await oxy.makeServiceRequest(
  'POST',
  '/api/notifications',
  { message: 'New follower' },
  'user-id-to-act-as'  // Sets X-Oxy-User-Id header
);
```

### Protect Internal Endpoints

```typescript
// Service-only (rejects user JWTs)
app.use('/internal', oxy.serviceAuth({
  jwtSecret: process.env.ACCESS_TOKEN_SECRET
}));

app.post('/internal/trigger', (req, res) => {
  req.serviceApp; // { appId, appName }
  req.userId;     // from X-Oxy-User-Id (or null)
});
```

### Mixed Auth (user + service)

```typescript
app.use('/api/data', oxy.auth({
  jwtSecret: process.env.ACCESS_TOKEN_SECRET
}));

app.get('/api/data', (req, res) => {
  if (req.serviceApp) {
    // Service token request
  } else {
    // Regular user request
  }
});
```

## Token Payload

```json
{
  "type": "service",
  "appId": "app-uuid",
  "appName": "mention-backend",
  "iat": 1707235200,
  "exp": 1707238800
}
```

## Security

- Service tokens verified via **HMAC-SHA256 signature** (not just decoded)
- `jwtSecret` must be provided to `auth()` / `serviceAuth()` for verification
- Without `jwtSecret`, service tokens are **rejected** (secure default)
- Timing-safe comparison for signature verification
- Service tokens bypass CSRF (bearer-only, not vulnerable)
- Expiration checked locally (no DB round-trip)

## Key Files

| File | Purpose |
|------|---------|
| `packages/api/src/routes/auth.ts` | `POST /auth/service-token` endpoint |
| `packages/api/src/models/DeveloperApp.ts` | `isInternal` field |
| `packages/core/src/mixins/OxyServices.utility.ts` | `auth()` + `serviceAuth()` middleware |
| `packages/core/src/mixins/OxyServices.auth.ts` | `getServiceToken()`, `makeServiceRequest()`, `configureServiceAuth()` |
