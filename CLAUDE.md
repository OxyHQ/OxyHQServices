# CLAUDE.md

## Commands

```bash
npm run build -w @oxyhq/core     # Build @oxyhq/core
npm run build -w @oxyhq/auth     # Build @oxyhq/auth
npm run build -w @oxyhq/services # Build @oxyhq/services
npm run build:all                # Build all (order: core -> auth -> services -> rest)
npm run test                     # Run all workspace tests
npm run dev                      # Dev mode across workspaces
npm install                      # Install all workspace deps
```

## Architecture

Monorepo (`@oxyhq/sdk`) using npm workspaces. Build order matters: `core` -> `auth` -> `services` -> rest.

```
packages/
  core/           @oxyhq/core       Platform-agnostic foundation (zero React/RN)
  auth-sdk/       @oxyhq/auth       Web auth SDK (React hooks, zero RN/Expo)
  services/       @oxyhq/services   Expo/React Native SDK (UI, screens, native features)
  api/            @oxyhq/api        Express.js backend API
  accounts/                         Expo accounts app
  auth/                             Next.js auth app (standalone, FedCM IdP)
  test-app/                         Expo test/playground app
  test-app-vite/                    Vite test app (web-only, uses @oxyhq/core + @oxyhq/auth)
```

**Dependency graph:**
```
@oxyhq/core           no internal deps
@oxyhq/auth           peer: @oxyhq/core, react
@oxyhq/services       dep: @oxyhq/core
accounts              dep: @oxyhq/core + @oxyhq/services
test-app              dep: @oxyhq/services
test-app-vite         dep: @oxyhq/core + @oxyhq/auth
```

## Package Boundaries (strict)

- **@oxyhq/core** must never import `react`, `react-native`, or `expo-*`. Dynamic imports (`await import(...)`) for optional RN modules are allowed.
- **@oxyhq/auth** must never import `react-native` or `expo-*`. Dynamic import of `@react-native-async-storage/async-storage` is the only exception.
- **@oxyhq/services** does NOT re-export from `@oxyhq/core`. Consumers import core types directly from `@oxyhq/core`.

## ESM/CJS Compatibility (critical)

Both `@oxyhq/core` and `@oxyhq/auth` ship dual CJS + ESM builds. The ESM build **must not contain `require()` calls** — Vite and other ESM-only bundlers will crash.

- **Never** use `require()` in `packages/core/` or `packages/auth-sdk/` source code
- Use `import ... from` for static imports (JSON files, modules)
- Use `await import(moduleName)` for optional/platform-specific modules (e.g. expo-crypto)
- Guard any unavoidable `require()` with `typeof require !== 'undefined'`
- For platform-specific crypto: use `isReactNative()` → expo-crypto, `isNodeJS()` → node crypto, else → Web Crypto API

## Import Conventions

```typescript
// Next.js / Vite (web)
import { OxyServices } from '@oxyhq/core';
import type { User, ApiError } from '@oxyhq/core';
import { WebOxyProvider, useAuth } from '@oxyhq/auth';

// Expo / React Native
import { OxyProvider, useOxy, OxySignInButton } from '@oxyhq/services';
import type { User } from '@oxyhq/core';
import { KeyManager } from '@oxyhq/core';
```

When splitting imports: use `import type` for type-only imports, regular `import` for values.

## Coding Standards

- TypeScript strict mode across all packages
- Biome for linting (`biome lint --error-on-warnings`)
- No backward-compatibility re-exports — clean imports only
- No unnecessary abstractions or over-engineering
- `packages/core/` and `packages/auth-sdk/` build with `tsc` (CJS + ESM + types -> `dist/`)
- `packages/services/` builds with `react-native-builder-bob` (-> `lib/`)

## Key Entry Points

- `packages/core/src/index.ts` — all public core exports
- `packages/auth-sdk/src/index.ts` — all public auth exports
- `packages/auth-sdk/src/WebOxyProvider.tsx` — web auth context provider
- `packages/services/src/index.ts` — RN-specific exports only
- `packages/services/src/ui/context/OxyContext.tsx` — React Native auth context
- `packages/services/src/ui/components/OxyProvider.tsx` — RN provider component

## Service Tokens (Internal Service-to-Service Auth)

Internal Oxy ecosystem apps authenticate via short-lived service JWTs (OAuth2 Client Credentials pattern).

**Flow:**
1. Register a `DeveloperApp` with `isInternal: true` (DB-only, not via API)
2. Service exchanges `apiKey` + `apiSecret` → `POST /api/auth/service-token` → 1h JWT
3. Service uses JWT as `Authorization: Bearer <token>` + `X-Oxy-User-Id: <userId>` for delegation
4. `@oxyhq/core` `auth()` middleware recognizes `type: 'service'` JWTs (stateless, no session DB lookup)

**Key files:**
- `packages/api/src/routes/auth.ts` — `POST /auth/service-token` endpoint
- `packages/api/src/models/DeveloperApp.ts` — `isInternal` field
- `packages/core/src/mixins/OxyServices.utility.ts` — `auth()` service token handling, `serviceAuth()` middleware
- `packages/core/src/mixins/OxyServices.auth.ts` — `getServiceToken()`, `makeServiceRequest()`, `configureServiceAuth()`

**Usage in consuming services:**
```typescript
import { OxyServices } from '@oxyhq/core';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
oxy.configureServiceAuth('oxy_dk_...', 'secret...');

// Auto-cached, auto-refreshed service token
const token = await oxy.getServiceToken();

// Or use makeServiceRequest for delegation
const result = await oxy.makeServiceRequest('POST', '/some/endpoint', data, userId);
```

**Middleware for protecting internal endpoints:**
```typescript
// Only allows service tokens (rejects user JWTs and API keys)
app.use('/internal', oxy.serviceAuth());
```

## Terminology

- **OxyServices** — main API client class (in core)
- **OxyProvider** — React Native context provider (in services)
- **WebOxyProvider** — Web React context provider (in auth)
- **useOxy** — RN auth hook (services), **useWebOxy** — web auth hook (auth)
- **Bottom sheet** — native modal navigation system in services (29+ screens)
