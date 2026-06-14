# CLAUDE.md

## AWS Deployment

The backend (`oxy-api`) runs on **AWS ECS Fargate** (region `eu-west-1`, cluster `oxy-cluster`), behind an ALB with ACM HTTPS.

- **Port**: `8080` | **Domain**: `api.oxy.so` (also serves `api.website.oxy.so` / `website-api.oxy.so` for the oxy.so/fairco.in website API; outbound email via SES, inbound via Cloudflare Email Routing → Worker `email-inbound` → `POST /email/inbound`)
- **Deploy**: `git push origin main` → `.github/workflows/deploy-aws.yml` builds a `linux/arm64` Docker image → pushes to ECR (`237343248947.dkr.ecr.eu-west-1.amazonaws.com/oxy/oxy-api`) → `aws ecs update-service --force-new-deployment`
- **Auth**: GitHub OIDC → role `oxy-github-deploy`. No AWS keys stored in GitHub.
- **Secrets**: GitHub Actions secrets are the source of truth. The deploy workflow syncs them to AWS SSM (`/oxy/oxy-api/*`; shared secrets to `/oxy/_shared/*`); ECS injects them into the container. To change a secret: edit it in GitHub — the next deploy applies it.
- **Empty/placeholder secret guard**: `.github/workflows/deploy-aws.yml` SKIPS syncing any secret whose value is empty or literally `-`. This is defense-in-depth after an incident (commit `641cea67`) where a `REDIS_URL=-` placeholder was synced and crash-looped `oxy-api` with `getaddrinfo ENOTFOUND -` from `ioredis`. **NEVER register a GitHub secret with a placeholder value (`-`, empty, `TODO`, etc.). If you don't have the real value yet, don't create the secret yet.**
- **SSM path convention**: per-app secrets → `/oxy/<app>/<KEY>`; shared infra (`REDIS_URL`, `AWS_*`, `LIVEKIT_*`) → `/oxy/_shared/<KEY>`. ECS task definitions reference these paths directly.
- **Dockerfile**: must build for `linux/arm64` (Graviton).
- **WARNING**: Never put secret values in this file.

## Inbound Email Path (Cloudflare → Worker → API)

Inbound mail for `*@oxy.so` is delivered as follows:

1. **MX** records for `oxy.so` point at Cloudflare Email Routing (`route1/2/3.mx.cloudflare.net`).
2. Cloudflare Email Routing has a **catch-all rule → Worker `email-inbound`** (source: `workers/email-inbound/`, zone `oxy.so` = `7f70358609578c4a1f24dbf6cb9c4498`).
3. The Worker POSTs the raw RFC 5322 message to `${API_URL}/email/inbound` with `Authorization: Bearer ${EMAIL_INBOUND_WEBHOOK_SECRET}` and `X-Envelope-From` / `X-Envelope-To` headers.
4. The API route `packages/api/src/routes/emailInbound.ts` (mounted at `/email/inbound` BEFORE `/email`, with a raw body parser registered in `server.ts:95`) parses MIME, validates recipients, spam-checks, and stores into MongoDB via `emailService.storeIncomingMessage`.
5. Inbox UI at `inbox.oxy.so` reads `GET /email/mailboxes` + `GET /email/messages`.

**Critical config invariants** — if any drifts, inbound mail silently disappears:
- Worker var `API_URL` MUST equal `https://api.oxy.so` (NOT `mail.oxy.so` — that hostname still resolves to the retired DigitalOcean droplet `159.223.227.58` and returns 502).
- Worker secret `EMAIL_INBOUND_WEBHOOK_SECRET` MUST equal SSM `/oxy/oxy-api/EMAIL_INBOUND_WEBHOOK_SECRET` (mismatch → API returns 401 → Cloudflare bounces).
- The raw body parser at `server.ts:95` MUST be registered BEFORE the global `express.json()` middleware (otherwise the JSON parser eats the RFC822 stream and `simpleParser` gets an empty Buffer).
- `app.use('/email/inbound', emailInboundRoutes)` MUST be registered BEFORE `app.use('/email', ...)` in `server.ts` (otherwise the protected `/email` mount catches the unauthenticated webhook first).

**Worker deploy (when bindings drift):**
```bash
cd workers/email-inbound
export CLOUDFLARE_API_TOKEN=$(cat ~/.config/oxy/cloudflare.token)
export CLOUDFLARE_ACCOUNT_ID=$(aws --profile oxy --region eu-west-1 ssm get-parameter --name /oxy/oxy-api/CLOUDFLARE_ACCOUNT_ID --with-decryption --query 'Parameter.Value' --output text)
./node_modules/.bin/wrangler deploy
aws --profile oxy --region eu-west-1 ssm get-parameter --name /oxy/oxy-api/EMAIL_INBOUND_WEBHOOK_SECRET --with-decryption --query 'Parameter.Value' --output text \
  | ./node_modules/.bin/wrangler secret put EMAIL_INBOUND_WEBHOOK_SECRET
```

**Verify health:**
```bash
# 1. Confirm Worker bindings
curl -s -H "Authorization: Bearer $(cat ~/.config/oxy/cloudflare.token)" \
  "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/email-inbound/settings" \
  | jq '.result.bindings'   # API_URL must be https://api.oxy.so

# 2. Confirm endpoint mounted (expect 401 = good, 404 = route gone, 500 = secret missing)
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.oxy.so/email/inbound

# 3. CloudWatch (log group is /oxy/ecs, NOT /ecs/oxy-api)
aws --profile oxy --region eu-west-1 logs tail /oxy/ecs --log-stream-name-prefix oxy-api --since 1h \
  | grep -iE 'inbound|envelope|delivered'
```

**Migration cleanup (2026-06-12):** ✅ DigitalOcean fully removed from the inbox path.
- SPF for `oxy.so` now reads `v=spf1 include:amazonses.com include:_spf.mx.cloudflare.net ~all`.
- DNS A record `mail.oxy.so` (→ `159.223.227.58`) deleted.
- Worker `email-inbound` redeployed with `API_URL=https://api.oxy.so` (ECS).
- Outbound: SES via `SMTP_RELAY_HOST` only. nodemailer v8 removed the legacy `{ direct: true }` MX path — `smtp.outbound.ts` now fails fast if `SMTP_RELAY_HOST` is unset.

## Containers (oxy-api Docker / ECS one-shot tasks)

The `oxy-api` Dockerfile uses Bun 1.3's **isolated linker** (default). Dependencies do NOT live at `/app/node_modules/<pkg>` — they live at:

```
/app/node_modules/.bun/<pkg>@<version>+<hash>/node_modules/<pkg>
```

This breaks naive `require('<pkg>')` from a `node -e` one-liner inside the container. To resolve, either:

- Run via a script file that lives inside the package's own resolution graph (where Node's normal resolution works), OR
- Use an **absolute path** to the isolated location.

**Cleaning Redis from a dev laptop**: the Valkey/Redis security group only accepts traffic from ECS task security groups, so you cannot connect from a laptop. Instead, run a one-shot Fargate task that overrides the container `command` to execute an inline cleanup. Example:

```bash
aws --profile oxy --region eu-west-1 ecs run-task \
  --cluster oxy-cluster --task-definition oxy-api --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=[subnet-0012b3093e9af9f57,subnet-09dfe34a5a68a889d],securityGroups=[sg-02137cbd3bcbe11a4],assignPublicIp=ENABLED}' \
  --overrides '{"containerOverrides":[{"name":"oxy-api","command":["sh","-c","node -e \"const Redis=require('"'"'/app/node_modules/.bun/ioredis@5.11.1+f89edaf472774726/node_modules/ioredis'"'"');/* ... */\""]}]}'
```

Look up the exact `.bun/<pkg>@<ver>+<hash>/` directory in the running image (it changes on every install) before invoking. The full path is required because the inline `-e` script is not inside any package's resolution graph.

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

## API: userCache Invalidation Rule

**Every** API route that modifies user state (`updateUserProfile`, `PATCH /privacy/:id/privacy`, `PUT /users/:userId/privacy`, etc.) MUST call `userCache.invalidate(userId)` after the write. Skipping this causes the in-memory cache to return stale pre-write data on the next `getUserBySession`, silently reverting client updates.

Every `rateLimit()` call MUST also pass a unique `prefix` (see "Rate Limiting" below) — the factory in `packages/api/src/middleware/rateLimiter.ts` enforces it as required.

## Rate Limiting (api)

All limiters use `rate-limit-redis` with a shared ioredis client. The factory `rateLimit({ windowMs, max, prefix, ... })` in `packages/api/src/middleware/rateLimiter.ts` requires a unique `prefix` per limiter instance.

**Why unique prefixes are mandatory** (commit `ef222ecc`): without a per-instance `prefix`, every `rate-limit-redis` store writes to the same default Redis key. When a request passes through the global limiter AND a route-specific limiter, the same key is incremented twice and `rate-limit-redis` throws `ERR_ERL_DOUBLE_COUNT`, halving the effective budget. Each limiter MUST own its own key namespace.

**Convention**: `rl:<scope>:` where scope identifies the limiter purpose.

**Prefixes in use:**
- `rl:general:` — global limiter (1000 / 15min)
- `rl:auth:` — broad auth routes (`authRateLimiter`, 300 / 15min)
- `rl:user:` — user routes (`userRateLimiter`, 200 / 15min)
- `rl:auth:challenge:`, `rl:auth:verify:`, `rl:auth:refresh:`, `rl:auth:lookup:`, `rl:auth:session-claim:`, `rl:auth:oauth-authorize:`, `rl:auth:oauth-token:`, `rl:auth:service-token:`
- `rl:fedcm:nonce:`
- `rl:contacts:discover:` (200 hashes/request, 5 req/min/user)
- `rl:social-auth:`
- `rl:email:inbound:`, `rl:email:proxy:`
- `rl:userdata:write:`

**General limiter threshold** (commit `641cea67`): raised 150 → **1000 / 15min**. The 150 ceiling was below a single authenticated user's normal traffic (feed scroll + socket fallback polling + profile loads + FedCM exchanges). Per-endpoint limiters (`authRateLimiter` 300, `userRateLimiter` 200, `checkLimiter` 10/min, etc.) remain the relevant defense-in-depth. **Do NOT lower the general limiter below 1000 without measuring real production traffic.**

## useCurrentUser Pattern (services)

- `queryFn` must be pure — never call `useAuthStore.setUser()` inside a `queryFn`.
- Side effects on fresh query data belong in a `useEffect` on `query.data` outside the queryFn.

## SDK Cache Sweep on Profile Writes (core)

`oxyServices.updateProfile()` calls `clearCacheByPrefix()` for:
- `GET:/session/user/`
- `GET:/users/me`
- `GET:/profiles/username/`
- The specific user id

Without this sweep the HTTP cache returns stale data and the username onboarding step loops.

## KeyManager Safety (core — critical)

- `createIdentity` / `importKeyPair` throw `IdentityAlreadyExistsError` if an identity already exists. Pass `{ overwrite: true }` to replace.
- Writes use `_persistIdentityAtomic`: backs up the EXISTING identity first, writes new primary → sign/verify probe → only then refreshes backup. A failed `createIdentity({overwrite:true})` rolls primary back to the exact prior bytes — never destroys the prior identity.
- `hasIdentity()` requires both keys present, well-formed, and matching (not just key existence).
- `verifyIdentityIntegrity()` performs a full sign/verify probe, not just byte parsing.
- `restoreIdentityFromBackup()` is transient-error-safe: a keychain-read EXCEPTION is treated as transient → refuses to clobber a healthy-but-locked primary. Dual mismatch guards prevent silently switching accounts.
- Strict hex/length/range validation on all private/public key material.
- `canonicalPrivateKey(key) = key.toLowerCase().padStart(64, '0')` applied at every `ec.keyFromPrivate(...)` callsite.
- `isValidPrivateKey` rejects degenerate scalars via `^0{56}` check (rejects `'1'`, `'2'`, etc.).
- `hasIdentity()` does NOT cache `false` on transient SecureStore errors — only stable verdicts get cached.
- `deleteIdentity` signature: `(skipBackup=false, force=false, userConfirmed=false)`. `force=true` deletes the backup slot.

## PrivacySettings Type (core)

`PrivacySettings` interface lives in `packages/core/src/models/interfaces.ts`. `updateProfile`, `getPrivacySettings`, and `updatePrivacySettings` on `OxyServices` are typed against it — no `Record<string, any>` or `Promise<any>` on the SDK surface.

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
- **Delete account flow** (`packages/accounts/lib/account/delete-account-flow.ts`): after a SUCCESSFUL `oxyServices.deleteAccount(...)`, purge local identity (primary AND backup) via `KeyManager.deleteIdentity(skipBackup=true, force=true, userConfirmed=true)` BEFORE sign-out — prevents zombie identity auto-restore. Strict order: `deleteAccount` → `purgeIdentity` (success-only, never on failure) → `signOutAll`; local-purge failure is non-fatal.
- **Font**: do NOT set `fontFamily: 'Inter-*'` — `BloomThemeProvider` sets Inter as `Text.defaultProps` globally
- **expo-router v56**: no `@react-navigation/*` direct imports; synthesize `{ type: 'OPEN_DRAWER' }` payloads inline
- **Test coverage**: 216 jest tests in accounts; 117 in core; 125 in services; 100 in api; 54 in auth-sdk; 9 in auth IdP. `bun run build:all` 8/8.
- **Username step**: use `useUpdateProfile().mutateAsync()`, NOT `oxyServices.updateProfile()` directly — gets optimistic update + cache invalidation. Stable initial value via lazy `useState` initializer (no `useEffect` reset on remount).
- **`useUpdatePrivacySettings`**: do NOT call `invalidateAccountQueries(queryClient)` in `onSuccess` (defeats optimistic merge). Use `{ ...previous, ...requested, ...incoming }` merge in `onMutate`. `onError` does targeted `invalidateQueries({ queryKey: queryKeys.privacy.settings(...) })` for reconciliation.
- **`(auth)/index.tsx` routing**: `status === 'complete'` → `/(tabs)`; `hasIdentity && status === 'in_progress'` → `/(auth)/create-identity`; blank backdrop during `status === 'checking'`. Always clean up timers from entrance animations.
- **`useOnboardingStatus` invariant**: when `isAuthenticated && user`, status is `'complete'` or `'in_progress'` regardless of storage lookup result. Re-runs `KeyManager.hasIdentity()` on `isAuthenticated` transitions to reflect a fresh sign-in's new identity.
- **Web vs native split (CRITICAL)**: Identity CREATION is NATIVE-ONLY; web is for managing an existing account (sign-in only). Web sign-in screen: `app/(auth)/sign-in.tsx` (uses `signInWithFedCM()` + `handlePopupSession()`). Web blocks identity creation via `.web.tsx` layout redirects: `app/(auth)/create-identity/_layout.web.tsx`, `import-identity/_layout.web.tsx`, `welcome.web.tsx`, `index.web.tsx` — all redirect to `/(auth)/sign-in`.
- **`useOnboardingStatus.needsAuth` is PLATFORM-AGNOSTIC** — do NOT reinstate a `Platform.OS === 'web'` clamp (caused a `(tabs)`↔`(auth)` redirect deadlock). The platform split lives in the `(auth)` entry/guards, not in `needsAuth`.
- **Shared modules** (use these, don't re-duplicate): `utils/relative-time.ts` + `hooks/useRelativeTime.ts` (i18n-aware relative time); `utils/device-utils.ts` (getDeviceIcon, getDeviceDisplayName, DeviceRecord, groupDevicesByType); `hooks/useAvatarUrl.ts`; `hooks/useDebounce.ts`; `constants/payments.ts` (FAIRCOIN_WALLET_URL); `constants/drawer-screens.ts` (typed DrawerScreenConfig[] — lives in `constants/` NOT `app/` so expo-router doesn't register it as a route); `constants/styles.ts` (`floatingPosition`: `Platform.select({ web: 'fixed', default: 'absolute' })` for floating action bar / FAB — used by `(tabs)/_layout.tsx` + `components/ui/bottom-action-bar.tsx`).
- **Shared UI components** (use these, don't re-duplicate): `components/ui/empty-state-card.tsx` — `EmptyStateCard` (icon + title + subtitle, optional `subtitleColor?`) — single shared empty-state used by security + payments sections (replaced 3 duplicated inline empty states); `components/ui/circle-icon-badge.tsx` — `CircleIconBadge` (36dp circular icon wrapper) — shared across identity cards, payments info, home actions; `components/ui/quick-action-button.tsx` — accepts `size?` prop (default 48) — reused by `bottom-action-bar` and `home-bottom-actions` (home footer no longer hand-rolls badge buttons).
- **God-screen decomposition**: section components under `components/sections/` (+ shared `GroupedItem`/`PrioritizedGroupedItem` types in `components/sections/types.ts`), `components/security/`, `components/home/`, `components/payments/`; hooks under `hooks/home/*`; identity auto-sync in `hooks/identity/useIdentitySync.ts`; pure helpers `utils/security-recommendations.ts`, `utils/payment-utils.ts`.
- **`payments.tsx`**: reads `timestamp` field (NOT `createdAt`) for payment/transaction dates.
- **Removed unused deps**: `@radix-ui/react-tabs`, `react-responsive`, `@lottiefiles/dotlottie-react-native`, `expo-symbols`. KEEP `expo-document-picker` + `expo-image-manipulator` (lazy-loaded optional peers of `@oxyhq/services`) and `@lottiefiles/dotlottie-react` (hard-required by web lottie export).

## HttpService (services)

- On React Native (Expo 56), FormData uploads route through `XMLHttpRequest` — do NOT use fetch for multipart uploads on RN (Expo 56's fetch rejects RN file descriptors).

## Offline Mutation Queue (services)

- React Query `networkMode: 'offlineFirst'` with stable `mutationKey` on all mutations
- `useMutationStatus` aggregator hook surfaces "Syncing…" indicators across the app

## Offline-First Persistence (services + auth-sdk)

- `@tanstack/react-query-persist-client` wired in both `@oxyhq/services` (AsyncStorage) and `@oxyhq/auth` (localStorage via `createSyncStoragePersister`).
- Query whitelist: `accounts`, `users`, `sessions`, `devices`, `privacy`, `payments` queries are persisted; mutations always persisted; 30-day TTL; 1s throttle; legacy v1 cache cleanup on startup.
- `OxyProvider` and `WebOxyProvider` both await `restored` before exposing the QueryClient → first paint serves cached data, not a loading spinner.
- New `useOnlineStatus()` hook in `@oxyhq/services` — built on `useSyncExternalStore` over `onlineManager`; use for offline banners in app UIs.
- TanStack Query version locked to `^5.100` across services, auth-sdk, console, test-app-expo (persist-client pins `query-core@5.100.14`).

## useSessionSocket (services + auth-sdk)

- Uses an **explicit switch with a strict whitelist**: only `session_removed`, `device_removed`, `sessions_removed` events may trigger a local sign-out.
- **Never** add an `else` / default branch that calls sign-out — unknown events log a dev warning only.
- Shape: `SessionEventType` union + `SessionUpdatePayload` interface; extracted `refreshSessionsSafe` + `triggerLocalSignOut` helpers; no `logout` prop.

## BottomSheet Gesture Patterns (services)

- `closeGenerationRef` bumped on each `open()`; every close callback captures the generation at commit time — stale callbacks from cancelled close cycles no-op.
- Body pan uses `manualActivation()` with `simultaneousWithExternalGesture(scrollViewRef)` — only activates when scroll is at top AND downward movement >8dp. Handle pan is unconditional.
- Modal contents **must** wrap children in `<GestureHandlerRootView>` — RN's `Modal` renders into its own window; the app-root GHRV does not extend into it.
- Backdrop dims proportionally with drag distance (iOS Photos pattern).
- `scrollable?: boolean` prop (default `true`). Set `false` for sheets that own a `VirtualizedList` (no internal ScrollView wrapping).
- `getSheetConfig(routeName, screenProps)` in `navigation/routes.ts` returns `{ scrollable }` per route. `FileManagement` in image-only-picker mode gets `scrollable: false`.

## PhotoPickerView (services)

Activated inside `FileManagementScreen` when `isImageOnlyPicker` is true. Apple Photos-style UI:
- Translucent top bar, full-bleed black backdrop, 3-up phone / 4-up tablet grid.
- Primary ring + spring pulse on selection; sibling dim to 0.6 opacity; numbered selection badge.
- FadeIn stagger 15ms/cell capped at 800ms; skips when `AccessibilityInfo.isReduceMotionEnabled()`.
- Non-blocking 2px upload progress in header; pull-to-refresh; haptics via dynamic `expo-haptics` import.
- Legacy file-management flow untouched.

## AvatarCropScreen (services — accounts)

- Translucent top bar (Cancel / title / primary Done CTA), full-bleed `#000` canvas.
- 3×3 thirds grid fades 800ms after gestures end; white ring; floating zoom chip during pinch.
- Entrance spring; haptics on reset / zoom limits / confirm.
- `ActivityIndicator` + "Saving…" during processing; Reset link; full a11y + `announceForAccessibility`; reduced-motion respect.
- i18n keys under `editProfile.crop.*` and `editProfile.toasts.crop*` in en-US.json + es-ES.json.

## FedCM (core + auth-sdk + services + api + packages/auth IdP)

- **`mode` enum**: interactive sign-in must use W3C-spec values `'active'` / `'passive'` (NOT the legacy `'button'` / `'widget'` — current Chrome throws `TypeError: '<x>' is not a valid enum value of type IdentityCredentialRequestOptionsMode`). The client (`OxyServices.fedcm.ts`, `useWebSSO`) sends `'active'` first and transparently retries once with the legacy value for Chrome 125–131 backwards-compat.
- **`mode` vs `mediation` are DISTINCT fields**: `mode` (`'active'`/`'passive'`) selects the FedCM UI style; `mediation` (`'silent'`/`'optional'`/`'required'`) controls the credential-chooser flow. Silent SSO sends NO `mode` field.
- **Server-minted nonce required**: token exchange requires a server-minted, origin-bound nonce. Client calls `POST /fedcm/nonce` (`mintServerNonce` / `getFedcmNonce`) before exchange. A purely local UUID nonce is rejected with `invalid_nonce`.
- **IdP server requirements** (requires redeploy of auth.oxy.so to take effect in prod): `/.well-known/web-identity` must be served as `application/json` (not octet-stream); `id_assertion_endpoint` and `disconnect` must send CORS headers (`Access-Control-Allow-Origin: <RP origin>` + `Access-Control-Allow-Credentials: true`) and enforce the `Sec-Fetch-Dest: webidentity` guard.
- **Multi-domain FAPI + cross-domain SSO — durable "Option A" architecture (2026-06-13)**: any RP CNAMEs `auth.<rp-domain>` → `oxy-auth.pages.dev`; the IdP responds with an issuer matching the RP's apex — `fedcm_session` cookie is first-party in Safari/Firefox. `resolveConfig()` in `packages/auth/server/index.ts:110` derives `fedcmIssuer` from `c.req.url` per-request; `/fedcm.json` is a dynamic handler (NOT a static asset). Live on `auth.oxy.so`, `auth.mention.earth`, `auth.alia.onl`, `auth.homiio.com`. Cold-boot restore order on web (services 8.3.x): 1. redirect-callback → 2. FedCM silent (Chrome) → 3. first-party `/auth/silent` iframe at `auth.<rp-apex>` (Safari/Firefox) → 4. cookie restore → 5. stored-session bearer → 6. `/sso` top-level bounce (terminal fallback). Step 3 runs BEFORE step 6 so reloads never flash. Native: step 5 only. Primitive: `runColdBoot` in `packages/core/src/utils/coldBoot.ts` (pure ordered short-circuit, no module-level state). `autoDetectAuthWebUrl` in `packages/core/src/utils/fapiAutoDetect.ts` (MOVED from auth-sdk) — bails on localhost/IP/IPv6/single-label/multi-part-TLD.
- **`/sso` flow (cross-apex):** `auth.oxy.so GET /sso?prompt=none&client_id=<rp-origin>&return_to=<rp>/__oxy/sso-callback&state=<s>` reads the central `fedcm_session` cookie → for a cross-apex RP does a SECOND top-level hop to `auth.<rp-apex>/sso/establish?et=<signed-establish-token>` (HS256, FEDCM_TOKEN_SECRET, short TTL, bound to purpose+host+aud). `/sso/establish` is first-party to the RP apex: verifies et → re-validates session + approved client → PLANTS host-only `fedcm_session` cookie on `auth.<rp-apex>` (survives Safari ITP / Firefox TCP) → mints opaque single-use code → bounces to `<rp>/__oxy/sso-callback#oxy_sso=ok&code=<code>&state=<s>`. RP redeems at `api.oxy.so POST /sso/exchange` (CORS, origin-bound, atomic GETDEL burn in Valkey). Subsequent reloads use the `/auth/silent` iframe at `auth.<rp-apex>` — no bounce.
- **New API SSO endpoints (oxy-api):** `POST /sso/code` (X-Oxy-Internal gated; 404 if `SSO_INTERNAL_SECRET` unset); `POST /sso/exchange` (CORS, origin-bound, atomic GETDEL). `oxy-api` ECS task-def MUST inject `SSO_INTERNAL_SECRET`, `DEVICE_ID_SALT`, and `REDIS_URL` (from `/oxy/_shared/REDIS_URL`) — all three required or SSO fails closed / crash-loop.
- **CRITICAL FIX — assertion issuer must always be central (commits 41a8feba + db91b6dd, 2026-06-13):** `mintSessionForClient` in `packages/auth/server/index.ts` MUST always build the ID-token assertion with `iss = https://auth.oxy.so`, regardless of which `auth.<apex>` served the request. Background: `resolveConfig()` sets `fedcmIssuer` per-request from `c.req.url`; on `auth.mention.earth` this becomes `https://auth.mention.earth`. The API's `POST /fedcm/exchange` validates issuer against the CENTRAL issuer only → rejected with `FedCM: Invalid issuer expected "https://auth.oxy.so" got "https://auth.mention.earth"` → `mintSessionForClient` returned null → `/sso/establish` returned `#oxy_sso=error` AND `/auth/silent` posted a null session → cross-domain sessions never survived a reload even though the cookie was correctly planted. Fix: `const CENTRAL_FEDCM_ISSUER = \`https://auth.${CENTRAL_IDP_APEX}\`` used unconditionally in `mintSessionForClient`; the per-apex issuer is STILL correct in `/.well-known/web-identity` and `/fedcm.json` (those drive the browser-native FedCM UI). NEVER re-introduce a per-apex issuer for any API-bound assertion mint. New IdP endpoints live on all 4 auth hosts. No `api.<apex>` cookie bridge — cross-domain restore comes from `auth.<apex>` only. Consumers (Mention on 8.3.1; Homiio + Alia bumping) must be on `@oxyhq/services ≥8.3.1` + `@oxyhq/core ≥2.2.1`.
- **FEDCM_ISSUER env var override gotcha (CRITICAL)**: `resolveConfig()` accepts `FEDCM_ISSUER` as an explicit override (for local dev and tests where `c.req.url` is `http://localhost:<port>`). If this env var is set in **Cloudflare Pages production** for `oxy-auth`, it pins every host to the same issuer and breaks multi-domain FAPI silently — the well-known and fedcm.json will return the pinned hostname regardless of which `auth.<rp>` the browser hit. **Rule**: NEVER set `FEDCM_ISSUER` on the `oxy-auth` Pages project. If you see all custom-domain hosts reporting the same `provider_urls`, check the Pages prod env vars first.
- **Silent SSO run-once guard — LIVES IN CONSUMERS, NOT core**: A module-level `silentSignInWithFedCM()` singleton in `@oxyhq/core` was tried and reverted — it re-evaluates in the Metro web bundle (same hazard the accounts `metro.config.js` `resolveRequest` block mitigates), so the guard did not hold across page navigations. The guard now lives in each consumer:
  - `useWebSSO` in **both** `@oxyhq/services` and `@oxyhq/auth` owns a module-level `silentSSOAttempted` Set + `ssoSignature(origin|baseURL)` key for cross-mount deduplication, plus a per-instance `hasCheckedRef` fast-path to skip redundant renders within the same mount.
  - `WebOxyProvider` keeps its own `fedcmSilentSignInAttempted` guard (keyed `origin+baseURL`) because its silent path also runs `oxyServices.silentSignIn()` (iframe/popup fallback, i.e. the `/auth/silent` iframe step).
  - **Do NOT move this guard back into a core module-level singleton** — it re-evaluates in the Metro web bundle and the guard won't hold. Keep it in the consumer hooks/provider.
- **`runColdBoot` primitive** (`packages/core/src/utils/coldBoot.ts`): pure ordered short-circuit runner; steps `{id, enabled?, run}`; first step returning `'session'` wins. Used by both `WebOxyProvider` (`@oxyhq/auth`) and `OxyContext` (`@oxyhq/services`) for unified cold boot. No module-level state (silent-SSO guard stays in consumers).

## Sign-In Token Planting

`@oxyhq/core` `OxyServices.verifyChallenge()` now calls `setTokens(accessToken, refreshToken ?? '')` internally before returning — matching the behaviour of `claimSessionByToken`. Consumers (including `services` `useAuthOperations.performSignIn`) no longer need to hand-plant the token or fall back to the bearer-protected `getTokenBySession` after `verifyChallenge`. Just await `verifyChallenge` and proceed; the SDK has already planted the token.

**Token-less new-identity onboarding**: the 401 fix (avoiding bearer-protected `getTokenBySession` for a brand-new identity that has no session yet) is preserved — `verifyChallenge`'s internal `setTokens` call handles it.

## New React Query Hooks (@oxyhq/services — exported from package root)

`useUserSubscription`, `useUserPayments`, `useUserWallet`, `useUserWalletTransactions`, `useAccountStorageUsage` — with typed returns (`Subscription`, `Payment`, `Wallet`, `WalletTransaction` in `ui/hooks/queries/paymentTypes.ts`). `payments` + `storage` query-key namespaces added; `payments` whitelisted for offline persistence.

## Bloom Worklets Safety (@oxyhq/bloom)

- BottomSheet pan context must use a **primitive** `SharedValue` (`contextY = useSharedValue(0)`), NEVER an object-valued SharedValue — object SharedValues mutated inside worklets crash under `react-native-worklets@0.8.3` (`removeListener` on UI thread).
- `hooks/mergeRefs.ts` returns a plain `(instance: T|null) => void` (not `React.RefCallback`) so the ref stays assignable across duplicate `@types/react` copies (RN 0.85 / React 19).

## Published Package Versions

| Package | Version | Notes |
|---------|---------|-------|
| `@oxyhq/core` | **2.2.1** | 2.2.1: durable cross-domain SSO (Option A `/sso/establish` second hop). 2.1.2: OxyServices constructor auto-detects `auth.<apex>` from `window.location` (critical for apps passing their own instance, e.g. Mention). 2.1.1: CrossDomainAuth logs via logger. 2.1.0: `runColdBoot` + `autoDetectAuthWebUrl` moved into core from auth-sdk |
| `@oxyhq/auth` | **3.3.0** | 3.3.0: `/sso/establish` handoff + per-apex `fedcm_session` cookie planting; `mintSessionForClient` assertion issuer forced to `https://auth.oxy.so` (commits 41a8feba + db91b6dd). 3.2.0: `WebOxyProvider` consumes core `runColdBoot` + `autoDetect`; `fapiAutoDetect` deleted from auth-sdk; guard key `origin\|baseURL`; init-effect `.catch` hardening. 3.1.0: multi-domain FAPI auto-detect. 3.0.0: major bump |
| `@oxyhq/services` | **8.3.1** | 8.3.1: durable cross-domain cold boot — per-apex `/auth/silent` iframe tried BEFORE `/sso` bounce (reloads never flash); full order: redirect-callback → FedCM silent → `/auth/silent` iframe → cookie → stored-session → `/sso` bounce. 8.2.0: FedCM-first cross-domain cold boot via `runColdBoot`; iframe `/auth/silent` fallback (Safari/Firefox); constructor/provider auto-detect; native = stored-session only; IdP poller force-logs-out only on same-site IdP. 8.1.1: removed legacy `@react-navigation/native` peer. 8.0.1: fixed `expo-crypto` shim |
| `@oxyhq/bloom` | **0.6.14** | RN-0.85 line |

### Breaking changes in `@oxyhq/services` 8.x

**`@tanstack/*` moved from `dependencies` → `peerDependencies`** (commit `e3c0e8e9`). Consumers (RN/Expo apps) MUST add to their own `dependencies`:

- `@tanstack/react-query ^5.100.0`
- `@tanstack/react-query-persist-client ^5.100.0`
- `@tanstack/query-async-storage-persister ^5.100.0`

Web-only optional peer (declared in `peerDependenciesMeta`):

- `@tanstack/query-sync-storage-persister ^5.100.0`

**Reason**: an SDK that ships TanStack Query as a hard `dependency` creates a second `QueryClient` instance when the consumer app also imports `@tanstack/react-query`, breaking cache sharing. **Rule**: never declare in the SDK's `dependencies` any library where a duplicated instance would break the consumer (TanStack Query, OxyServices itself, React, etc.) — use peerDependencies.

**`RouteName` union (BottomSheet routes)**: `'AccountSettings'` and `'AccountCenter'` were unified into a single `'ManageAccount'` route. The screen `ManageAccountScreen` replaces the old `AccountOverview` + `AccountSettings` pair. Migrate any consumer calls:

```diff
- showBottomSheet?.('AccountSettings')
- showBottomSheet?.('AccountCenter')
+ showBottomSheet?.('ManageAccount')
```

### `expo-crypto` shim (services 8.0.1)

The real Expo SDK 56 API is `randomUUID()`, NOT `getRandomUUID()`. Validated against `node_modules/expo-crypto/build/Crypto.d.ts:67` (`export declare function randomUUID(): string;`). The shim at `packages/services/src/types/expo-crypto.d.ts` previously declared the wrong name and was fixed in commit `34773e8c`.

**Rule**: whenever you author a `.d.ts` shim for a dynamic-imported module (`await import('<pkg>')`), validate every declared name against a real consumer's `node_modules/<pkg>/build/*.d.ts`. TypeScript will accept a wrong-named shim silently — the failure only shows up at runtime as `TypeError: undefined is not a function`.

External consumers (Mention, Allo, Homiio, TNP) should bump to the versions above.

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
- `POST /fedcm/nonce` — mint a server-bound nonce before FedCM token exchange (required; local UUID nonces rejected)

**FedCM IdP server (packages/auth/server):**
- `/.well-known/web-identity` MUST be served as `application/json`
- `id_assertion_endpoint` and `disconnect` MUST include CORS headers (`Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials: true`) and enforce `Sec-Fetch-Dest: webidentity` guard
- **`/auth/silent`**: reads first-party `fedcm_session` cookie on `auth.<apex>`, mints Oxy access token via FedCM assertion pipeline server-side (assertion issuer ALWAYS `https://auth.oxy.so`), returns HTML that `postMessage`s `{type:'oxy_silent_auth', session, nonce}` to allow-listed `client_id` origin ONLY (NEVER `targetOrigin='*'`). Enables Safari/Firefox cross-domain restore without a top-level bounce.
- **`/auth/session-check`**: validates `fedcm_session` cookie; used by RP to check IdP session before attempting silent flow.
- **`GET /sso`**: central SSO initiator. Reads central `fedcm_session` cookie; for cross-apex RPs performs a second top-level hop to `auth.<rp-apex>/sso/establish?et=<signed-token>`.
- **`GET /sso/establish`**: runs on per-apex host (CNAMEd to oxy-auth). Verifies signed establish-token, re-validates session, PLANTS `fedcm_session` cookie first-party on `auth.<rp-apex>`, mints single-use code, bounces to `<rp>/__oxy/sso-callback`. **`mintSessionForClient` here MUST use the central issuer** — per-apex issuer causes API to reject the assertion (see CRITICAL FIX above).
- IdP worker MUST deploy as `_worker.js` (full `bun run build`). Static-only deploy returns 405 on all dynamic routes.
- NEVER set `FEDCM_ISSUER` env var on the `oxy-auth` CF Pages project — pins all hosts to the same issuer, silently breaks multi-domain FAPI.
- Changes require a redeploy of auth.oxy.so to take effect in production
