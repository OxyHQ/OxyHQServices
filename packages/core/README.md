# @oxyhq/core

OxyHQ SDK Foundation. Platform-agnostic core library that works in Node.js, browser, and React Native environments. No React dependency.

**Current published version: 3.4.16**

## Installation

```bash
bun add @oxyhq/core
```

## Contents

- **OxyServices API client** — all API methods for interacting with OxyHQ services
- **AuthManager, CrossDomainAuth** — authentication and cross-domain session handling
- **Crypto** — KeyManager, SignatureService, RecoveryPhraseService
- **Models and types** — User, ApiError, ClientSession, and more
- **i18n** — translate function and locale files
- **Shared utilities** — color, theme, error, network, debug helpers
- **Platform detection utilities**
- **Device management**
- **Linked clients** for app backends that need the active Oxy bearer token
- **User identity contracts and handle normalization** so SDK user payloads expose required `id`/`displayName` fields and apps build local/federated profile handles consistently
- **Server middleware** for Express request identity and per-user rate limiting

## Exports

The package exposes two public entry points:

- `@oxyhq/core` — main entry (API client, auth, crypto, models, shared utilities, i18n, platform, device)
- `@oxyhq/core/server` — Express-only helpers (`createOxyRateLimit`, `createOxyAuthMiddleware`, `requireOxyAuth`, `getOxyUserId`, `getRequiredOxyUserId`, and request types)

All client/runtime symbols (including `KeyManager`, `SignatureService`, `RecoveryPhraseService`, and the shared color / theme / error / network / debug helpers) are re-exported from the package root. Server-only Express helpers live under `@oxyhq/core/server` so React Native and browser bundles never import Express.

## Usage

```ts
import { OxyServices, oxyClient, KeyManager, SignatureService } from '@oxyhq/core';
import type { User, ApiError } from '@oxyhq/core';

// Get user
const user = await oxyClient.getUserById('123');

// Crypto
const keyManager = new KeyManager();
```

## User Identity And Handles

SDK user payloads may arrive with either `id` or Mongo-style `_id`; normalize
them before exposing state to apps:

```ts
import { getNormalizedUserId, normalizeUserIdentity } from '@oxyhq/core';

const id = getNormalizedUserId(user);
const normalizedUser = normalizeUserIdentity(user);
```

`User.displayName` is a required API contract. The API composes it server-side
from the structured name when present, otherwise from the username/server
fallback. UI consumers should render `displayName` directly instead of rebuilding
names from `name.first`, `name.last`, `name.full`, or `username`.

For profile display/routing, use `getNormalizedUserHandle()`. It strips a
leading `@`, preserves an existing `user@instance` handle, and appends
`instance`/`federation.domain` only for federated users:

```ts
import { getNormalizedUserHandle } from '@oxyhq/core';

getNormalizedUserHandle({ username: 'alice' }); // "alice"
getNormalizedUserHandle({ username: 'alice', isFederated: true, instance: 'example.social' }); // "alice@example.social"
```

## Linked App API Clients

Apps that call their own backend can derive API clients from the active SDK
instance to reuse base URL handling, caching, request queues, retry behavior, and
CSRF handling without re-implementing HTTP plumbing.

```ts
import { OxyServices } from '@oxyhq/core';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
const mentionApi = oxy.createLinkedClient({ baseURL: 'https://api.mention.earth' });

await mentionApi.client.post('/posts', { content: 'Hello from Oxy' });
```

Linked clients only share the current Oxy bearer token with same-origin Oxy API
clients. Different app/backend origins are left unauthenticated so first-party
Oxy session tokens are not disclosed to relying-party backends. Cookie-only
writes still use CSRF.

## Backend Auth Middleware

Backends should use the SDK server helpers instead of local auth request types
or `requireAuth` copies.

```ts
import { OxyServices } from '@oxyhq/core';
import {
  createOxyRateLimit,
  requireOxyAuth,
  getRequiredOxyUserId,
  type OxyAuthRequest,
} from '@oxyhq/core/server';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

app.use(createOxyRateLimit(oxy, { store: redisStore }));
router.use(requireOxyAuth);

router.get('/me', (req: OxyAuthRequest, res) => {
  const userId = getRequiredOxyUserId(req);
  res.json({ userId });
});
```

For routers that are not mounted after `createOxyRateLimit`, use
`createOxyAuthMiddleware(oxy)` to resolve the bearer session and require a user
in one middleware.

## User Identity Normalization

`@oxyhq/core` normalizes user payloads returned by auth and user APIs so `id` is
always present when `_id` is the only identifier provided by the backend.
Consumers should compare `user.id` for ownership and permissions instead of
using backend-specific fields.

## Build

```bash
bun run build
```

Compiles with TypeScript, producing CJS, ESM, and type declaration outputs.

## KeyManager Safety

- `_persistIdentityAtomic` backs up the EXISTING identity before any overwrite, writes the new primary, runs a sign/verify probe, then refreshes the backup. A failed `createIdentity({overwrite:true})` rolls the primary back to the exact prior bytes — prior identity is never destroyed.
- `restoreIdentityFromBackup()` treats keychain-read exceptions as transient — never clobbers a healthy-but-locked primary. Rejects mismatched backups (dual mismatch guards).
- `deleteIdentity(skipBackup=false, force=false, userConfirmed=false)` — `force=true` also deletes the backup slot.

## FedCM (`OxyServices.fedcm.ts`)

- Use W3C-spec `mode` enum: `'active'` / `'passive'`. Do NOT use legacy `'button'` / `'widget'` (Chrome throws TypeError).
- Client sends `'active'` first, transparently retries with legacy value for Chrome 125–131 backwards compat.
- Token exchange requires a server-minted nonce from `POST /fedcm/nonce` — local UUID nonces are rejected.
- **Silent SSO guard is NOT here**: a module-level singleton in core was tried and reverted — it re-evaluates in the Metro web bundle so the guard did not hold. The guard lives in the consumer hooks (`useWebSSO` in `@oxyhq/services` and `@oxyhq/auth`) and in `WebOxyProvider`. Do NOT move it back into a core module-level singleton.

## `verifyChallenge` Token Planting

`OxyServices.verifyChallenge()` calls `setTokens(accessToken, refreshToken ?? '')` internally before returning. Callers do not need to plant tokens manually after `verifyChallenge` — the SDK handles it.
