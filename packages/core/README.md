# @oxyhq/core

OxyHQ SDK Foundation. Platform-agnostic core library that works in Node.js, browser, and React Native environments. No React dependency.

**Current published version: 3.4.11**

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
- **User identity normalization** so SDK user payloads always expose `id`

## Exports

The package exposes a single public entry point:

- `@oxyhq/core` — main entry (API client, auth, crypto, models, shared utilities, i18n, platform, device)

All public symbols (including `KeyManager`, `SignatureService`, `RecoveryPhraseService`, and the shared color / theme / error / network / debug helpers) are re-exported from the package root. There are no subpath entry points.

## Usage

```ts
import { OxyServices, oxyClient, KeyManager, SignatureService } from '@oxyhq/core';
import type { User, ApiError } from '@oxyhq/core';

// Get user
const user = await oxyClient.getUserById('123');

// Crypto
const keyManager = new KeyManager();
```

## Linked App API Clients

Apps that call their own backend should derive API clients from the active SDK
instance instead of re-implementing auth headers, session restore, CSRF fetches,
or user forwarding.

```ts
import { OxyServices } from '@oxyhq/core';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
const mentionApi = oxy.createLinkedClient({ baseURL: 'https://api.mention.earth' });

await mentionApi.post('/posts', { content: 'Hello from Oxy' });
```

Linked clients send the current Oxy bearer token for authenticated requests.
State-changing bearer requests do not fetch app-local CSRF tokens; cookie-only
writes still use CSRF.

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
