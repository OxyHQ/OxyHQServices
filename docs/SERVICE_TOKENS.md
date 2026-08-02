# Service Tokens

Internal Oxy ecosystem apps authenticate with each other using short-lived service JWTs (OAuth2 Client Credentials pattern).

## Flow

```
1. Register an Application (type: 'internal' or isOfficial) with an
   ApplicationCredential of type: 'service' (Console staff view or DB)
2. Service exchanges the credential's publicKey (oxy_dk_…) + secret
   -> POST /auth/service-token
   -> Returns 1-hour JWT with type: 'service'
3. Service sends JWT as Authorization: Bearer <token>
   + X-Oxy-User-Id: <userId> for user delegation
4. auth() middleware recognizes type: 'service' JWTs
   (stateless — no session DB lookup)
```

## Setup

Service credentials belong to an `Application` (collection `applications`) via an `ApplicationCredential` (collection `applicationcredentials`):

- `ApplicationCredential.publicKey` = the client id (`oxy_dk_…`)
- `ApplicationCredential.secretHash` = sha256 of the secret — the plaintext secret is shown **once** at create/rotate time and never retrievable again
- `ApplicationCredential.type` must be `'service'`
- The owning `Application` must be `status: 'active'` and platform-trusted (`type: 'internal'` or official) — self-service third-party applications cannot mint service tokens
- Rotation: a rotated credential stays usable during a 7-day grace window; `revoked` is immediate

## Usage

### Get a Service Token

```typescript
import { OxyServices } from '@oxyhq/core';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
oxy.configureServiceAuth('oxy_dk_...', 'secret...');

// Auto-cached, auto-refreshed (cached until expiry minus buffer)
const token = await oxy.getServiceToken();
```

### Delegated Requests

Act on behalf of a user:

```typescript
const result = await oxy.makeServiceRequest(
  'POST',
  '/notifications',
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
  req.serviceApp; // { appId, appName, credentialId, scopes }
  req.userId;     // from X-Oxy-User-Id (or null)
});
```

### Mixed Auth (user + service)

```typescript
app.use('/data', oxy.auth({
  jwtSecret: process.env.ACCESS_TOKEN_SECRET
}));

app.get('/data', (req, res) => {
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
  "appId": "<applicationId>",
  "appName": "mention-backend",
  "credentialId": "<applicationCredentialId>",
  "scopes": ["notifications:write"],
  "iat": 1707235200,
  "exp": 1707238800
}
```

- `appId` is the `Application._id` (the claim name is intentionally stable).
- `credentialId` attributes the token to the specific `ApplicationCredential` that minted it (useful for post-rotation revocation).
- `scopes` = the credential's requested scopes **intersected** with the application's granted scopes; a credential with no explicit scopes inherits the app's full set.

## Security

- Service tokens verified via **HMAC-SHA256 signature** (not just decoded)
- `jwtSecret` must be provided to `auth()` / `serviceAuth()` for verification
- Without `jwtSecret`, service tokens are **rejected** (secure default)
- Secrets stored as sha256 hashes; timing-safe comparison on exchange
- Service tokens bypass CSRF (bearer-only, not vulnerable)
- Expiration checked locally (no DB round-trip)
- Per-scope authorisation via `oxy.requireScope('files:write')` after `serviceAuth()`

## Key Files

| File | Purpose |
|------|---------|
| `packages/api/src/routes/auth.ts` | `POST /auth/service-token` endpoint |
| `packages/api/src/models/Application.ts` | `type` / `isOfficial` / `isInternal` fields |
| `packages/api/src/models/ApplicationCredential.ts` | `publicKey`, `secretHash`, `type: 'service'` |
| `packages/api/src/utils/credentialUsability.ts` | `isCredentialUsable()` (active or in rotation grace) |
| `packages/core/src/mixins/OxyServices.utility.ts` | `auth()` + `serviceAuth()` middleware |
| `packages/core/src/mixins/OxyServices.auth.ts` | `getServiceToken()`, `makeServiceRequest()`, `configureServiceAuth()` |
