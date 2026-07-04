# AGENTS.md

## AWS Deployment

The backend (`oxy-api`) runs on **AWS ECS Fargate** (region `us-west-2`, cluster `oxy-cluster`), behind an ALB with ACM HTTPS.

- **Port**: `8080` | **Domain**: `api.oxy.so` (also serves `api.website.oxy.so` / `website-api.oxy.so` for the oxy.so/fairco.in website API; outbound email via SES, inbound via Cloudflare Email Routing → Worker `email-inbound` → `POST /email/inbound`)
- **Deploy**: `git push origin main` → `.github/workflows/deploy-aws.yml` builds a `linux/arm64` Docker image → pushes to ECR (`237343248947.dkr.ecr.us-west-2.amazonaws.com/oxy/oxy-api`) → `aws ecs update-service --force-new-deployment`
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
export CLOUDFLARE_ACCOUNT_ID=$(aws --profile oxy --region us-west-2 ssm get-parameter --name /oxy/oxy-api/CLOUDFLARE_ACCOUNT_ID --with-decryption --query 'Parameter.Value' --output text)
./node_modules/.bin/wrangler deploy
aws --profile oxy --region us-west-2 ssm get-parameter --name /oxy/oxy-api/EMAIL_INBOUND_WEBHOOK_SECRET --with-decryption --query 'Parameter.Value' --output text \
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
aws --profile oxy --region us-west-2 logs tail /oxy/ecs --log-stream-name-prefix oxy-api --since 1h \
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
aws --profile oxy --region us-west-2 ecs run-task \
  --cluster oxy-cluster --task-definition oxy-api --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=[subnet-0012b3093e9af9f57,subnet-09dfe34a5a68a889d],securityGroups=[sg-02137cbd3bcbe11a4],assignPublicIp=ENABLED}' \
  --overrides '{"containerOverrides":[{"name":"oxy-api","command":["sh","-c","node -e \"const Redis=require('"'"'/app/node_modules/.bun/ioredis@5.11.1+f89edaf472774726/node_modules/ioredis'"'"');/* ... */\""]}]}'
```

Look up the exact `.bun/<pkg>@<ver>+<hash>/` directory in the running image (it changes on every install) before invoking. The full path is required because the inline `-e` script is not inside any package's resolution graph.

**GOTCHA — oxy-api Dockerfile: do NOT switch to a full-workspace frozen-lockfile install (PR #261):** The Dockerfile intentionally installs only the lean `core+contracts+api` workspace subset (workspaces-narrowing `node -e` + `bun install`). A full-workspace `bun install --frozen-lockfile` pulls `esbuild` (a frontend-only dep) whose arm64/alpine postinstall hard-fails with `Expected "0.27.2" but got "0.25.12"`, breaking the prod Docker build. A proper fix requires a SCOPED frozen install (`--filter` the api/core/contracts closure so `esbuild` is never materialized) or a single-esbuild-version root override, validated on a real arm64 build. Do NOT apply a naive full-workspace frozen install to the API Dockerfile.

## Commands

```bash
bun run core:build               # Build @oxyhq/core
bun run auth:build               # Build @oxyhq/auth
bun run services:build           # Build @oxyhq/services
bun run build:all                # Build all (order: contracts -> core -> auth -> services -> rest)
bun run test                     # Run all workspace tests (Jest via turbo — see note below)
bun run dev                      # Dev mode across workspaces
bun install                      # Install all workspace deps
```

**Test runners — per-package split (CRITICAL):**
- `@oxyhq/api`, `@oxyhq/core`, `@oxyhq/services`, `@oxyhq/auth` (auth-sdk), `@oxyhq/contracts` use **Jest** (ts-jest). Their `test` script invokes `jest`.
- `packages/auth` (the standalone Vite IdP app) uses **Bun's native `bun test`** — configured via `packages/auth/bunfig.toml` (`[test] preload`), NOT jest. Its `test` script is `bun test server/__tests__ lib/__tests__ components/__tests__`.
- THE RULE: always run each package's OWN `bun run test` script, which dispatches to the correct runner. At the monorepo root, `bun run test` delegates through turbo and is safe. NEVER blanket-invoke `bun test` across the monorepo — it runs Bun's native runner over the Jest packages, producing ~32 false failures in core and ~81 in api (`jest.resetModules`, `jest.advanceTimersByTimeAsync`, and other Jest APIs are unavailable under Bun's runner). Do NOT assume all packages are Jest — the auth app (`packages/auth`) is bun-test.
- **Per-package baselines are STALE post-wave-2** (the device-first cutover deleted whole FedCM/SSO/refresh-all test suites and added new device-first ones — the old counts (core 623, api 997, auth-sdk 86, services 178, auth IdP 10, commons 336, contracts 81) no longer reflect reality). Do not treat any specific number here as current; run each package's own `bun run test` and read its own summary instead of comparing against a hardcoded figure.

## Architecture

Monorepo (`@oxyhq/sdk`) using Bun workspaces + Turbo. Build order matters: `contracts` -> `core` -> `auth` -> `services` -> rest (turbo derives this from the dependency graph).

```
packages/
  contracts/      @oxyhq/contracts  Contract-first API schemas (Zod) — zero React/RN/Expo
  core/           @oxyhq/core       Platform-agnostic foundation (zero React/RN)
  auth-sdk/       @oxyhq/auth       Web auth SDK (React hooks, zero RN/Expo)
  services/       @oxyhq/services   Expo/React Native SDK (UI, screens, native features)
  api/            @oxyhq/api        Express.js backend API
  accounts/                         Expo accounts app ("Accounts by Oxy" — keyless, management-only)
  commons/                          Expo identity vault app ("Commons by Oxy" — NATIVE-ONLY, no web build)
  auth/                             Vite auth app (standalone, third-party OAuth IdP + device-account chooser)
  test-app/                         Expo test/playground app
  test-app-vite/                    Vite test app (web-only, uses @oxyhq/core + @oxyhq/auth)
```

**Dependency graph:**
```
@oxyhq/contracts      no internal deps (only zod)
@oxyhq/core           dep: @oxyhq/contracts
@oxyhq/auth           peer: @oxyhq/core, react; dep: @oxyhq/contracts
@oxyhq/services       dep: @oxyhq/core + @oxyhq/contracts
@oxyhq/api            dep: @oxyhq/contracts + @oxyhq/core/server for auth middleware
accounts              dep: @oxyhq/core + @oxyhq/services
commons               dep: @oxyhq/core + @oxyhq/services  (NATIVE-ONLY — no web build/CF Pages)
test-app              dep: @oxyhq/services
test-app-vite         dep: @oxyhq/core + @oxyhq/auth
```

## Package Boundaries (strict)

- **@oxyhq/contracts** must never import `react`, `react-native`, or `expo-*`. Only `zod` allowed. Platform-agnostic — both server and client import from it directly.
- **@oxyhq/core** must never import `react`, `react-native`, or `expo-*`. Dynamic imports (`await import(...)`) for optional RN modules are allowed. Direct deps include `tldts` (Public Suffix List, used in `fapiAutoDetect.ts`).
- **@oxyhq/auth** must never import `react-native` or `expo-*`. Dynamic import of `@react-native-async-storage/async-storage` is the only exception.
- **@oxyhq/services** does NOT re-export from `@oxyhq/core` or `@oxyhq/contracts`. Consumers import core types directly from `@oxyhq/core` and API contract types directly from `@oxyhq/contracts`.
- **@oxyhq/api** imports schemas directly from `@oxyhq/contracts`. Server auth helpers come from `@oxyhq/core/server` only; do NOT route contracts through `@oxyhq/core` re-exports.

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

## User Identity Contract

- Oxy API owns `name.displayName` for user/profile DTOs. `composeDisplayName` (`packages/api/src/utils/displayName.ts`) returns a real name (explicit displayName or composed first/last) or `undefined` — it does NOT fall back to username, publicKey, or `'Anonymous'`. `formatUserNameResponse` omits `displayName` when there is no real name.
- `@oxyhq/contracts` owns both the formatted user response contract and `UserProfileUpdate`. `@oxyhq/core`, `@oxyhq/services`, and `@oxyhq/api` import those types directly from `@oxyhq/contracts`; do not re-export them through another package.
- `@oxyhq/core` public `User.name.displayName` is **optional** (`string | undefined`). Consumers render `name.displayName` when present; **when absent, fall back to the handle** via `getNormalizedUserHandle` from `@oxyhq/core`. The pattern is `displayName ?? handle` — a single handle fallback. Do NOT rebuild multi-field chains (`displayName || first || username...`). The account-switcher helper `getAccountDisplayName` (local account surfaces only) keeps its own chain.
- **Display name character policy** (`cleanDisplayName`): allows letters (`\p{L}`) + marks (`\p{M}`) + spaces + apostrophe only; strips emoji, symbols, `:shortcode:`, digits, hyphens, dots, AND orphaned combining marks (a mark not attached to a base letter). Native writes reject 400; federated names are stripped on ingest; existing records were backfilled by a one-shot script that has since run in prod and been removed.
- **Auth gate relaxation (originally 2026-06-29; the specific FedCM-era `OxyServices.sso.ts`/`sso.controller.ts` files this predated no longer exist post-wave-2):** every current sign-in/session-parsing path (`OxyServices.auth.ts`, the device-first bootstrap/exchange responses, `formatUserResponse`) requires a structured `name` object but treats `displayName` within it as optional — never require a non-empty `displayName` string as a session-validity gate. Do NOT re-tighten this.
- Profile handle normalization belongs in `@oxyhq/core` (`packages/core/src/utils/userHandle.ts`). Consumers must use `getNormalizedUserHandle` for local/federated routes instead of local route helpers or manual domain concatenation.

## Auth / Session Contract

**Device-first session model (wave 2, 2026-07).** FedCM, the `/sso` bounce, the `/auth/silent` iframe, `AuthManager`, `CrossDomainAuth`, and the `fedcm_session`/`oxy_rt_*` cookies were deleted from the client, server, and IdP entirely. Session restore is now anchored on a durable, first-party `oxy_device` cookie (`HttpOnly`, `Domain=.oxy.so`, 400-day sliding) plus a persisted, per-origin rotating refresh-token family. See `docs/SESSION-ARCHITECTURE.md` and `docs/auth/README.md` for the full mechanism.

Frontend RP apps use the SDK as the only session authority:
- Web uses `WebOxyProvider` from `@oxyhq/auth` with a registered `clientId`.
- Expo/RN uses `OxyProvider` from `@oxyhq/services` with a registered `clientId`.
- The SDK's device-first cold boot (`runSessionColdBoot` in `@oxyhq/core`, `packages/core/src/boot/coldBootV2.ts`) is the SOLE implementation both providers call — there is no separate web/native chain to keep in sync. Order: `bootstrap-return` (consume a `#oxy_boot` fragment) → `stored-tokens` (warm-plant or rotate via `POST /auth/refresh-token`) → `shared-key-signin` (native only) → `bootstrap-hop` (web: same-apex inline `POST /auth/device/web-session` fetch every boot; cross-apex ONE top-level hop, ever, per browser+origin, to the API's own `GET /auth/device/bootstrap` — a single canonical host, never a per-apex `auth.<rp-apex>` CNAME) → signed out. It NEVER auto-redirects to a login page.
- Interactive sign-in is an **in-app SDK modal** — `useAuth().signIn()` just opens it (password+2FA via `POST /auth/login` + `POST /security/2fa/verify-login`, or the "Sign in with Oxy" QR/Commons handoff). It never navigates to `auth.oxy.so`. Apps do not implement local session restore or sign-in screens.
- No per-app `/__oxy/sso-callback` routes or bespoke boot-fragment handling — the SDK owns `#oxy_boot` parsing universally.
- No copied device-first helpers in consumers. The boot-fragment schema/parser, device cookie contracts, and storage keys live once in `@oxyhq/core`.
- Private app calls wait for SDK readiness: native (`@oxyhq/services`) `useAuth().canUsePrivateApi` / `useAuth().isPrivateApiPending`; web (`@oxyhq/auth`) `useAuth().isLoading` / `useAuth().isReady` (there is no separate `canUsePrivateApi` on the web provider — `isAuthenticated` only flips once cold boot has resolved and a token is planted).
- App backend clients use `oxyServices.createLinkedClient({ baseURL })`. Do not add app-local token providers, Axios/fetch auth interceptors, manual `Authorization` header plumbing, refresh-cookie retries, or local invalidation.

Backend APIs use `@oxyhq/core/server` for request identity and security:
- Mount `createOxyRateLimit(oxy)` near the top of the Express app when Oxy-aware rate limiting is needed.
- Use `createOptionalOxyAuth(oxy)` for optional identity, `createOxyAuthMiddleware(oxy)` / `requireOxyAuth` for private routes, and `getRequiredOxyUserId(req)` for required user identity.
- Use `authSocket` for Socket.IO/WebSocket auth. ALWAYS derive rooms from `socket.user.id` — never from client-supplied room IDs. Add ownership checks before joining session/conversation rooms.
- Use `safeFetch(url, opts)` for any fetch of user-supplied URLs (SSRF prevention — DNS-pinned lookup, private-IP denylist, bounded redirects).
- Use `createOxyCors({ appOrigins, allowCredentials })` for CORS (deny-by-default, auto-allows `*.oxy.so`; NEVER wildcard+credentials).
- **Loopback dev origins are trusted on the credentialed CORS lane in ALL environments, including production (owner-approved posture):** `http://localhost`, `http://127.0.0.1`, and `http://[::1]` on ANY port are allowed to make credentialed/state-changing requests against `api.oxy.so`, so a developer's local dev server (Expo web, Vite, etc.) can hit prod. Implemented via one shared predicate, `isLoopbackOrigin(origin)` in `packages/api/src/utils/origin.ts` (http-only, any/no port, fails closed), wired into both `dynamicOriginRegistry.getCorsDecision` (loopback wins over the third-party non-credentialed lane) and `allowedOrigins.isAllowedOrigin` (also gates the CSRF Origin guard + Socket.IO). Do NOT gate this on `NODE_ENV`, do NOT hardcode a single port, and do NOT extend it to `https://localhost` — the accepted exposure is a malicious process on the developer's own loopback riding their oxy.so cookies, since remote sites cannot forge `Origin`.
- Use `verifySecret(provided, expected)` for secret/token equality (constant-time, never `!==`).
- NEVER do `new Model(req.body)` or spread `req.body` into `findByIdAndUpdate` — resolve owner ids server-side via `getRequiredOxyUserId` and use an explicit field whitelist (mass-assignment IDOR).
- Do not define local `AuthRequest`, `requireAuth`, `getUserId`, `getAuthenticatedUserId`, bearer parsers, or token-decoding auth middleware in apps. Missing shared behavior belongs in `@oxyhq/core/server`.
- Bearer-authenticated writes do not fetch app-local CSRF tokens. CSRF remains for ambient cookie credentials and cookie-only writes.

`packages/auth` / `auth.oxy.so` is now a **third-party OAuth authorize/consent IdP** (login/signup/authorize/recover/settings SPA + OAuth consent), not the session authority for first-party apps — it must not use `WebOxyProvider` or RP cold boot (there is no `/sso`/FedCM loop left to create a circularity with; that machinery is gone, not replaced by an equivalent self-referential path). Its account-chooser feed (`GET /api/device-accounts`, a Hono worker at `packages/auth/server`) reads the shared `oxy_device` cookie first-party and forwards it to the API's internal `POST /auth/device/resolve` under an `X-Oxy-Internal` secret. Trust for auto-approving OAuth consent is registry-based (`Application.isOfficial`/`isInternal`/`type`, staff-controlled via `isTrustedApplication()` in `packages/api/src/utils/trustedApplication.ts`), not domain-based.

## Coding Standards

- TypeScript strict mode across all packages
- Biome for linting (`biome lint --error-on-warnings`)
- No backward-compatibility re-exports — clean imports only
- No unnecessary abstractions or over-engineering
- `packages/core/` and `packages/auth-sdk/` build with `tsc` (CJS + ESM + types -> `dist/`)
- `packages/services/` builds with `react-native-builder-bob` (-> `lib/`)
- **Concurrent session ownership (CRITICAL):** when multiple agents or sessions may be editing `packages/api` simultaneously, CONFIRM sole ownership of shared backend files before writing. PATH-SCOPE all git adds (e.g. `git add packages/api/src/routes/civic.ts`) — NEVER `git add -A` or `git add .` in a shared package while another session may have uncommitted work. Incident: a concurrent session's uncommitted federation work was nearly swept into an unrelated commit.
- **Lockfiles before push (any repo):** after any dependency/version bump, run `bun install` to regenerate `bun.lock` and verify `bun install --frozen-lockfile` passes (CI's exact gate) BEFORE pushing — commit the lockfile in the SAME commit as the `package.json` change. A desynced lockfile red-fails CI and blocks deploys. When bumping a dep across multiple repos, do this per-repo.

## @oxyhq/contracts — Contract-First API Schemas

Package: `packages/contracts` → `@oxyhq/contracts`. SINGLE SOURCE OF TRUTH for API request/response contracts.

**What it contains:**
- Zod schemas: `userNameSchema` (`displayName` field is optional — `z.string().optional()`), `userResponseSchema` (includes `did?` + `verifiedDomains?`), `userProfileUpdateSchema`, `currentUserResponseSchema`, `deviceSessionAccountSchema`, `deviceSessionsResponseSchema`
- **Device-first schemas (`src/deviceBoot.ts`, wave 2):** `deviceBootReasonSchema`, `deviceBootFragmentSchema`, `deviceExchangeRequestSchema`, `tokenRefreshRequestSchema`, `tokenRefreshResponseSchema`, `deviceTokenIssueResponseSchema`, `deviceResolveRequestSchema`, `deviceResolveResponseSchema` + inferred types `DeviceBootReason`, `DeviceBootFragment`, `DeviceTokenIssueResponse`, `DeviceResolveRequest`, `DeviceResolveAccount`, `DeviceResolveResponse`. The `refreshAllAccountSchema`/`refreshAllResponseSchema` schemas and `RefreshAllAccountResponse`/`RefreshAllResponseContract` types were REMOVED (contracts 0.10.0) — do not reference them; they backed the deleted `/auth/refresh-all` endpoint.
- **Identity schemas (`src/identity.ts`):** `didDocumentSchema` (+ `verificationMethodSchema`, `didServiceSchema`), `signedRecordEnvelopeSchema`, `verifiedDomainSchema` + domain-request/instructions schemas, `authMethodsResponseSchema` (extended with `did` + per-method `verificationMethodId`), `exportBundleSchema`
- Helpers: `resolveUserId`, `safeParseContract`
- Inferred types: `UserNameResponse` (explicit `interface`; `displayName` is **`string | undefined`** — optional; prior to being made explicit it degraded to `{}` under `moduleResolution: node`), `UserResponse`, `UserProfileUpdate`, `CurrentUserResponseContract`, `DeviceSessionAccountResponse`, `DeviceSessionsResponseContract`; identity types: `DidDocument`, `VerificationMethod`, `DidService`, `SignedRecordEnvelope`, `VerifiedDomain`, `AuthMethodsResponse`, `ExportBundle`
- **`src/civic.ts`** — civic/Oxy ID schemas: `publicCardSchema`, `idPayloadSchema`, `attestQrPayloadSchema`, `validationVoteSchema`, `personhoodSchema`, `credentialSchema` + inferred types. Consumed as `workspace:*` by `packages/api`, `packages/core`, and `packages/services`. **NOT yet published to npm** — keep as internal `workspace:*` until Fases 0–4 are fully deployed and stable.

**Build:** dual CJS+ESM+types via tsc (same pattern as core: `tsconfig.{cjs,esm,types}.json` + `scripts/fix-esm-imports.mjs`). Zero runtime deps except `zod`.

**Dockerfile:** both builder and production stages MUST include `packages/contracts`: COPY the directory, build it before core/api, copy its `dist` into the production stage. Any future workspace package consumed by oxy-api MUST be added to the Dockerfile the same way or `bun install` in the ECS image fails to resolve `workspace:*`.

**Rule:** new shared API contracts go in `@oxyhq/contracts`. Server validates output against them; clients validate input and derive `z.infer<>` types. This prevents the Zod-drift class of bug (field-shape mismatch causing `safeParse` to silently return null and the auth app to show logged-out state). Do NOT re-introduce local schema copies in `packages/auth/lib/schemas.ts` — use `@oxyhq/contracts` directly or keep schemas strictly in sync.

**CI / test build-order — resolve workspace deps from source (CRITICAL):**
`.github/workflows/ci.yml` job `api-test` runs `bun install` then `bun run test` in `packages/api` — it does NOT build workspace deps first. `@oxyhq/contracts` and `@oxyhq/core` ship compiled, so tests importing them fail in CI with `Cannot find module` unless mapped to source. Fixed by resolving both from their TypeScript source in test configs:
- **api (Jest):** `moduleNameMapper` in `packages/api/jest.config.js` → `'^@oxyhq/contracts$': '<rootDir>/../contracts/src/index.ts'` and `'^@oxyhq/core/server$': '<rootDir>/../core/src/server/index.ts'` (the latter added because `@oxyhq/api` now imports `safeFetch`/`SsrfRejection` from `@oxyhq/core/server` for federation and email SSRF fixes — PRs #259/#264/#266).
- **auth (bun test):** `mock.module('@oxyhq/contracts', …)` in `packages/auth/lib/__tests__/setup-contracts-source.ts`, loaded first via `packages/auth/lib/__tests__/preload.ts` (mirrors the existing `mock.module` pattern in `lib/__tests__/setup-mocks.ts` for `@oxyhq/bloom/avatar`).

RULE: any package whose tests import a build-required workspace dep (`@oxyhq/contracts`, `@oxyhq/core/server`, etc.) MUST either map that dep to `src/` in the test config (Jest `moduleNameMapper` or bun-test `mock.module` preload) OR the CI job must build the dep first. The contracts source uses extensionless relative imports (`from './userResponse'`), which work under both ts-jest and bun's resolver.

**api BUILD now pre-builds `@oxyhq/core` (source change):** `packages/api/package.json` build script is `bun run --filter @oxyhq/contracts build && bun run --filter @oxyhq/core build && tsc`. This is required because `@oxyhq/api` imports `@oxyhq/core/server` (safeFetch, SsrfRejection) — without the core `dist/`, tsc fails TS2307 and downstream TS18046. The federation (`federation.service.ts`) and email (`email.service.ts`) services now route outbound fetches of user/remote-supplied URLs through `safeFetch` (https-only + streaming byte caps) instead of hand-rolled DNS checks.

Build-vs-source distinction: production/Docker consumes the built `dist/` (the Dockerfile builds `packages/contracts` then `packages/core` before `packages/api`); tests consume the TS source via the mappings above. Both are intentional.

## Key Entry Points

- `packages/contracts/src/index.ts` — all public contract exports (schemas, helpers, types)
- `packages/core/src/index.ts` — all public core exports
- `packages/core/src/utils/avatarUtils.ts` — shared avatar visibility logic (platform-agnostic)
- `packages/core/src/utils/accountUtils.ts` — shared account/device helpers (`buildAccountsArray`, `createQuickAccount`, `getAccountDisplayName`, `getAccountFallbackHandle`, `formatPublicKeyHandle`) for non-DTO local account surfaces only; app/user DTO display names come from API `name.displayName`.
- `packages/core/src/mixins/OxyServices.contacts.ts` — `contacts.discoverContacts(hashedEmails, hashedPhones)` privacy-first contact discovery
- `packages/core/src/mixins/OxyServices.workspaces.ts` — `workspaces` mixin (CRUD + members + transfer); `Workspace`/`WorkspaceMember` types
- `packages/core/src/mixins/OxyServices.applications.ts` — `getApplications(workspaceId?)` + `getPublicApplication(clientId)`; `PublicApplication` type
- `packages/core/src/server/index.ts` — public `@oxyhq/core/server` exports
- `packages/core/src/server/auth.ts` — `createOptionalOxyAuth`, `createOxyAuthMiddleware`, `requireOxyAuth`, `getRequiredOxyUserId`
- `packages/core/src/server/rateLimit.ts` — `createOxyRateLimit`
- `packages/core/src/server/safeFetch.ts` — `safeFetch(url, opts)`, `assertSafePublicUrl` (SSRF-safe fetch; DNS-pinned, private-IP denylist, bounded redirects, Bun `{all:true}` lookup-array contract)
- `packages/core/src/server/cors.ts` — `createOxyCors({ appOrigins, allowCredentials })` (deny-by-default allowlist, auto-allows `*.oxy.so`, NEVER wildcard+credentials)
- `packages/core/src/server/verifySecret.ts` — `verifySecret(provided, expected)` (constant-time `crypto.timingSafeEqual` + length guard)
- `packages/core/src/mixins/OxyServices.reputation.ts` — `reputation` mixin (14 methods, fully typed); 20 exported types (see "Oxy Trust" section)
- `packages/core/src/crypto/canonicalJson.ts` — `canonicalize(value)` (recursive key-sort/JCS-style canonical JSON) + `signedRecordSigningInput`; used by both client signing and server verify
- `packages/core/src/mixins/OxyServices.identity.ts` — `identity` mixin: `resolveDid`, `getMyDid`, `listAuthMethods`, `linkIdentityKey`, `unlinkAuthMethod`, `linkPassword`, `signRecord`, `publishRecord`, `getRecord`, `verifyRecord`, `exportMyData`, `requestDomainVerification`, `verifyDomain`, `listDomains`, `removeDomain`
- `packages/core/src/mixins/OxyServices.civic.ts` — `civic` mixin: `getPublicCard`, `getMyIdPayload`, `parseIdPayload`, `buildAttestQrPayload`, `parseAttestPayload`, `submitRealLifeAttestation`, `getValidatorInbox`, `submitValidationVote`, `denyValidation`, `vouchForPerson`, `withdrawVouch`, `getPersonhood`, `getMyPersonhood`, `issueCredential`, `listCredentials`, `listMyCredentials`, `verifyCredential`, `revokeCredential`
- `packages/auth-sdk/src/index.ts` — all public auth exports
- `packages/auth-sdk/src/WebOxyProvider.tsx` — web auth context provider
- `packages/services/src/index.ts` — RN-specific exports only; includes `LogoIcon`, `LogoText`
- `packages/services/src/ui/context/OxyContext.tsx` — React Native auth context
- `packages/services/src/ui/components/OxyProvider.tsx` — RN provider component

**NOTE:** `accountUtils.ts` is not a frontend display-name fallback for API user/profile DTOs. API serializers own `name.displayName` (optional); consumers render it when present, then fall back to `getNormalizedUserHandle` — not to `accountUtils`.

## Application Model (#213 + #216) — replaces DeveloperApp (2026-06-14)

**Clean rename, NO migration, NO back-compat.** The `DeveloperApp` model and `routes/developer.ts` are GONE. Production `developerapps` collection was dropped (had 1 record). New collections start empty; apps are recreated in the new Console.

**Three new models in `packages/api/src/models/`:**
- `Application` (collection `applications`): `type` first_party|third_party|internal|system, `status` active|suspended|deleted|pending_review, `isOfficial`, `isInternal`, `capabilities[]`, `redirectUris[]`, `scopes`, `createdByUserId`. NO apiKey/apiSecret on this model.
- `ApplicationMember` (collection `applicationmembers`): `applicationId`+`userId` unique; `role` owner|admin|developer|viewer|billing; `permissions[]` derived from role; `status` active|invited|removed.
- `ApplicationCredential` (collection `applicationcredentials`): `publicKey` = OAuth client_id, `secretHash` = sha256 only (secret shown ONCE on create/rotate), `type` public|confidential|service, `environment`, `scopes`, `status`.

**Roles→permissions map:** `packages/api/src/utils/applicationRoles.ts` (`ROLE_PERMISSIONS`, `permissionsForRole`).

**Staff-only fields** (`type`/`isOfficial`/`isInternal`/`capabilities`): gated by `isStaff` boolean on the User model + `packages/api/src/middleware/requireStaff.ts` (`requireStaff`, `isStaffUser`). Normal Console PATCH path silently drops these for non-staff.

**Routes:** `packages/api/src/routes/applications.ts` mounted at `/applications` (Zod schemas in `schemas/application.schemas.ts`). RBAC via `requireAppPermission(permission)`. Full CRUD + members (invite/update/remove/transfer-ownership, can't remove last owner) + credentials (create/rotate return secret ONCE, revoke) + usage. Application responses embed `callerMembership` (caller's own role+permissions) on list + detail.

**OAuth + service tokens:** `clientId` → `ApplicationCredential.publicKey` (active) → `applicationId` → `Application`. Service-token endpoint validates apiKey/apiSecret against an active `type:'service'` `ApplicationCredential` (sha256 secretHash, constant-time). The service JWT payload claim is STILL named `appId` (= applicationId string) — NOT renamed, to avoid breaking `@oxyhq/core` service-token verification. `ApiKeyUsage`/`AuthCode`/`DeveloperApiKey` model refs repointed `'DeveloperApp'`→`'Application'` (DeveloperApiKey model name kept). Platform-stats field: `totalDeveloperApps`→`totalApplications`.

**redirectUris (#216):** `redirectUris` is the SOLE canonical redirect field. `redirectUrls` removed entirely (no dual field, no migration). OAuth authorize validates `redirect_uri` exact-match (constant-time) against `application.redirectUris`. Console writes `redirectUris`.

**SDK (@oxyhq/core — BREAKING):** Removed `OxyServices.developer.ts` + `developer` mixin. Replaced by `OxyServices.applications.ts` (getApplications/createApplication + members/credentials/usage methods). Exported interfaces: `Application`, `ApplicationMember`, `ApplicationCredential`, `ApplicationRole`, etc. `configureServiceAuth`/`getServiceToken`/`makeServiceRequest` are UNCHANGED — service token flow unaffected.

**Console:** `use-developer.ts` → `use-applications.ts`; apps list + tabbed app settings (General incl. redirectUris editor / Members / Credentials / Usage), permission-gated; staff-only fields never shown. Console now uses the shared SDK (bespoke axios client removed) + Bloom theming + macOS splash + app-name from manifest.json + app-logo/workspace-avatar uploads + invite-by-username/email + Manage-account link + docs→website.

**Commits:** api `881f81dc`, core+console `0a341882`, peer bumps `45e49063`.

## Workspaces (2026-06-15)

**Models in `packages/api/src/models/`:**
- `Workspace` (collection `workspaces`): `type` personal|team, `slug`, `ownerId`. Personal workspace is MANDATORY — created automatically for every user, NOT renamable (PATCH rejects rename for `type:'personal'`), cannot be deleted.
- `WorkspaceMember` (collection `workspacemembers`): `workspaceId`+`userId` unique; `role` owner|admin|member|viewer.

**Routes:** `packages/api/src/routes/workspaces.ts` at `/workspaces`. `GET /workspaces` calls `ensurePersonalWorkspace` UNCONDITIONALLY so every user always has a Personal workspace. RBAC via `requireWorkspacePermission`.

**Application scoping:** `Application.workspaceId` is REQUIRED. `GET /applications?workspaceId=` filters by workspace; access granted if workspace member OR `ApplicationMember`.

**SDK:** `@oxyhq/core` `workspaces` mixin — `OxyServices.workspaces.ts` with CRUD + members + transfer. `Workspace`/`WorkspaceMember` types exported. `getApplications(workspaceId?)` accepts workspace scope.

**Production "Oxy" team workspace:** `_id 6a2f9d8989b795cfdfac350f`, slug `oxy`, owned by user `oxy` (`_id 69b2d3df5d12f58c9800d651`, username `oxy`, email `hello@oxy.so` — DISTINCT from human `nateus`/`nate@oxy.so`). All 12 official Applications assigned to it. Migration `scripts/migrate-workspaces.ts` ran (idempotent).

## Oxy Trust — Reputation System (#217 + #219, 2026-06-16)

**Full hard replacement of the karma system. NO back-compat. Karma collections (`karmas`, `karmarules`) NOT auto-dropped — manual drop after migration verification.**

### API models (`packages/api/src/models/`)
- `ReputationTransaction` (collection `reputationtransactions`): ledger; `status` active|reversed|voided; `category` content|social|trust|moderation|physical|penalty|other; `sourceActionId` for idempotency.
- `ReputationBalance` (collection `reputationbalances`): cached per-user; `total`, `positive`, `negative`, `breakdown`, `reliability`, `trustTier`, `influence`; recalculated on demand.
- `ReputationDispute` (collection `reputationdisputes`): dispute lifecycle for contested transactions.
- `ReputationRule` (collection `reputationrules`): configurable award rules (replaces `KarmaRule`).
- **Deleted:** `Karma.ts`, `KarmaRule.ts`, `karma.controller.ts`, `karma.routes.ts`, `karma.schemas.ts`, the `KARMA` const, `UserStatistics.karma` field.

### Service (`packages/api/src/services/reputation.service.ts`)
Single source of truth. Key methods:
- `award(input)` — rule-driven, respects cooldown, idempotent on `(applicationId, sourceActionId)` via sparse partial-unique index.
- `reverseTransaction(id)` — marks original `reversed` + inserts compensating `-points active` txn → nets to zero. Never deletes.
- `voidTransaction(id)` — excludes from balance without compensating txn.
- `recalculateBalance(userId)` — aggregates `active`-only txns → total/positive/negative/breakdown + reliability + trustTier + influence.
- `getBalance(userId)`, `getInfluence(userId, context)`, `createDispute`, `resolveDispute`.

### Routes (`/reputation`, CSRF parity with old `/karma`)
- `GET /leaderboard`, `GET /rules`, `POST /rules` (staff)
- `GET /:userId/balance`, `POST /award` (service-token OR staff; regular users 403; service-token resolves `applicationId`/`credentialId` from `req.serviceApp`)
- `GET /:userId/transactions`, `GET /:userId/influence?context=default|report|moderation|ranking`
- `POST /transactions/:id/reverse` (staff), `POST /transactions/:id/void` (staff)
- `POST /:userId/recalculate` (staff)
- `POST /disputes`, `GET /disputes` (staff queue), `GET /:userId/disputes`, `POST /disputes/:id/resolve` (staff)

### Constants (`packages/api/src/utils/reputation.constants.ts`)
- Trust tiers (top-down): `restricted` (total<0 OR abuseScore>=0.5) → `verified` (User.verified) → `high_trust` (total>=500) → `trusted` (total>=100) → `new`.
- Influence clamped [0.1, 3.0]; base=clamp(0.1+total/500); moderation factor map: `{restricted:0, new:0.5, trusted:1.0, high_trust:1.25, verified:1.5}`; restricted floors ALL weights to 0.1.
- Reliability source keys: `report_confirmed`/`report_rejected`; abuseScore smoothing window=5.

### Rate-limit prefixes (reputation)
`rl:reputation:read:`, `rl:reputation:award:`, `rl:reputation:admin:`, `rl:reputation:dispute:`

### Migration
`scripts/migrate-karma-to-reputation.ts` — idempotent, supports `DRY_RUN`, re-runnable. Copies `Karma.history`→transactions, `KarmaRule`→`ReputationRule`, recalculates balances. Does NOT auto-drop `karmas`/`karmarules`. **REQUIRED post-deploy step: run as a one-shot ECS task. Balances read 0 for all users until this runs.**

### SDK (`@oxyhq/core` — `reputation` mixin)
- 14 methods on `oxy.reputation.*`: `getBalance`, `getTransactions`, `getInfluence`, `award`, `reverseTransaction`, `voidTransaction`, `recalculateBalance`, `getRules`, `upsertRule`, `createDispute`, `resolveDispute`, `getDisputes`, `getUserDisputes`, `getLeaderboard`.
- 20 exported types: unions `ReputationCategory`, `TrustTier`, `ReputationTransactionStatus`, `ReputationTargetEntityType`, `ReputationDisputeStatus`, `ReputationInfluenceContext`; entities `ReputationTransaction`, `ReputationBalance`, `ReputationBalanceBreakdown`, `ReputationInfluence`, `ReputationReliability`, `ReputationDispute`, `ReputationRule`, `ReputationLeaderboardEntry`, `ReputationInfluenceResult`, `ReverseReputationTransactionResult`; inputs `AwardReputationInput`, `CreateReputationDisputeInput`, `ResolveReputationDisputeInput`, `UpsertReputationRuleInput`, `ReverseReputationTransactionInput`.
- Writes sweep `clearCacheByPrefix('GET:/reputation/')`.
- **Deleted:** karma mixin + `KarmaRule`/`KarmaHistory`/`KarmaLeaderboardEntry`/`KarmaAwardRequest` types + `User.karma` field + `UserStats.karmaScore`.
- **SEMVER NOTE:** the karma removal was a breaking change. Peer ranges in `@oxyhq/auth` and `@oxyhq/services` were updated at publish time.

### Services (`@oxyhq/services`) — Trust screens
- 4 screens renamed Karma*→Trust* + About/FAQ under `src/ui/screens/trust/`.
- **BREAKING `RouteName` change:** removed `KarmaCenter|KarmaLeaderboard|KarmaRewards|KarmaRules|AboutKarma|KarmaFAQ`; added `TrustCenter|TrustLeaderboard|TrustRewards|TrustRules|AboutTrust|TrustFAQ`. Consumers calling `showBottomSheet('Karma...')` MUST migrate. `test-app-expo` already migrated.

## #214 — Auth App: Authorize Screen Application Identity (2026-06-16)

`packages/auth` authorize screen now resolves and displays the REAL registered `Application` identity (name, logo, redirectUri) via `sessionStatusSchema` in `packages/auth/lib/schemas.ts`. The free-form `appId` string field was replaced with a typed `application` contract wired from the API through `authorize.tsx` via `safeParse`. 10 new auth-web tests cover the authorize contract parsing.

## Trusted-Origin Registry — Application Registry (originally 2026-06-15; FedCM surface removed in wave 2)

Registering an `Application` (with `redirectUris`) now auto-authorizes that app's origin ecosystem-wide, no code change needed — this superseded the old FedCM-era approved-client-origins cache when FedCM was deleted. Trust derivation lives in `packages/api/src/config/dynamicOriginRegistry.ts`: two in-memory snapshots (`trustedOrigins` — first-party/internal/system/official, gets the credentialed CORS + device-first bootstrap lane; `thirdPartyOrigins` — ordinary active third-party apps, non-credentialed CORS only) refreshed on boot + 60s interval + on-demand from Application writes. The trust gate is the single `isTrustedApplication()` predicate (`packages/api/src/utils/trustedApplication.ts`) — `status: 'active'` alone is never a trust boundary, since every self-service third-party app is active too. This same registry is what the device-first `GET /auth/device/bootstrap` endpoint's `return_to` validation and the OAuth consent auto-approve decision both read.

**12 official Applications** created in the `oxy` workspace, each with a `public` `ApplicationCredential` (client_id = `oxy_dk_…` publicKey). Their `clientId` is wired into each app's `OxyProvider`/`WebOxyProvider` via env-with-default.

**Credential rotation:**
- `POST /applications/:appId/credentials/:credId/rotate` — mints a new `ApplicationCredential` (new `publicKey` + `secret` returned once), marks the previous one `deprecated` with `expiresAt = now + CREDENTIAL_ROTATION_GRACE_MS` (7 days). Response: `{ credential, secret, rotatedFrom, graceExpiresAt }`. `rotatedFromCredentialId` on the new credential links new → old for audit.
- Auth resolution at ALL three sites (OAuth authorize, OAuth token, service-token mint) uses the shared `isCredentialUsable()` predicate in `packages/api/src/utils/credentialUsability.ts` — accepts `active` OR `deprecated`-within-grace; rejects `revoked` or expired. Old secret works during the 7-day grace; revoke is immediate.
- Service-token JWT now embeds `credentialId` alongside `appId` (= applicationId); both are on `req.serviceApp`. The JWT claim name `appId` is unchanged.
- Secrets are sha256-hashed (`secretHash`), returned exactly once on create or rotate, never retrievable again.

## Service Tokens (Internal Service-to-Service Auth)

Internal Oxy ecosystem apps authenticate via short-lived service JWTs (OAuth2 Client Credentials pattern).

**Flow:**
1. Create an `Application` with `type: 'internal'` and an `ApplicationCredential` with `type: 'service'` (DB-only or Console staff view)
2. Service exchanges `publicKey` (client_id) + `secret` → `POST /auth/service-token` → 1h JWT
3. Service uses JWT as `Authorization: Bearer <token>` + `X-Oxy-User-Id: <userId>` for delegation
4. `@oxyhq/core` `auth()` middleware recognizes `type: 'service'` JWTs (stateless, no session DB lookup)

**Key files:**
- `packages/api/src/routes/auth.ts` — `POST /auth/service-token` endpoint (validates against `ApplicationCredential`)
- `packages/api/src/models/Application.ts` — `isInternal`, `type` field
- `packages/api/src/models/ApplicationCredential.ts` — `publicKey`, `secretHash`, `type: 'service'`
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
- `rl:auth:challenge:`, `rl:auth:verify:`, `rl:auth:refresh:`, `rl:auth:lookup:`, `rl:auth:session-claim:`, `rl:auth:oauth-authorize:`, `rl:auth:oauth-consent:`, `rl:auth:oauth-token:`, `rl:auth:service-token:`, `rl:auth:login:`, `rl:auth:client-lookup:`
- `rl:auth:device:bootstrap:`, `rl:auth:device:websession:`, `rl:auth:device:exchange:`, `rl:auth:refresh-token:`, `rl:auth:device:token:`, `rl:auth:device:resolve:` — device-first bootstrap surface (`packages/api/src/routes/deviceAuth.ts`)
- `rl:apps:authorized:read:`, `rl:apps:authorized:revoke:` — connected-apps (`AppGrant`) surface; `rl:auth:grants:read:`, `rl:auth:grants:revoke:` — OAuth grant management
- `rl:contacts:discover:` (200 hashes/request, 5 req/min/user)
- `rl:social-auth:`
- `rl:email:inbound:`, `rl:email:proxy:`
- `rl:userdata:write:`
- `rl:reputation:read:`, `rl:reputation:award:`, `rl:reputation:admin:`, `rl:reputation:dispute:`
- `rl:auth:session-approve-info:`, `rl:auth:session-authorize-signed:` — Commons QR handoff endpoints
- `rl:identity:export:` (5/hr — signed data export), `rl:identity:domainreq:`, `rl:identity:domainverify:` — domain verification
- `rl:civic:attest:` (real-life QR attestation), `rl:civic:validate:` (jury vote submit), `rl:civic:vouch:` (personhood vouch/withdraw), `rl:civic:credential:` (credential issue/revoke)

**General limiter threshold** (commit `641cea67`): raised 150 → **1000 / 15min**. The 150 ceiling was below a single authenticated user's normal traffic (feed scroll + socket fallback polling + profile loads + device-first refresh/bootstrap calls). Per-endpoint limiters (`authRateLimiter` 300, `userRateLimiter` 200, `checkLimiter` 10/min, etc.) remain the relevant defense-in-depth. **Do NOT lower the general limiter below 1000 without measuring real production traffic.**

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

## Accounts App Patterns (packages/accounts — "Accounts by Oxy")

**Post-PR #415: Accounts is KEYLESS and management-only.** All identity creation, key management, recovery phrase, backup, and key-based flows moved to `packages/commons`. Accounts signs in via password (`oxyServices.signIn(emailOrUsername, password)`), the in-app "Sign in with Oxy" modal (`showSignInModal()` from `@oxyhq/services`, device-first — no FedCM), or Commons QR / shared-keychain. Account deletion deep-links to `commons://delete-account` — Accounts no longer owns the key-signed deletion flow.

- **i18n**: `LocaleProvider` + `useTranslation` hook in `packages/accounts/lib/i18n/`; 11 locales (EN + ES fully populated); device locale via `Intl.DateTimeFormat().resolvedOptions().locale` (no `expo-localization` native module needed)
- **Typed routes**: `typedRoutes: true` in `app.json` — all `router.push()` calls must use typed path strings, no `as any` casts
- **Error boundaries**: at root, `(tabs)`, and `(auth)` layout levels using an `ErrorFallback` component
- **Activity History**: `/(tabs)/activity.tsx` using `GET /security/activity` with infinite scroll
- **Font**: do NOT set `fontFamily: 'Inter-*'` — `BloomThemeProvider` sets Inter as `Text.defaultProps` globally
- **expo-router v56**: no `@react-navigation/*` direct imports; synthesize `{ type: 'OPEN_DRAWER' }` payloads inline
- **`(auth)` routing** (session-only gate): `(auth)`↔`(tabs)` now keys **purely on session** — `needsAuth = isAuthResolved ? !isAuthenticated : true`. No `hasIdentity`/`KeyManager` in routing. `(auth)/index.tsx`: session resolved + authenticated → `/(tabs)`; not authenticated → sign-in. Always clean up timers from entrance animations.
- **Username step**: use `useUpdateProfile().mutateAsync()`, NOT `oxyServices.updateProfile()` directly — gets optimistic update + cache invalidation. Stable initial value via lazy `useState` initializer (no `useEffect` reset on remount).
- **`useUpdatePrivacySettings`**: do NOT call `invalidateAccountQueries(queryClient)` in `onSuccess` (defeats optimistic merge). Use `{ ...previous, ...requested, ...incoming }` merge in `onMutate`. `onError` does targeted `invalidateQueries({ queryKey: queryKeys.privacy.settings(...) })` for reconciliation.
- **Web sign-in**: `app/(auth)/index.tsx` calls `showSignInModal()` (the shared in-app modal mounted globally by `OxyProvider`) — no FedCM, no redirect. No web identity creation (Commons is native-only; Accounts web is management after sign-in only).
- **Shared modules** (use these, don't re-duplicate): `utils/relative-time.ts` + `hooks/useRelativeTime.ts` (i18n-aware relative time); `utils/device-utils.ts` (getDeviceIcon, getDeviceDisplayName, DeviceRecord, groupDevicesByType); `hooks/useAvatarUrl.ts`; `hooks/useDebounce.ts`; `constants/payments.ts` (FAIRCOIN_WALLET_URL); `constants/drawer-screens.ts` (typed DrawerScreenConfig[] — lives in `constants/` NOT `app/` so expo-router doesn't register it as a route); `constants/styles.ts` (`floatingPosition`: `Platform.select({ web: 'fixed', default: 'absolute' })` for floating action bar / FAB — used by `(tabs)/_layout.tsx` + `components/ui/bottom-action-bar.tsx`).
- **Shared UI components** (use these, don't re-duplicate): `components/ui/empty-state-card.tsx` — `EmptyStateCard` (icon + title + subtitle, optional `subtitleColor?`) — single shared empty-state used by security + payments sections; `components/ui/circle-icon-badge.tsx` — `CircleIconBadge` (36dp circular icon wrapper); `components/ui/quick-action-button.tsx` — accepts `size?` prop (default 48).
- **God-screen decomposition**: section components under `components/sections/` (+ shared `GroupedItem`/`PrioritizedGroupedItem` types in `components/sections/types.ts`), `components/security/`, `components/home/`, `components/payments/`; hooks under `hooks/home/*`; pure helpers `utils/security-recommendations.ts`, `utils/payment-utils.ts`.
- **`payments.tsx`**: reads `timestamp` field (NOT `createdAt`) for payment/transaction dates.
- **Removed unused deps**: `@radix-ui/react-tabs`, `react-responsive`, `@lottiefiles/dotlottie-react-native`, `expo-symbols`. KEEP `expo-document-picker` + `expo-image-manipulator` (lazy-loaded optional peers of `@oxyhq/services`) and `@lottiefiles/dotlottie-react` (hard-required by web lottie export).
- **Shared modules** (use these, don't re-duplicate): `utils/relative-time.ts` + `hooks/useRelativeTime.ts` (i18n-aware relative time); `utils/device-utils.ts` (getDeviceIcon, getDeviceDisplayName, DeviceRecord, groupDevicesByType); `hooks/useAvatarUrl.ts`; `hooks/useDebounce.ts`; `constants/payments.ts` (FAIRCOIN_WALLET_URL); `constants/drawer-screens.ts` (typed DrawerScreenConfig[] — lives in `constants/` NOT `app/` so expo-router doesn't register it as a route); `constants/styles.ts` (`floatingPosition`: `Platform.select({ web: 'fixed', default: 'absolute' })` for floating action bar / FAB — used by `(tabs)/_layout.tsx` + `components/ui/bottom-action-bar.tsx`).
- **Shared UI components** (use these, don't re-duplicate): `components/ui/empty-state-card.tsx` — `EmptyStateCard` (icon + title + subtitle, optional `subtitleColor?`) — single shared empty-state used by security + payments sections (replaced 3 duplicated inline empty states); `components/ui/circle-icon-badge.tsx` — `CircleIconBadge` (36dp circular icon wrapper) — shared across identity cards, payments info, home actions; `components/ui/quick-action-button.tsx` — accepts `size?` prop (default 48) — reused by `bottom-action-bar` and `home-bottom-actions` (home footer no longer hand-rolls badge buttons).
- **God-screen decomposition**: section components under `components/sections/` (+ shared `GroupedItem`/`PrioritizedGroupedItem` types in `components/sections/types.ts`), `components/security/`, `components/home/`, `components/payments/`; hooks under `hooks/home/*`; identity auto-sync in `hooks/identity/useIdentitySync.ts`; pure helpers `utils/security-recommendations.ts`, `utils/payment-utils.ts`.
- **`payments.tsx`**: reads `timestamp` field (NOT `createdAt`) for payment/transaction dates.
- **Removed unused deps**: `@radix-ui/react-tabs`, `react-responsive`, `@lottiefiles/dotlottie-react-native`, `expo-symbols`. KEEP `expo-document-picker` + `expo-image-manipulator` (lazy-loaded optional peers of `@oxyhq/services`) and `@lottiefiles/dotlottie-react` (hard-required by web lottie export).

## Commons App (packages/commons — "Commons by Oxy", PR #415)

**NATIVE-ONLY identity vault — no web build, no Cloudflare Pages project.** All key/identity UX from Accounts has been extracted here.

- **Bundle**: `so.oxy.commons`, scheme `commons`/`oxycommons`, package name `commons`
- **Purpose**: Hello Human onboarding, create/import identity, recovery phrase, encrypted backup, key display, biometric sign-in, QR scanner + approval screens for "Sign in with Oxy"
- **Metro config** (MANDATORY): mirrors `packages/accounts/metro.config.js` exactly — the Bloom single-instance `resolveRequest` rewrite is required to prevent duplicate React context crashes
- **Pinned native deps** (match accounts): `react-native-reanimated 4.3.1`, `react-native-worklets 0.8.3`, `@shopify/react-native-skia 2.6.2`, `react 19.2.3`; honor root `overrides`
- **Routing**: bidirectional Stack guard; `useOnboardingStatus` with `hasIdentity` gate is correct here (Commons legitimately owns the identity gate). Native-only: Hello Human → welcome → create/import → vault group `(vault)`. No web entry variants or web blockers.
- **For account management**: Commons deep-links to `accounts://` (Accounts). Accounts deep-links to `commons://` for key/backup/recovery/delete.
- **Delete account flow**: `commons://delete-account` — key-signed deletion via `KeyManager.getPublicKey()` → sign `delete:${publicKey}:${ts}` → `DELETE /users/me`. Strict order: `deleteAccount` → `purgeIdentity` (primary AND backup, success-only) → `signOutAll`; local-purge failure is non-fatal.
- **Recovery phrase**: mandatory acknowledgement screen at `/(auth)/create-identity/recovery-phrase` before identity creation completes; persistent reminder in Security screen until acknowledged.
- **CI wiring**: `packages/commons` added to root bun workspaces + `commons:*` scripts. No Cloudflare Pages deploy job. Ships via EAS only.
- **A0 prereqs (pending)**: New registered `oxy_dk_…` `ApplicationCredential` (clientId) for Commons → `packages/commons/constants/oxy.ts` (overridable via `EXPO_PUBLIC_OXY_CLIENT_ID`); new EAS project ID. See "Pending (post-merge)" below.

## Self-Sovereign Identity Layer (PR #415)

### DID document (`did:web:oxy.so:u:<userId>`)

- DID is **account-anchored** on stable `_id`, not the keypair. Keypair = a verification method under `authMethods[]`.
- **Custodial** (no local key): `controller: [OXY_DID]`; `verificationMethod[]` from `publicKey` field if present.
- **Self-sovereign** (has Commons key): `controller: [did, OXY_DID]`; `verificationMethod[]` from `authMethods` (`EcdsaSecp256k1VerificationKey2019`, `publicKeyHex`, `#key-1`); `authentication`/`assertionMethod`.
- `alsoKnownAs[]` = `acct:<username>@oxy.so` + profile URL + `https://<verifiedDomain>` for each domain.
- `service[]` = Oxy API + profile endpoints.
- **Fully reversible**: link identity → DID becomes self-sovereign; unlink → reverts custodial. `userCache.invalidate(userId)` called on every link/unlink (pre-existing gap — now fixed in `authLinking.ts`).

**New API files:**
- `packages/api/src/services/did.service.ts` — `buildUserDid(userId)`, `buildDidDocument(user)` (derived on-demand, not stored)
- `packages/api/src/routes/did.ts` — `GET /u/:userId/did.json` (public; `Content-Type: application/json`; `Access-Control-Allow-Origin: *`; `Cache-Control: public, max-age=300`); `GET /.well-known/did.json` (Oxy org DID). Mounted in `server.ts` at root alongside federation handlers, **outside** the `/users` rate-limit group, no auth/CSRF.
- **Infra requirement** (pending): apex proxy must forward `oxy.so/u/*/did.json` + `oxy.so/.well-known/did.json` to the API. Fallback: anchor `did:web:api.oxy.so:u:<id>` (zero proxy work). See "Pending (post-merge)".

**New `User` model additions** (`packages/api/src/models/User.ts`):
- `did` virtual (derived from `_id`, surfaced in `toJSON`)
- `verifiedDomains?: [{domain, verifiedAt, method:'dns-txt'|'well-known'}]` + sparse index
- No new verification-method state — `authMethods` remains the single source.

### Signed Records

Envelope schema (in `@oxyhq/contracts`): `{version, type:'identity'|'profile', subject, issuer, record, issuedAt, publicKey, alg:'ES256K-DER-SHA256', signature}`. Signing input = `canonicalize` of everything except `publicKey` + `signature`.

- **`packages/core/src/crypto/canonicalJson.ts`**: `canonicalize(value)` (recursive key-sort/JCS-style; safe for nested objects unlike the flat `signRequestData` scheme). Export from `@oxyhq/core`.
- **`SignatureService.signRecord(type, subject, record)`** — client-side signing. Custodial users: server signs with Oxy's key as provenance attestation.
- **New API**: `packages/api/src/models/SignedRecord.ts` (append-only collection `signedrecords`); `packages/api/src/services/signedRecord.service.ts` (`verifyEnvelope`: recompute canonical input, verify sig, assert publicKey is a current VM, check freshness); `packages/api/src/routes/identity.ts`: `POST /identity/records` (auth), `GET /identity/records/:userId/:type` (public), `/verify`.

### Data Export

`GET /users/me/export` in `routes/identity.ts` (auth + `rl:identity:export:` 5/hr): signed open-format bundle `{$schema, exportedAt, did, didDocument, profile, verifiedDomains, authMethods (no secrets), signedRecords, appData, social, attestation}`. Oxy attestation = signature over `canonicalize(bundle)` with the Oxy key (`OXY_PRIVATE_KEY` env). No secrets leak — mirrors `formatUserResponse`.

**OXY signing key** (`OXY_PUBLIC_KEY` / `OXY_PRIVATE_KEY` env): required on oxy-api ECS for custodial DID attestation + export attestation. Pending — see "Pending (post-merge)".

### Domain Verification

`routes/identity.ts`:
- `POST /identity/domains` — issue token; instructions for DNS-TXT `_oxy-identity.<domain>=oxy-domain-verification=<token>` and HTTP `/.well-known/oxy-domain`
- `POST /identity/domains/:domain/verify` — DNS via `dns.promises.resolveTxt` OR well-known via `safeFetch` (SSRF-safe, never raw fetch), then push to `verifiedDomains`, invalidate userCache
- `DELETE /identity/domains/:domain`, `GET /identity/domains`
- Optional `DomainVerification` model (TTL token, mirrors `AuthChallenge`)
- Rate limits: `rl:identity:domainreq:` + `rl:identity:domainverify:`

Domain verification = a **badge** only (`alsoKnownAs` in DID). NOT domain-as-handle.

### Core Identity Mixin (`OxyServices.identity.ts`)

Registered in `MIXIN_PIPELINE` + `AllMixinInstances`. Methods: `resolveDid`, `getMyDid`, `listAuthMethods`, `linkIdentityKey` (sign + `/auth/link`), `unlinkAuthMethod`, `linkPassword`, `signRecord`, `publishRecord`, `getRecord`, `verifyRecord`, `exportMyData`, `requestDomainVerification`, `verifyDomain`, `listDomains`, `removeDomain`. Cache-sweeps `/users/me` + DID cache after mutations. Exports new types + `canonicalize` + `buildSignedRecord`.

## Sign in with Oxy — QR/Shared-Key Handoff (PR #415)

**User-facing label everywhere: "Sign in with Oxy"** (one entry; presents options: QR scan / Commons handoff, username + password, social login). Never say "Sign in with Commons" — the mechanism is invisible plumbing.

### Mechanism A — Same-device shared-keychain SSO (native-only)

- Commons writes shared identity at creation (`createSharedIdentity` / `migrateToSharedIdentity`); optionally `storeSharedSession` for warm SSO.
- `OxyServices.signInWithSharedIdentity()` (native-only): `requestChallenge(sharedPubKey)` → sign with shared key → `verifyChallenge` (plants tokens). Returns null on web.
- New cold-boot step **`shared-key-signin`** added to `OxyContext` (`packages/services`) immediately after `stored-session`, before web probes, native-only, with per-step timeout. `WebOxyProvider` unchanged.
- Each native app must declare iOS `keychain-access-groups` including `group.so.oxy.shared` (same Team ID) + Android shared-store config.

### Mechanism B — Cross-device QR handoff

New API endpoints (`packages/api/src/routes/auth.ts` + `authSession.service.ts`):

| Endpoint | Auth | Notes |
|----------|------|-------|
| `POST /auth/session/create` (extended) | optional | Adds `authorizeCode` (public QR handle) + `qrPayload` (`oxycommons://approve?v=1&code=<authorizeCode>&...`); `sessionToken` stays secret and is NEVER in the QR |
| `GET /auth/session/approve-info/:authorizeCode` | none | Returns server-resolved `Application` identity + scopes + `boundOrigin` + status; Commons renders this — never trusts raw QR strings |
| `POST /auth/session/authorize-signed/:authorizeCode` | none (key-signed) | `{publicKey, challenge, signature, timestamp}` via `verifyChallengeResponse` + atomic burn; resolves `User` by `publicKey`; `sessionService.createSession`; emits socket on `sessionToken` row |
| `POST /auth/session/deny/:authorizeCode` | none | Cancel + emit socket |

**QR payload**: `oxycommons://approve?v=1&code=<authorizeCode>&app=<appId>&origin=<rp-origin>&nonce=<rand>&exp=<ms>`. `authorizeCode` = 128-bit single-use 5-min origin-bound; `sessionToken` stays secret. Cross-device: Commons in-app camera scanner. Same-device: `oxycommons://` custom-scheme deep link.

**New rate-limit prefixes**: `rl:auth:session-approve-info:`, `rl:auth:session-authorize-signed:`

**Flow**: RP `startCommonsSignIn` → `POST /auth/session/create` (gets `sessionToken` + public `authorizeCode`) → render QR (web) / deep-link (same-device) → Commons scans → `GET /auth/session/approve-info/:code` → biometric → `POST /auth/session/authorize-signed/:code` (key-signed, no bearer) → RP socket/poll → existing `claimSessionByToken` → tokens planted.

### SDK methods (core + services)

- `@oxyhq/core` `OxyServices.auth.ts`: `startCommonsSignIn`, poll (reuse `pollSessionStatus`), `signInWithSharedIdentity`; Commons-side `getCommonsApprovalInfo` / `approveCommonsSignIn` / `denyCommonsSignIn`.
- `@oxyhq/services` `useOxyAuthSession.ts`: surfaces `authorizeCode` + structured `qrPayload`; Sign-in-with-Oxy added to `SignInModal.tsx` / `OxyAuthScreen.tsx`.
- `@oxyhq/auth` `WebOxyProvider`: exposes Sign-in-with-Oxy (QR only, no shared-key).

## HttpService (services)

- On React Native (Expo 56), FormData uploads route through `XMLHttpRequest` — do NOT use fetch for multipart uploads on RN (Expo 56's fetch rejects RN file descriptors).
- **Web `{uri}` upload descriptors:** the browser's `FormData` can't read bytes from a `{uri}` object (only RN's can). On web, `assetUpload` materializes `{uri}` → `Blob` via `fetch` before appending (core ≥3.10.1); the API rejects 0-byte uploads with `400 Empty file`. Never persist/append an empty file.

## Offline Mutation Queue (services)

- React Query `networkMode: 'offlineFirst'` with stable `mutationKey` on all mutations
- `useMutationStatus` aggregator hook surfaces "Syncing…" indicators across the app

## Offline-First Persistence (services + auth-sdk)

- `@tanstack/react-query-persist-client` wired in both `@oxyhq/services` (AsyncStorage) and `@oxyhq/auth` (localStorage via `createSyncStoragePersister`).
- Query whitelist: `accounts`, `users`, `sessions`, `devices`, `privacy`, `payments` queries are persisted; mutations always persisted; 30-day TTL; 1s throttle; v1 cache cleanup on startup.
- `OxyProvider` and `WebOxyProvider` both await `restored` before exposing the QueryClient → first paint serves cached data, not a loading spinner.
- New `useOnlineStatus()` hook in `@oxyhq/services` — built on `useSyncExternalStore` over `onlineManager`; use for offline banners in app UIs.
- TanStack Query must use a consistent `^5.x` major version across services, auth-sdk, console, and test-app-expo — check each workspace's `package.json` for the pinned range.

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
- Existing file-management flow untouched.

## AvatarCropScreen (services — accounts)

- Translucent top bar (Cancel / title / primary Done CTA), full-bleed `#000` canvas.
- 3×3 thirds grid fades 800ms after gestures end; white ring; floating zoom chip during pinch.
- Entrance spring; haptics on reset / zoom limits / confirm.
- `ActivityIndicator` + "Saving…" during processing; Reset link; full a11y + `announceForAccessibility`; reduced-motion respect.
- i18n keys under `editProfile.crop.*` and `editProfile.toasts.crop*` in en-US.json + es-ES.json.

## Device-First Session Model (core + auth-sdk + services + api + packages/auth IdP) — replaces FedCM (wave 2, 2026-07)

**FedCM, the `/sso` bounce, the `/auth/silent` iframe, per-apex `auth.<rp-apex>` CNAMEs, `resolveConfig()`'s per-request `fedcmIssuer`, `FEDCM_ISSUER`/`FEDCM_TOKEN_SECRET`, and the `fedcm_session`/`oxy_rt_*` cookies were ALL deleted** — client, server, and IdP. There is no browser identity-federation API, no multi-domain-FAPI CNAME setup, and no central-vs-per-apex-issuer distinction to reason about anymore; none of that machinery exists to misconfigure. Full mechanism detail: `docs/auth/README.md`, `docs/SESSION-ARCHITECTURE.md`, `docs/CROSS_DOMAIN_AUTH.md`.

- **The session authority is a device, not a browser-mediated federation flow.** A durable, first-party `oxy_device` cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, `Domain=.oxy.so`, 400-day sliding, `packages/api/src/utils/deviceCookie.ts`) plus a persisted, per-origin rotating refresh-token family (`POST /auth/refresh-token`) restore a session with zero redirects for first-party apps.
- **One cold-boot implementation, not two.** `runSessionColdBoot` (`packages/core/src/boot/coldBootV2.ts`) is called identically by `WebOxyProvider` (`@oxyhq/auth`) and `OxyContext` (`@oxyhq/services`) — built on the same `runColdBoot` pure ordered short-circuit primitive (`packages/core/src/utils/coldBoot.ts`) used before wave 2. Order: `bootstrap-return` → `stored-tokens` → `shared-key-signin` (native) → `bootstrap-hop` (web: same-apex inline fetch every boot; cross-apex ONE top-level hop, ever, per browser+origin, to the API's own `GET /auth/device/bootstrap` — never a per-apex CNAME) → signed out. NEVER auto-redirects to a login page.
- **Server surface**: `packages/api/src/routes/deviceAuth.ts`, mounted at `/auth` on `api.oxy.so` — `GET /auth/device/bootstrap`, `POST /auth/device/web-session`, `POST /auth/device/exchange`, `POST /auth/refresh-token`, `POST /auth/device/token` (native), `POST /auth/device/resolve` (`X-Oxy-Internal`-gated, feeds the IdP account chooser).
- **Interactive sign-in is an in-app SDK modal**, not a redirect to an IdP: `useAuth().signIn()` just opens it (password+2FA via `POST /auth/login` + `POST /security/2fa/verify-login`, or the "Sign in with Oxy" QR/Commons handoff — unchanged from before wave 2).
- **Invalidated bearer token = local sign-out in `@oxyhq/services`**: `HttpService` clears tokens on 401 and emits `onTokensChanged(null)`. `OxyContext` MUST treat that as authoritative when a user is currently authenticated: clear session state, clear managed accounts, and disable private fetches until a new token/session is restored. Never let `isAuthenticated` remain true after `oxyServices.getAccessToken()` becomes null. Consumer apps gate private work with SDK state only: native `useAuth().canUsePrivateApi` / `useAuth().isPrivateApiPending`; web `useAuth().isLoading` / `useAuth().isReady`.
- **`packages/auth` (auth.oxy.so) is now third-party-OAuth-only** (see "Auth App" section below) — it is not the session authority for first-party apps and does not appear in the cold-boot chain above except as the target of the one-time cross-apex hop (which actually targets `api.oxy.so`, not `auth.oxy.so`).

## Sign-In Token Planting

`@oxyhq/core` `OxyServices.verifyChallenge()` now calls `setTokens(accessToken, refreshToken ?? '')` internally before returning — matching the behaviour of `claimSessionByToken`. Consumers (including `services` `useAuthOperations.performSignIn`) no longer need to hand-plant the token or fall back to the bearer-protected `getTokenBySession` after `verifyChallenge`. Just await `verifyChallenge` and proceed; the SDK has already planted the token.

**Token-less new-identity onboarding**: the 401 fix (avoiding bearer-protected `getTokenBySession` for a brand-new identity that has no session yet) is preserved — `verifyChallenge`'s internal `setTokens` call handles it.

## New React Query Hooks (@oxyhq/services — exported from package root)

`useUserSubscription`, `useUserPayments`, `useUserWallet`, `useUserWalletTransactions`, `useAccountStorageUsage` — with typed returns (`Subscription`, `Payment`, `Wallet`, `WalletTransaction` in `ui/hooks/queries/paymentTypes.ts`). `payments` + `storage` query-key namespaces added; `payments` whitelisted for offline persistence.

## Bloom Worklets Safety (@oxyhq/bloom)

- BottomSheet pan context must use a **primitive** `SharedValue` (`contextY = useSharedValue(0)`), NEVER an object-valued SharedValue — object SharedValues mutated inside worklets crash under `react-native-worklets@0.8.3` (`removeListener` on UI thread).
- `hooks/mergeRefs.ts` returns a plain `(instance: T|null) => void` (not `React.RefCallback`) so the ref stays assignable across duplicate `@types/react` copies (RN 0.85 / React 19).

## Terminology

- **OxyServices** — main API client class (in core)
- **OxyProvider** — React Native context provider (in services)
- **WebOxyProvider** — Web React context provider (in auth)
- **useOxy** — RN auth hook (services), **useWebOxy** — web auth hook (auth)
- **Bottom sheet** — native modal navigation system in services (29+ screens)
- **LogoIcon / LogoText** — Bloom-themed logo exports from `@oxyhq/services`

## Auth App (packages/auth)

Standalone Vite app. **Wave 2: third-party OAuth authorize/consent IdP** (sign in, sign up, authorize, recover, settings) + a device-account chooser feed — no longer a FedCM IdP.

**ARCHITECTURE: the auth app is a third-party-OAuth IdP, not a Relying Party (CRITICAL — do not refactor)**
- `WebOxyProvider` + `runSessionColdBoot` are for RP apps (Mention, accounts, console, inbox, Allo, Homiio) that use the SDK directly — their device-first cold boot never redirects to `auth.oxy.so` for sign-in; the only time it touches the API's IdP-adjacent surface at all is the one-time cross-apex `GET /auth/device/bootstrap` hop, which targets `api.oxy.so`, not `auth.oxy.so`.
- The auth app is NOT the session authority anymore — there are no `fedcm_session`/`oxy_rt_*` cookies left for it to own. Its own session surface is the device-account chooser feed (`GET /api/device-accounts`, a Hono worker in `packages/auth/server`), which reads the shared, first-party `oxy_device` cookie and forwards it to the API's internal `POST /auth/device/resolve`.
- There is no FedCM/`/sso` loop left to create circularity with — that machinery is gone, not replaced by an equivalent self-referential path. Using `WebOxyProvider` here would still be wrong (it's not an RP), but there's no bounce-to-itself risk to reason about anymore.
- DO NOT refactor the auth app onto `WebOxyProvider`/`runSessionColdBoot`.

**Zod schema contract — the device-account chooser reads `deviceResolveResponseSchema` from `@oxyhq/contracts` directly (no local mirror to keep in sync)**
- `useDeviceAccounts()` (`packages/auth/lib/use-device-accounts.ts`) fetches `/api/device-accounts`, parses with `deviceResolveResponseSchema`/`DeviceResolveResponse`, and maps each `UserResponse` via `resolveUserId` + `getAccountDisplayName` (from `@oxyhq/core`) into the chooser's `Account` shape — a user with only a first name renders that first name, never the lowercase username, and the helper always returns a non-empty string so the chooser never shows a blank row.
- `user.name` is ALWAYS the structured object `{ first?, last?, full?, displayName? }` — NEVER a plain `z.string()`. `displayName` is optional (see `@oxyhq/contracts` `userNameSchema`).
- The legacy `/auth/refresh-all`-era `refreshAllResponseSchema`/`currentUserResponseSchema`/`deviceSessionsResponseSchema` schemas and their nullable-`authuser` legacy-slot handling are GONE — `refreshAllAccountSchema` and friends were removed from `@oxyhq/contracts` in the same wave (contracts 0.10.0). Do not re-introduce a local schema mirror in `packages/auth/lib/schemas.ts`; import the device-resolve contract from `@oxyhq/contracts` directly.

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
- `POST /security/2fa/verify-login` — complete a login that requires 2FA (NOT `/auth/2fa/verify` — that path validates/enables 2FA on an already-authenticated session)
- `POST /auth/signup` — account creation
- `POST /auth/recover/*` — password recovery flow
- `GET /users/me` — current session check
- `POST /auth/oauth/authorize`, `GET /auth/oauth/consent`, `POST /auth/oauth/token` — the third-party OAuth authorize/consent/token exchange this app now exists to serve
- `GET /api/device-accounts` (served by this app's own Hono worker, not the API) — the device-account chooser feed

**Device-account chooser worker (packages/auth/server) — replaces the FedCM IdP server:**
- One dynamic route, `GET /api/device-accounts`: reads the first-party `oxy_device` cookie and forwards it to the API's `POST /auth/device/resolve` under a shared `X-Oxy-Internal` secret (`SSO_INTERNAL_SECRET`); fails closed to an empty list on any missing cookie/secret/non-2xx. Everything else 404s and falls through to the Vite-built SPA (login/signup/authorize/recover/settings).
- Deployed as a Cloudflare Pages **advanced-mode** single `dist/_worker.js` at the dist root (`packages/auth/server/worker.ts` runs the Hono app, serving the SPA via `env.ASSETS`) — NOT a Pages Functions directory. `test -f dist/_worker.js` alone does NOT prove the worker executes; the deploy workflow additionally runs `packages/auth/scripts/verify-worker.mjs`, which imports the BUILT worker and asserts it actually routes `GET /api/device-accounts` to JSON (a static-only deploy instead serves SPA HTML for that path — file-presence checks miss this class of failure). A post-deploy smoke gate (`scripts/smoke-idp.ts`) re-checks the live host after deploy. Before trusting this section, verify live: `curl -s https://auth.oxy.so/api/device-accounts` should return JSON, not `<!doctype html>`.
- Per-apex `auth.<rp-apex>` CNAMEs, `FEDCM_TOKEN_SECRET`, and `FEDCM_ISSUER` are now INERT — nothing reads them anymore. They are pending decommission in `oxy-infra` (not yet removed as of this writing); do not add new configuration that depends on them.
- Changes require a redeploy of auth.oxy.so to take effect in production.

## Commons Civic Identity Layer — Oxy ID (Fases 0–4)

**Concept:** Commons by Oxy (`packages/commons`, native-only) is the user-facing UI for their **"Oxy ID"** — a self-sovereign civic identity built on DID + cryptographic keys + verifiable reputation + credentials + proof-of-personhood. The civic ENGINE lives server-side in `packages/api/src/services/civic/` + `packages/api/src/routes/civic.ts`. Ownership is proven by CRYPTO (per-subject hash-chained signed records), not by Oxy granting it. There is **zero "DNI"** terminology anywhere — the canonical name is "Oxy ID".

**Civic contracts:** `packages/contracts/src/civic.ts` — Zod schemas + inferred types for all civic surfaces. Consumed as `workspace:*` by api/core/services. **NOT published to npm.** Do not bump `@oxyhq/contracts` version for civic-only additions until Fases 0–4 are deployed and stable.

### Fase 0 — Signed Records v2 (hash chain)

- **Envelope v2** (`version:2, seq, prev, collection, rkey`): adds sequential ledger semantics on top of the v1 signing envelope. `seq` = monotone counter per `(subject, collection)`; `prev` = SHA-256 of the previous envelope JSON (or null for the first). Forms a per-subject, per-collection hash chain.
- **`RepoHead`** model (collection `repoheads`): one document per `(subject, collection)`, stores `seq + envelopeHash` — O(1) head lookup without scanning the chain.
- **`SignedRecord.nsid`** — the MongoDB column name for `collection` is `nsid` (Namespaced Identifier, e.g. `app.oxy.card`, `app.oxy.credential`). Use `nsid` in queries; `collection` is the schema/SDK alias.
- **`signedRecordSigningInput` / `canonicalize`** from `packages/core/src/crypto/canonicalJson.ts` — signing input is `canonicalize(envelopeWithoutSignature)`. Used identically by client and server.
- **`verifyEnvelope` branching** in `packages/api/src/services/signedRecord.service.ts`: issuer === subject → self-signed (verify against subject's current VM); issuer === `OXY_DID` → custodial (verify via `verifySecret`-gated Oxy key); else → untrusted, reject.

### Fase 1 — Oxy Trust Civic Engine (reputation via attestations)

Reputation awards are NEVER self-issued. The flow: users generate signed attestation payloads client-side → civic service evaluates quorum/rules → calls `reputationService.award(...)` in-process with `emitAttestation:true` → awards are appended to the ledger as Oxy-signed `reputation_attestation` records.

**Award weights (civic categories):**
| Action | Points | Category |
|--------|--------|----------|
| `real_life_attested` | +25 | `physical` |
| `peer_validated` | +8 | `trust` |
| `validation_correct` | +3 | `trust` |
| `validation_incorrect` | -10 | `trust` |
| `personhood_vouched` | +5 | `trust` |
| `vouch_slashed` | -20 | `penalty` |

**Trust tiers** (same as base reputation): new → trusted (≥100) → high_trust (≥500) → verified (`User.verified`) → restricted (total<0 or abuseScore≥0.5).

### Fase 2 — Anti-gaming (real-life QR attestation + validator jury)

**Real-life QR attestation:** B opens Commons and scans A's `oxycommons://attest?payload=<signed>` QR. Commons shows A's public card, biometric-gates B's approval, then B signs an attestation on-device and POSTs to `POST /civic/attest`. Server verifies both signatures, checks exclusion rules, and awards `real_life_attested`.

**Validator jury:** contested or fresh attestations queue for random jury review. Selection: weighted-reservoir algorithm with `rngSeed` stored in the `ValidationRequest` document for audit. Graph/device/IP exclusion via `packages/api/src/services/civic/graphExclusion.ts` (rejects validators who share a device fingerprint, IP range, or have previously interacted with the subject). Affinity throttle prevents any pair from repeatedly validating each other. Quorum tally → `peer_validated` award; reversal of a prior vote → `vouch_slashed` penalty.

**Key files:**
- `packages/api/src/services/civic/graphExclusion.ts` — exclusion predicate
- `packages/api/src/services/civic/jury.service.ts` — weighted-reservoir selection, quorum, slash
- `packages/api/src/routes/civic.ts` — all civic endpoints (`/civic/*`)

### Fase 3 — Proof of Personhood

**Mechanism:** multi-signal web-of-trust combining signed personhood vouches + real-life attestations + biometric confirmation.

**`utils/personhoodDerive.ts`:** evidence scoring formula — `evidence = 0.50 × vouches + 0.35 × realLife + 0.15 × biometric`; threshold θ = 0.60; if evidence ≥ θ, sets `User.verified = true` → reputation tier becomes `verified`.

**Vouch staking:** `POST /civic/vouch` — voucher signs a `personhood_vouch` record on-device; stake is burned if the vouch is later reversed (sets `vouch_slashed` penalty). `POST /civic/vouch/withdraw` — explicit withdrawal before system reversal avoids the slash penalty.

**Sybil clustering:** `packages/api/src/services/sybil.service.ts` — graph clustering on shared device fingerprints, IP ranges, and attestation patterns. Flagged clusters receive reduced evidence weight.

**Random audits:** reuse the Fase 2 jury mechanism on a random sample of verified users. Audit failure triggers `vouch_slashed` cascade on all vouches that user issued.

**`User.isSeedVerifier`:** bootstrap field on the `User` model. Set manually for the first batch of trusted users to seed the web-of-trust (required before personhood flows can propagate). Pending: populate seed verifiers in production.

### Fase 4 — Verifiable Credentials

**Collection NSID:** `app.oxy.credential`. One signed record per credential; `rkey` = credential UUID (unique per holder DID).

**Issuers:**
- **User-issued (self-signed):** `issuer === subject`. For personal attestations, claims about oneself.
- **Org-issued:** `issuer` = an Application's DID (Oxy key signing on behalf of the Application). Requires Application to be `type:'internal'` or `isOfficial`.

**`verifyCredential` checks (order):**
1. Parse and verify the outer signed envelope against the issuer DID's CURRENT active verification method (rejects if key was rotated/unlinked since issuance).
2. Check `credential.status` — rejects if `revoked`.
3. Check `credential.expiresAt` — rejects if past.
4. Returns parsed credential claims on success.

**Routes:** `packages/api/src/routes/civic.ts` at `/civic/credentials/` — `POST /issue`, `GET /list/:holderDid`, `GET /my`, `POST /verify`, `DELETE /revoke/:rkey`.

### Commons Nav (Oxy ID UI)

`packages/commons` tab structure — 3 NativeTabs:

| Tab | Route group | Content |
|-----|-------------|---------|
| ID (default) | `(id)` | Oxy ID card + DID + verifications + domain badges |
| Reputation | `(reputation)` | Standing hero + Skia composition donut + civic-duty CTA + signed activity ledger |
| Settings | `(settings)` | Trust & verification → Proof of personhood → Credentials |

- Active tab tint = `colors.text`; indicator/ripple = `primarySubtle`; background = `card`.
- **Scan FAB:** Bloom `Fab` on the ID landing screen opens `app/(scan)/` as a `fullScreenModal` — handles both `oxycommons://attest` (real-life attestation) and `oxycommons://approve` (sign-in handoff).
- **Reputation screen:** `components/reputation/*` — standing hero, Skia composition donut (shows breakdown arc per category), civic-duty CTA (prompts next action to grow standing), signed activity ledger (reads `GET /reputation/:userId/transactions` + `GET /civic/attest/history`).
- **QR schemes:** ALL use `oxycommons://` — `oxycommons://card` (share identity card), `oxycommons://attest?payload=<signed>` (real-life attestation), `oxycommons://approve?v=1&code=<authorizeCode>&...` (sign-in handoff). `oxydni://` scheme is removed entirely.
