# @oxyhq/core

OxyHQ SDK Foundation. Platform-agnostic core library that works in Node.js, browser, and React Native environments. No React dependency.

**Current published version: 1.11.22**

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

## Exports

The package exposes three entry points:

- `@oxyhq/core` — main entry (API client, auth, models, i18n, platform, device)
- `@oxyhq/core/crypto` — cryptographic utilities (KeyManager, SignatureService, RecoveryPhraseService)
- `@oxyhq/core/shared` — shared utilities (color, theme, error, network, debug)

## Usage

```ts
import { OxyServices, oxyClient } from '@oxyhq/core';
import type { User, ApiError } from '@oxyhq/core';

// Get user
const user = await oxyClient.getUserById('123');

// Crypto
import { KeyManager, SignatureService } from '@oxyhq/core/crypto';
const keyManager = new KeyManager();
```

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
