# Architecture

## Monorepo Structure

OxyHQ Services is a Bun workspaces monorepo (`@oxyhq/sdk`) built with Turbo. All packages live under `packages/`.

```
packages/
  contracts/      @oxyhq/contracts   Contract-first API schemas (Zod, zero React/RN)
  protocol/       @oxyhq/protocol    Signed-record envelope, canonical JSON, platform crypto
  core/           @oxyhq/core        Platform-agnostic foundation (zero React/RN)
  services/       @oxyhq/services    The single UI SDK — Expo, React Native, and web (RN Web)
  expo-splash/    @oxyhq/expo-splash Shared native-splash toolkit for Oxy Expo apps
  api/            @oxyhq/api         Express.js backend API
  node/           @oxyhq/node        Self-hostable personal data node
  auth/                              auth.oxy.so — OAuth authorize/consent IdP (Vite + RN Web)
  accounts/                          Accounts by Oxy (management-only Expo app)
  commons/                           Commons by Oxy (native-only identity vault)
  inbox/                             Inbox app
  console/                           Developer console (Application registry)
  test-app-expo/                     Expo test/playground app
```

There is no separate web-only auth SDK package — web apps consume `@oxyhq/services` via React Native Web, so every platform shares one provider (`OxyProvider`) and one auth UI.

## Dependency Graph

```
@oxyhq/contracts      no internal deps (only zod)
@oxyhq/protocol       dep: @oxyhq/contracts
@oxyhq/core           dep: @oxyhq/contracts + @oxyhq/protocol
@oxyhq/services       dep: @oxyhq/core + @oxyhq/contracts
@oxyhq/api            dep: @oxyhq/contracts + @oxyhq/core (server middleware) + @oxyhq/protocol
@oxyhq/node           dep: @oxyhq/contracts + @oxyhq/core + @oxyhq/protocol
accounts / commons / inbox / console  dep: @oxyhq/services + @oxyhq/core
auth (IdP)            dep: @oxyhq/services (device-first cold boot — same as every Oxy app)
```

## Package Boundaries (strict)

| Package | Cannot import |
|---------|---------------|
| `@oxyhq/contracts` | `react`, `react-native`, `expo-*` — only `zod` |
| `@oxyhq/core` | `react`, `react-native`, `expo-*` (dynamic imports for optional RN modules allowed) |
| `@oxyhq/services` | Does NOT re-export from `@oxyhq/core` or `@oxyhq/contracts` — consumers import those directly |
| `@oxyhq/api` | Schemas from `@oxyhq/contracts` directly; server auth helpers from `@oxyhq/core/server` only |

## Auth / Session (device-first)

- The server-side `DeviceSession` (collection `devicesessions`: `deviceId`, `accounts[]`, `activeAccountId`, `revision`) is the single session authority; clients read/mutate it via `/session/device/{state,add,switch,signout}`.
- Every mutation broadcasts a token-free `session_state` event to the Socket.IO room `device:<deviceId>` — all apps on one device sync instantly.
- `SessionClient` (`packages/core/src/session/`) owns the client half; `OxyProvider` (`@oxyhq/services`) wires it up with a registered `clientId`. Apps implement no local session restore.
- Interactive sign-in is the in-app `OxyAccountDialog` (Commons QR / password). Cold boot never redirects to a login page.
- Third-party apps use standard OAuth 2.0 + PKCE via `auth.oxy.so` — see `docs/auth/integration-guide.md`. Device-session details: `docs/auth/device-session.md`.

## ESM/CJS Dual Build

`@oxyhq/core` ships CJS + ESM builds. The ESM build **must never contain `require()` calls** — Vite and other ESM-only bundlers will crash.

Rules:
- Never use `require()` in `packages/core/`
- Use `import ... from` for static imports
- Use `await import(moduleName)` for optional/platform-specific modules
- Guard unavoidable `require()` with `typeof require !== 'undefined'`

## Build Tooling

| Package | Build tool | Output |
|---------|-----------|--------|
| `@oxyhq/contracts` | `tsc` | CJS + ESM + types -> `dist/` |
| `@oxyhq/core` | `tsc` | CJS + ESM + types -> `dist/` |
| `@oxyhq/services` | `react-native-builder-bob` | -> `lib/` |
| `@oxyhq/api` | `tsc` | -> `dist/` |

## Key Entry Points

| File | Purpose |
|------|---------|
| `packages/contracts/src/index.ts` | All public contract exports (schemas, helpers, types) |
| `packages/core/src/index.ts` | All public core exports |
| `packages/core/src/session/` | `SessionClient` + device-session projection/state |
| `packages/core/src/server/index.ts` | `@oxyhq/core/server` Express helpers |
| `packages/services/src/index.ts` | All public services exports |
| `packages/services/src/ui/context/OxyContext.tsx` | Auth provider + `useOxy()` (web + native) |
| `packages/services/src/ui/context/oxyContextTypes.ts` | `OxyContextState`, `PasswordSignInResult`, provider props |
| `packages/services/src/ui/context/useOxyAccountGraph.ts` | Account graph hook (`accounts`, `switchToAccount`, …) |
| `packages/services/src/ui/navigation/accountDialogManager.ts` | Imperative `openAccountDialog` / `closeAccountDialog` |
| `packages/services/src/ui/components/OxyProvider.tsx` | Provider component (all platforms) |

## Import Conventions

```typescript
// All React platforms (Expo, React Native, web via RN Web)
import { OxyProvider, useOxy, useAuth, OxySignInButton } from '@oxyhq/services';
import type { User } from '@oxyhq/core';

// Server / Node
import { OxyServices } from '@oxyhq/core';
import { createOxyAuthMiddleware, getRequiredOxyUserId } from '@oxyhq/core/server';
```

Use `import type` for type-only imports, regular `import` for values.

## Terminology

| Term | Meaning |
|------|---------|
| **OxyServices** | Main API client class (in core) |
| **OxyProvider** | The single React context provider (in services; all platforms) |
| **SessionClient** | Device-session engine in core; consumed by OxyProvider |
| **useOxy / useAuth** | Auth hooks (services) |
| **OxyAccountDialog** | The single account switcher + sign-in surface (Bloom Dialog) |
| **OxySignInButton** | "Sign in with Oxy" button — dialog for official apps, OAuth redirect for third party |
| **OxyConsentScreen** | The IdP consent surface (rendered by auth.oxy.so) |
