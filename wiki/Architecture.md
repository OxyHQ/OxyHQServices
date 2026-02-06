# Architecture

## Monorepo Structure

OxyHQ Services is an npm workspaces monorepo (`@oxyhq/sdk`). All packages live under `packages/`.

```
packages/
  core/           @oxyhq/core       Platform-agnostic foundation (zero React/RN)
  auth-sdk/       @oxyhq/auth       Web auth SDK (React hooks, zero RN/Expo)
  services/       @oxyhq/services   Expo/React Native SDK (UI, screens, native)
  api/            @oxyhq/api        Express.js backend API
  auth/                             Next.js auth app (FedCM IdP)
  accounts/                         Expo accounts app
  inbox/                            Inbox app
  console/                          Admin console
  test-app-expo/                    Expo test/playground app
  test-app-vite/                    Vite test app (web-only)
```

## Dependency Graph

```
@oxyhq/core           no internal deps
@oxyhq/auth           peer: @oxyhq/core, react
@oxyhq/services       dep: @oxyhq/core
accounts              dep: @oxyhq/core + @oxyhq/services
test-app-expo         dep: @oxyhq/services
test-app-vite         dep: @oxyhq/core + @oxyhq/auth
```

## Package Boundaries (strict)

| Package | Cannot import |
|---------|---------------|
| `@oxyhq/core` | `react`, `react-native`, `expo-*` (dynamic imports for optional RN modules allowed) |
| `@oxyhq/auth` | `react-native`, `expo-*` (exception: dynamic import of `@react-native-async-storage/async-storage`) |
| `@oxyhq/services` | Does NOT re-export from `@oxyhq/core` — consumers import core types directly |

## ESM/CJS Dual Build

Both `@oxyhq/core` and `@oxyhq/auth` ship CJS + ESM builds. The ESM build **must never contain `require()` calls** — Vite and other ESM-only bundlers will crash.

Rules:
- Never use `require()` in `packages/core/` or `packages/auth-sdk/`
- Use `import ... from` for static imports
- Use `await import(moduleName)` for optional/platform-specific modules
- Guard unavoidable `require()` with `typeof require !== 'undefined'`

## Build Tooling

| Package | Build tool | Output |
|---------|-----------|--------|
| `@oxyhq/core` | `tsc` | CJS + ESM + types -> `dist/` |
| `@oxyhq/auth` | `tsc` | CJS + ESM + types -> `dist/` |
| `@oxyhq/services` | `react-native-builder-bob` | -> `lib/` |
| `@oxyhq/api` | `tsc` | -> `dist/` |

## Key Entry Points

| File | Purpose |
|------|---------|
| `packages/core/src/index.ts` | All public core exports |
| `packages/auth-sdk/src/index.ts` | All public auth exports |
| `packages/auth-sdk/src/WebOxyProvider.tsx` | Web auth context provider |
| `packages/services/src/index.ts` | RN-specific exports only |
| `packages/services/src/ui/context/OxyContext.tsx` | React Native auth context |
| `packages/services/src/ui/components/OxyProvider.tsx` | RN provider component |

## Import Conventions

```typescript
// Next.js / Vite (web)
import { OxyServices } from '@oxyhq/core';
import type { User, ApiError } from '@oxyhq/core';
import { WebOxyProvider, useAuth } from '@oxyhq/auth';

// Expo / React Native
import { OxyProvider, useOxy, OxySignInButton } from '@oxyhq/services';
import type { User } from '@oxyhq/core';
```

Use `import type` for type-only imports, regular `import` for values.

## Terminology

| Term | Meaning |
|------|---------|
| **OxyServices** | Main API client class (in core) |
| **OxyProvider** | React Native context provider (in services) |
| **WebOxyProvider** | Web React context provider (in auth) |
| **useOxy** | RN auth hook (services) |
| **useWebOxy** | Web auth hook (auth) |
| **Bottom sheet** | Native modal navigation system in services (29+ screens) |
