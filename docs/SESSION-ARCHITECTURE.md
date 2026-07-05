# Oxy Session Architecture (2026, device-first / wave 2)

Single source of truth for how Oxy apps sign in, restore sessions, call app
backends, and resolve user identity.

## Principle

Session restore is **device-first**: a durable, first-party `oxy_device`
cookie plus a persisted rotating refresh-token family are the session
authority, resolved entirely by the shared SDK's cold boot
(`runSessionColdBoot` in `@oxyhq/core`). `auth.oxy.so` is a third-party OAuth
authorize/consent IdP and a device-account chooser feed — it is **not** a
redirect target for first-party apps in normal operation. Apps do not
implement their own session restore, token plumbing, or auth middleware
copies.

**Wave 2 changed the mechanism, not the principle.** FedCM, the `/sso` bounce,
the `/auth/silent` iframe, `AuthManager`, `CrossDomainAuth`, and the
`fedcm_session` / `oxy_rt_*` cookies were all deleted. The "one implementation
in the shared SDK" rule is unchanged.

## Current Package Contract

Current package targets — read the exact version from each package's
`package.json` (`bun info <pkg> version`); do not hardcode a version in this
document:

| Package | Contract |
|---------|---------|
| `@oxyhq/contracts` | Zod schemas shared by client + server, including the device-boot fragment/session contracts. |
| `@oxyhq/core` | Platform-agnostic client: device-first cold boot (`runSessionColdBoot`), persisted auth-state store, unified refresh handler, `SessionClient`, and server auth middleware. |
| `@oxyhq/auth` | Web `WebOxyProvider` — a thin binding over core's cold boot; owns the in-app sign-in modal. |
| `@oxyhq/services` | Expo/RN `OxyProvider`, `useAuth()` / `useOxy()`, private-API readiness (`canUsePrivateApi`/`isPrivateApiPending`), native shared-keychain handling. |
| `@oxyhq/bloom` | UI package target for Oxy consumers. |

## Device-First Cold Boot (core mechanism)

`runSessionColdBoot` (`packages/core/src/boot/coldBootV2.ts`) resolves a
device's session in a deterministic order, first step to yield a session wins,
and an unresolved boot **never** redirects to a login page — it ends
signed-out and the app renders its own "Sign in with Oxy" UI.

1. **`bootstrap-return`** (web) — consume a `#oxy_boot` return fragment left by
   a just-completed cross-apex hop: verify the CSRF `state`, exchange the
   single-use boot `code` via `POST /auth/device/exchange`.
2. **`stored-tokens`** — warm-plant a still-valid persisted access token, else
   rotate the persisted refresh-token family via `POST /auth/refresh-token`.
3. **`shared-key-signin`** (native only) — re-mint a session from the
   shared-keychain identity; issues/mirrors a shared device token the first
   time.
4. **`bootstrap-hop`** (web, terminal):
   - **same-apex** (e.g. two `*.oxy.so` apps): an inline, credentialed
     `POST /auth/device/web-session` fetch — no navigation, runs on every boot.
   - **cross-apex** (e.g. `mention.earth`): **one** visible top-level
     navigation to the API's `GET /auth/device/bootstrap` (a single canonical
     host — the RP's own configured `baseURL`, not a per-apex `auth.<rp-apex>`
     CNAME), guarded to fire **at most once ever per browser+origin** via a
     persistent `localStorage` flag. It fires on the very first load
     regardless of outcome (found a session or not) and never repeats for
     that browser+origin afterward.
5. Signed out.

Both `WebOxyProvider` (`@oxyhq/auth`) and `OxyContext` (`@oxyhq/services`)
call this same primitive with platform hints; there is no separate
web/native cold-boot implementation to keep in sync.

## The `oxy_device` cookie

The device-first anchor, defined once in `packages/api/src/utils/deviceCookie.ts`:

- Name `oxy_device`; `HttpOnly`, `Secure` (prod), `SameSite=Lax`, `Domain=.oxy.so`, 400-day sliding `Max-Age`, re-set on every bootstrap hop.
- The cookie value is a random 256-bit secret — **never** the deviceId. Server-side it is stored only as its SHA-256 hash (`DeviceSession.cookieKeyHash`); possessing the cookie reveals nothing about the device set.
- Shared by every `*.oxy.so` first-party surface (api, auth, apps), which is what lets the `auth.oxy.so` device-account chooser feed read it first-party.

## Frontend RP Contract

Relying-party frontends use the SDK only:

- Web apps use `WebOxyProvider` from `@oxyhq/auth` with a registered `clientId`.
- Expo/RN apps use `OxyProvider` from `@oxyhq/services` with a registered `clientId`.
- SDK cold boot owns session restore end to end (see above). Apps do not implement local session restore.
- Apps must not add app-local `/__oxy/sso-callback` routes or any bespoke boot-fragment handling — the SDK owns `#oxy_boot` parsing universally.
- Apps must not copy device-boot helpers (`consumeDeviceBootReturn`, the device-boot fragment schema, storage keys, etc.). These live once in `@oxyhq/core`.
- Private frontend work must be gated by SDK state:
  - Native (`@oxyhq/services`): `useAuth().canUsePrivateApi` / `useAuth().isPrivateApiPending`.
  - Web (`@oxyhq/auth`): `useAuth().isLoading` / `useAuth().isReady` (the web provider does not expose a separate `canUsePrivateApi` — `isAuthenticated` only flips once cold boot has resolved and a token is planted).
- Apps must not keep fetching private APIs after the SDK access token is null, even if stale UI state still has a user object.

## Linked App Backend Clients

RP apps that call their own backend must use SDK-linked clients:

- Create app backend clients with `oxyServices.createLinkedClient({ baseURL })`
  from the active `OxyServices` instance.
- The linked client attaches the current Oxy bearer token, follows the owner
  client's refresh path, and invalidates the owner session when a linked 401
  cannot recover.
- Do not add Axios/fetch auth interceptors, app-local token providers, manual
  `Authorization` header plumbing, refresh-cookie retries, or local
  `clearTokens()` invalidators in consumer apps.
- Do not copy user payloads or auth state into local API wrappers. Ownership
  and profile comparisons use the SDK-normalized `user.id`.

## Backend Auth Contract

Backend APIs use `@oxyhq/core/server` for Oxy identity:

- Mount `createOxyRateLimit(oxy)` once near the top of the Express app when the
  API needs Oxy-aware rate limiting. It resolves the optional session and
  rate-limits by the real user when present.
- Use `createOptionalOxyAuth(oxy)` where a route can behave differently for
  anonymous and signed-in callers.
- Use `createOxyAuthMiddleware(oxy)` or `requireOxyAuth` for private routes.
- Use `getRequiredOxyUserId(req)` for required user identity instead of reading
  backend-specific fields directly.
- Use `authSocket` for Socket.IO/WebSocket authentication.
- Do not define local `AuthRequest`, `requireAuth`, `getUserId`,
  `getAuthenticatedUserId`, token-decoding, or bearer parsing helpers in apps.
  If a helper is missing, add it to `@oxyhq/core/server` and consume it from
  there.

## CSRF Contract

Bearer-authenticated writes do not fetch or depend on app-local CSRF tokens.

- SDK bearer requests are explicit authorization and should not call duplicated
  `/csrf-token` endpoints in every app backend.
- CSRF remains relevant for ambient cookie credentials and cookie-only writes.
  Those flows must continue to fetch and send CSRF according to the owning
  backend's cookie contract.

## IdP Role (auth.oxy.so)

`packages/auth` / `auth.oxy.so` is a **third-party OAuth authorize/consent
IdP**, not a first-party session authority:

- Serves login/signup/authorize/recover/settings pages for third-party apps
  that integrate via OAuth instead of embedding the SDK.
- Serves the device-account chooser feed (`GET /api/device-accounts`), which
  forwards the first-party `oxy_device` cookie to the API's internal
  `POST /auth/device/resolve` to list the device's signed-in accounts.
- Does **not** wrap itself in `WebOxyProvider` or run the RP cold boot —
  doing so would make it bounce to itself. There is no FedCM, `/sso`,
  `/auth/silent`, or `fedcm_session` cookie left to create a loop with; those
  were deleted, not replaced by an equivalent self-referential path.
- Trust for auto-approving OAuth consent is **registry-based**
  (`Application.isOfficial` / `isInternal` / `type` — staff-controlled), not
  domain-based.
- This exception applies only to the IdP. Mention, Allo, Homiio, Alia, TNP,
  Syra, accounts, console, inbox, and other RP apps follow the SDK RP contract
  above and never talk to `auth.oxy.so` for session restore at all — the
  one-time cross-apex bootstrap hop targets `api.oxy.so` directly (the RP's
  own configured `baseURL`), not `auth.oxy.so` or any per-apex `auth.<rp-apex>`
  CNAME.

## Development Contract

During local cross-package work, consumers should use linked SDK clients and
the current published package targets above. If a bug is in a shared package,
fix and build the source package first, then update/verify the consumer. Do
not patch the consumer with local auth/session workarounds.

## Obsolete Text

Any older notes describing FedCM, `AuthManager`, `CrossDomainAuth`, the `/sso`
bounce, the `/auth/silent` iframe, `fedcm_session`/`oxy_rt_*` cookies, or
per-apex `auth.<rp-apex>` CNAMEs as part of the live session-restore path are
obsolete — all of that machinery was deleted in the wave-2 device-first
cutover. The current contract in this document applies to all active RP apps.
