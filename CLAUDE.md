# CLAUDE.md

## Custom Agents

Use these agents for all implementation work:
- `oxy-core` — @oxyhq/core: OxyServices client, mixins, crypto, types. NEVER import react/RN/expo.
- `oxy-auth` — auth-sdk + auth app: FedCM, service tokens, sessions, 2FA. NEVER import RN/expo.
- `oxy-api` — API backend: routes, models, services (email, billing, federation, S3, MongoDB)
- `oxy-frontend` — Frontend apps: accounts (MyAccount), console (Cloud), inbox (Email), auth (FedCM IdP)
- `oxy-services` — @oxyhq/services: Expo/RN components, screens, bottom sheets
- `mention-fixer` — Cross-stack debugging (Mention ↔ Oxy)
- `git-ops` — Git commit, push, merge operations

## Commands

```bash
bun run core:build               # Build @oxyhq/core
bun run auth:build               # Build @oxyhq/auth
bun run services:build           # Build @oxyhq/services
bun run build:all                # Build all (order: core -> auth -> services -> rest)
bun run test                     # Run all workspace tests
bun run dev                      # Dev mode across workspaces
bun install                      # Install all workspace deps
```

## Architecture

Monorepo (`@oxyhq/sdk`) using Bun workspaces + Turbo. Build order matters: `core` -> `auth` -> `services` -> rest.

```
packages/
  core/           @oxyhq/core       Platform-agnostic foundation (zero React/RN)
  auth-sdk/       @oxyhq/auth       Web auth SDK (React hooks, zero RN/Expo)
  services/       @oxyhq/services   Expo/React Native SDK (UI, screens, native features)
  api/            @oxyhq/api        Express.js backend API
  accounts/                         Expo accounts app
  auth/                             Vite auth app (standalone, FedCM IdP)
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
- `packages/core/src/utils/avatarUtils.ts` — shared avatar visibility logic (platform-agnostic)
- `packages/core/src/utils/accountUtils.ts` — shared account helpers (`buildAccountsArray`, `createQuickAccount`)
- `packages/core/src/utils/displayUtils.ts` — `getAccountDisplayName`, `getAccountFallbackHandle`, `formatPublicKeyHandle` (canonical display, falls back to `Account 0x12345678…`)
- `packages/core/src/mixins/OxyServices.contacts.ts` — `contacts.discoverContacts(hashedEmails, hashedPhones)` privacy-first contact discovery
- `packages/auth-sdk/src/index.ts` — all public auth exports
- `packages/auth-sdk/src/WebOxyProvider.tsx` — web auth context provider
- `packages/services/src/index.ts` — RN-specific exports only; includes `LogoIcon`, `LogoText`
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

## KeyManager Safety (core — critical)

- `createIdentity` / `importKeyPair` throw `IdentityAlreadyExistsError` if an identity already exists. Pass `{ overwrite: true }` to replace.
- Writes use `_persistIdentityAtomic`: backup written first, primary second, followed by a sign/verify probe. Rolls back to backup on failure.
- `hasIdentity()` requires both keys present, well-formed, and matching (not just key existence).
- `verifyIdentityIntegrity()` performs a full sign/verify probe, not just byte parsing.
- `restoreIdentityFromBackup()` refuses to clobber a healthy primary or switch users (mismatched backup rejected).
- Strict hex/length/range validation on all private/public key material.

## Contact Discovery (api + core)

- Endpoint: `POST /contacts/discover` — accepts `{ hashedEmails: string[], hashedPhones: string[] }` (SHA-256 on client before sending; no PII stored server-side)
- Rate limited: 200 hashes per request, 5 requests/min/user
- Core mixin: `oxy.contacts.discoverContacts(hashedEmails, hashedPhones)`
- `User` model has `hashedEmail`, `hashedPhone`, `phone` fields; `hashedEmail` / `hashedPhone` auto-computed via pre-validate hook

## Accounts App Patterns (packages/accounts)

- **i18n**: `LocaleProvider` + `useTranslation` hook in `packages/accounts/lib/i18n/`; 11 locales (EN + ES fully populated); device locale via `Intl.DateTimeFormat().resolvedOptions().locale` (no `expo-localization` native module needed)
- **Typed routes**: `typedRoutes: true` in `app.json` — all `router.push()` calls must use typed path strings, no `as any` casts
- **Error boundaries**: at root, `(tabs)`, and `(auth)` layout levels using an `ErrorFallback` component
- **Activity History**: `/(tabs)/activity.tsx` using `GET /security/activity` with infinite scroll
- **Recovery phrase**: mandatory acknowledgement screen at `/(auth)/create-identity/recovery-phrase` before identity creation completes; persistent reminder in Security screen until acknowledged
- **Delete account**: `delete-account.tsx` — signed deletion + `KeyManager.hasIdentity()` pre-flight + username confirmation
- **Font**: do NOT set `fontFamily: 'Inter-*'` — `BloomThemeProvider` sets Inter as `Text.defaultProps` globally
- **expo-router v56**: no `@react-navigation/*` direct imports; synthesize `{ type: 'OPEN_DRAWER' }` payloads inline
- **Test coverage**: 142 jest tests in accounts; 64 in core; 39 in api

## HttpService (services)

- On React Native (Expo 56), FormData uploads route through `XMLHttpRequest` — do NOT use fetch for multipart uploads on RN (Expo 56's fetch rejects RN file descriptors).

## Offline Mutation Queue (services)

- React Query `networkMode: 'offlineFirst'` with stable `mutationKey` on all mutations
- `useMutationStatus` aggregator hook surfaces "Syncing…" indicators across the app

## Terminology

- **OxyServices** — main API client class (in core)
- **OxyProvider** — React Native context provider (in services)
- **WebOxyProvider** — Web React context provider (in auth)
- **useOxy** — RN auth hook (services), **useWebOxy** — web auth hook (auth)
- **Bottom sheet** — native modal navigation system in services (29+ screens)
- **LogoIcon / LogoText** — Bloom-themed logo exports from `@oxyhq/services`

## Auth App (packages/auth)

Standalone Vite app for authentication flows (sign in, sign up, authorize, recover, FedCM IdP).

**Key patterns:**
- `AuthFormLayout` + `AuthFormHeader` — shared layout for all auth screens
- `AuthLayout` (route layout) — persistent logo/footer, route-level fade transitions via `useNavigationType()`
- Login form multi-step: identifier → password → 2FA, with per-step animations
- `applyColorPreset()` from `lib/bloom-css.ts` — applies user's Bloom color theme to CSS vars on `:root`
- `OxyServices.lookupUsername()` — lightweight user lookup for login flow (validates existence + gets color)
- Zod schemas in `lib/schemas.ts` for API response validation
- Shared types in `lib/types.ts`

**Anti-patterns to avoid:**
- No `useEffect` for syncing props to state — derive from props during render
- No `useEffect` for firing toasts — call `toast()` directly in event handlers
- No `useEffect` for focus — use `requestAnimationFrame` in event handlers
- No `Suspense` wrappers unless using `React.lazy()` or `use()`
- No render-body side effects — use `useEffect` for `window.location.href`, or `<Navigate>` from react-router

**API endpoints used:**
- `GET /auth/lookup/:username` — lightweight username lookup (exists, color, avatar, displayName)
- `POST /auth/login` — password login
- `POST /auth/2fa/verify` — 2FA verification
- `POST /auth/signup` — account creation
- `POST /auth/recover/*` — password recovery flow
- `GET /users/me` — current session check
