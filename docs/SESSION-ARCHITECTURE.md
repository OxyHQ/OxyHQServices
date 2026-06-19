# Oxy Session Architecture (2026)

Single source of truth for how Oxy apps sign in, restore sessions, call app
backends, and resolve user identity.

## Principle

The central IdP is `auth.oxy.so`. Relying-party apps consume it through the Oxy
SDK. Apps do not implement their own SSO callback routes, local session
restore, token plumbing, or auth middleware copies.

## Current Package Contract

Current package targets:

| Package | Version | Contract |
|---------|---------|----------|
| `@oxyhq/core` | `3.4.13` | Platform-agnostic client, SSO helpers, linked clients, and server auth middleware. |
| `@oxyhq/auth` | `4.1.1` | Web `WebOxyProvider` for RP apps; uses core cold boot and callback handling. |
| `@oxyhq/services` | `10.2.10` | Expo/RN `OxyProvider`, `useAuth()` / `useOxy()`, private API readiness, native session handling. |
| `@oxyhq/bloom` | `0.8.5` | Current UI package target for Oxy consumers. |

## Frontend RP Contract

Relying-party frontends use the SDK only:

- Web apps use `WebOxyProvider` from `@oxyhq/auth` with a registered `clientId`.
- Expo/RN apps use `OxyProvider` from `@oxyhq/services` with a registered
  `clientId`.
- SDK cold boot owns session restore. On web it runs the ordered restore chain
  around callback consumption, FedCM/silent auth, cookie restore, stored bearer,
  and terminal SSO bounce. Native uses the native-safe stored session path.
- Apps must not add app-local `/__oxy/sso-callback` routes. The SDK intercepts
  the path and consumes the SSO result universally.
- Apps that serve root HTML and can receive `/__oxy/sso-callback` should inject
  `getSsoCallbackBootstrapScript()` from `@oxyhq/core` before React or Expo
  Router can rewrite the URL.
- Apps must not copy SSO helpers such as `consumeSsoReturn`,
  `buildSsoBounceUrl`, `isCentralIdPOrigin`, `guardActive`, SSO storage keys, or
  callback bootstrap logic. These live once in `@oxyhq/core`.
- Private frontend work must be gated by SDK state. Use
  `useAuth().canUsePrivateApi` / `useAuth().isPrivateApiPending` or the
  equivalent `useOxy()` state before calling private app APIs such as managed
  accounts, privacy, follow status, library, preferences, or profile settings.
- Apps must not keep fetching private APIs after the SDK access token is null,
  even if stale UI state still has a user object.

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

## IdP Exception

`packages/auth` / `auth.oxy.so` is the IdP, not an RP:

- Do not wrap the auth app in `WebOxyProvider`.
- Do not run RP cold boot or the RP SSO bounce chain inside the auth app.
- The auth app uses its first-party IdP session path:
  `useDeviceAccounts()` reads shared refresh cookies through
  `POST api.oxy.so/auth/refresh-all` with `credentials: include`.
- This exception applies only to the IdP. Mention, Allo, Homiio, Alia, TNP,
  Syra, accounts, console, inbox, and other RP apps follow the SDK RP contract.

## Development Contract

During local cross-package work, consumers should use linked SDK clients and the
current published package targets above. If a bug is in a shared package, fix and
build the source package first, then update/verify the consumer. Do not patch the
consumer with local auth/session workarounds.

## Obsolete Text

Older notes that said to leave Mention, Homiio, or Alia untouched until a
`*.oxy.so` foundation was verified are obsolete. The current contract applies to
all active RP apps. Work should still be sequenced safely: fix shared SDK/server
helpers upstream, then verify downstream consumers.
