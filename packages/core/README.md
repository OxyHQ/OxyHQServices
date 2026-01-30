# @oxyhq/core

OxyHQ SDK Foundation. Platform-agnostic core library that works in Node.js, browser, and React Native environments. No React dependency.

## Installation

```bash
npm install @oxyhq/core
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
npm run build
```

Compiles with TypeScript, producing CJS, ESM, and type declaration outputs.
