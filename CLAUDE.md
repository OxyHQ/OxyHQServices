# CLAUDE.md

## Commands

```bash
npm run build:all                # Build all (order: core -> auth -> services -> rest)
npm run core:build               # Build @oxyhq/core
npm run auth:build               # Build @oxyhq/auth
npm run services:build           # Build @oxyhq/services
npm run test                     # Run all workspace tests
npm run dev                      # Dev mode across workspaces
npm install                      # Install all workspace deps
```

## Architecture

Monorepo (`@oxyhq/sdk`) using npm workspaces. Build order matters: `core` -> `auth` -> `services` -> rest.

```
packages/
  core/        @oxyhq/core       Platform-agnostic foundation (zero React/RN)
  auth-sdk/    @oxyhq/auth       Web auth SDK (React hooks, zero RN/Expo)
  services/    @oxyhq/services   Expo/React Native SDK (UI, screens, native features)
  api/         @oxyhq/api        Express.js backend API
  accounts/                      Expo accounts app
  auth/                          Next.js auth app (standalone)
  test-app/                      Expo test/playground app
```

**Dependency graph:**
```
@oxyhq/core           no internal deps
@oxyhq/auth           peer: @oxyhq/core, react
@oxyhq/services       dep: @oxyhq/core
accounts              dep: @oxyhq/core + @oxyhq/services
test-app              dep: @oxyhq/services
```

## Package Boundaries (strict)

- **@oxyhq/core** must never import `react`, `react-native`, or `expo-*`. Dynamic imports (`await import(...)`) for optional RN modules are allowed.
- **@oxyhq/auth** must never import `react-native` or `expo-*`. Dynamic import of `@react-native-async-storage/async-storage` is the only exception.
- **@oxyhq/services** does NOT re-export from `@oxyhq/core`. Consumers import core types directly from `@oxyhq/core`.

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

## Terminology

- **OxyServices** — main API client class (in core)
- **OxyProvider** — React Native context provider (in services)
- **WebOxyProvider** — Web React context provider (in auth)
- **useOxy** — RN auth hook (services), **useWebOxy** — web auth hook (auth)
- **Bottom sheet** — native modal navigation system in services (29+ screens)
