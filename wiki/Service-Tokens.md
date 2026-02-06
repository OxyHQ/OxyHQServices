# Service Tokens

Internal Oxy ecosystem apps authenticate with each other using short-lived service JWTs, following the OAuth2 Client Credentials pattern.

## Flow

```
1. Register DeveloperApp (isInternal: true) in database
2. Service exchanges apiKey + apiSecret
   -> POST /api/auth/service-token
   -> Returns 1-hour JWT with type: 'service'
3. Service uses JWT as Authorization: Bearer <token>
   + X-Oxy-User-Id: <userId> for user delegation
4. auth() middleware recognizes type: 'service' JWTs
   (stateless — no session DB lookup needed)
```

## Setting Up a Service App

Service apps are registered directly in the database (not via API):

```javascript
// In MongoDB
db.developerapps.insertOne({
  name: "mention-backend",
  isInternal: true,
  apiKey: "oxy_dk_...",      // Generated
  apiSecret: "oxy_ds_...",   // Generated, hashed at rest
  createdAt: new Date(),
})
```

## Getting a Service Token

```typescript
import { OxyServices } from '@oxyhq/core';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
oxy.configureServiceAuth('oxy_dk_...', 'oxy_ds_...');

// Auto-cached, auto-refreshed (cached until expiry minus buffer)
const token = await oxy.getServiceToken();
```

### Token Payload

```json
{
  "type": "service",
  "appId": "app-uuid",
  "appName": "mention-backend",
  "iat": 1707235200,
  "exp": 1707238800
}
```

## Making Service Requests

### Simple Request

```typescript
const token = await oxy.getServiceToken();

const response = await fetch('https://api.oxy.so/api/profiles/user123', {
  headers: {
    'Authorization': `Bearer ${token}`,
  },
});
```

### Delegated Request (Acting on Behalf of a User)

```typescript
// makeServiceRequest handles token acquisition + X-Oxy-User-Id header
const result = await oxy.makeServiceRequest(
  'POST',
  '/api/notifications',
  { message: 'New follower' },
  'user-id-to-act-as'
);
```

This sets both `Authorization: Bearer <service-token>` and `X-Oxy-User-Id: <userId>`.

## Protecting Internal Endpoints

### Service-only (rejects user JWTs)

```typescript
const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

// Only allows service tokens
app.use('/internal', oxy.serviceAuth({ jwtSecret: process.env.ACCESS_TOKEN_SECRET }));

app.post('/internal/trigger', (req, res) => {
  console.log('Service:', req.serviceApp);     // { appId, appName }
  console.log('Delegate user:', req.userId);    // from X-Oxy-User-Id
});
```

### Mixed (allows both user and service tokens)

```typescript
app.use('/api/data', oxy.auth({ jwtSecret: process.env.ACCESS_TOKEN_SECRET }));

app.get('/api/data', (req, res) => {
  if (req.serviceApp) {
    // Service token request
  } else {
    // Regular user request
  }
});
```

## Security

- Service tokens are verified via **HMAC-SHA256 signature** (not just decoded)
- The `jwtSecret` option must be provided to `auth()` / `serviceAuth()` for signature verification
- If `jwtSecret` is not provided, service tokens are **rejected** (secure default)
- Timing-safe comparison is used for signature verification
- Service tokens bypass CSRF protection (bearer-only, not vulnerable to CSRF)
- Expiration is checked locally (no DB round-trip)

## Key Files

| File | Purpose |
|------|---------|
| `packages/api/src/routes/auth.ts` | `POST /auth/service-token` endpoint |
| `packages/api/src/models/DeveloperApp.ts` | `isInternal` field on app model |
| `packages/core/src/mixins/OxyServices.utility.ts` | `auth()` and `serviceAuth()` middleware |
| `packages/core/src/mixins/OxyServices.auth.ts` | `getServiceToken()`, `makeServiceRequest()`, `configureServiceAuth()` |
