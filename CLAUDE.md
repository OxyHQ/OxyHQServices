# CLAUDE.md

## AWS Deployment

The backend (`oxy-api`) runs on **AWS ECS Fargate** (region `eu-west-1`, cluster `oxy-cluster`), behind an ALB with ACM HTTPS.

- **Port**: `8080` | **Domain**: `api.oxy.so` (also serves `api.website.oxy.so` / `website-api.oxy.so` for the oxy.so/fairco.in website API; outbound email via SES, inbound via Cloudflare Email Routing → Worker `email-inbound` → `POST /email/inbound`)
- **Deploy**: `git push origin main` → `.github/workflows/deploy-aws.yml` builds a `linux/arm64` Docker image → pushes to ECR (`237343248947.dkr.ecr.eu-west-1.amazonaws.com/oxy/oxy-api`) → `aws ecs update-service --force-new-deployment`
- **Auth**: GitHub OIDC → role `oxy-github-deploy`. No AWS keys stored in GitHub.
- **Secrets**: GitHub Actions secrets are the source of truth. The deploy workflow syncs them to AWS SSM (`/oxy/oxy-api/*`; shared secrets to `/oxy/_shared/*`); ECS injects them into the container. To change a secret: edit it in GitHub — the next deploy applies it.
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
- **Silent SSO run-once guard — LIVES IN CONSUMERS, NOT core**: A module-level `silentSignInWithFedCM()` singleton in `@oxyhq/core` was tried and reverted — it re-evaluates in the Metro web bundle (same hazard the accounts `metro.config.js` `resolveRequest` block mitigates), so the guard did not hold across page navigations. The guard now lives in each consumer:
  - `useWebSSO` in **both** `@oxyhq/services` and `@oxyhq/auth` owns a module-level `silentSSOAttempted` Set + `ssoSignature(origin|baseURL)` key for cross-mount deduplication, plus a per-instance `hasCheckedRef` fast-path to skip redundant renders within the same mount.
  - `WebOxyProvider` keeps its own `fedcmSilentSignInAttempted` guard (keyed `origin+baseURL`) because its silent path also runs `oxyServices.silentSignIn()` (iframe/popup fallback).
  - **Do NOT move this guard back into a core module-level singleton** — it re-evaluates in the Metro web bundle and the guard won't hold. Keep it in the consumer hooks/provider.

## Sign-In Token Planting

`@oxyhq/core` `OxyServices.verifyChallenge()` now calls `setTokens(accessToken, refreshToken ?? '')` internally before returning — matching the behaviour of `claimSessionByToken`. Consumers (including `services` `useAuthOperations.performSignIn`) no longer need to hand-plant the token or fall back to the bearer-protected `getTokenBySession` after `verifyChallenge`. Just await `verifyChallenge` and proceed; the SDK has already planted the token.

**Token-less new-identity onboarding**: the 401 fix (avoiding bearer-protected `getTokenBySession` for a brand-new identity that has no session yet) is preserved — `verifyChallenge`'s internal `setTokens` call handles it.

## New React Query Hooks (@oxyhq/services — exported from package root)

`useUserSubscription`, `useUserPayments`, `useUserWallet`, `useUserWalletTransactions`, `useAccountStorageUsage` — with typed returns (`Subscription`, `Payment`, `Wallet`, `WalletTransaction` in `ui/hooks/queries/paymentTypes.ts`). `payments` + `storage` query-key namespaces added; `payments` whitelisted for offline persistence.

## Bloom Worklets Safety (@oxyhq/bloom)

- BottomSheet pan context must use a **primitive** `SharedValue` (`contextY = useSharedValue(0)`), NEVER an object-valued SharedValue — object SharedValues mutated inside worklets crash under `react-native-worklets@0.8.3` (`removeListener` on UI thread).
- `hooks/mergeRefs.ts` returns a plain `(instance: T|null) => void` (not `React.RefCallback`) so the ref stays assignable across duplicate `@types/react` copies (RN 0.85 / React 19).

## Published Package Versions (as of 2026-05-30)

| Package | Version | Notes |
|---------|---------|-------|
| `@oxyhq/core` | **1.11.22** | `verifyChallenge` plants tokens; silent-SSO guard reverted to consumers |
| `@oxyhq/services` | **6.10.6** | `useWebSSO` owns module-level `silentSSOAttempted` Set + per-instance `hasCheckedRef` |
| `@oxyhq/auth` | **2.0.9** | `useWebSSO` owns module-level `silentSSOAttempted` Set + per-instance `hasCheckedRef` |
| `@oxyhq/bloom` | **0.6.7** | RN-0.85 line; monorepo override pins `^0.6.7` |

External consumers (Mention, Allo, Homiio, TNP) should bump to these versions.

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
- Changes require a redeploy of auth.oxy.so to take effect in production
