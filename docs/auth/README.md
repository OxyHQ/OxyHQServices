# Authentication & Session System

> How sign-in, cross-domain session restore, service tokens, and backend request
> identity work across the Oxy ecosystem. The whole system is implemented **once**
> in the shared SDK (`@oxyhq/core`, `@oxyhq/auth`, `@oxyhq/services`) so every app
> gets it for free and stays zero-config.
>
> **Wave 2 (device-first, 2026-07):** FedCM, the `/sso` bounce, the
> `/auth/silent` iframe, `AuthManager`, `CrossDomainAuth`, and the
> `fedcm_session` / `oxy_rt_*` cookies were all deleted from the client, server,
> and IdP. Sections 1–6 and 8 below describe the current device-first
> mechanism. Sections 7, 9, 10 (service tokens, linked backend clients,
> `@oxyhq/core/server`) are unaffected by wave 2.
>
> Related: [Architecture](../architecture/overview.md) · [Identity / Oxy ID](../identity/README.md) · [Changelog](../CHANGELOG.md)

---

## 1. The mental model: device-first, with a third-party OAuth IdP on the side

There is no browser-mediated federation API and no central session-issuing
redirect for first-party apps anymore. A device (a browser + origin pair, or a
native app install) proves its session directly against `api.oxy.so` using a
durable, first-party cookie plus a persisted rotating refresh-token family.
`auth.oxy.so` (package `packages/auth`, a standalone Vite + Hono app deployed
as a Cloudflare Pages `_worker.js`) still exists, but only as a **third-party
OAuth authorize/consent IdP** — for apps that integrate against Oxy via OAuth
instead of embedding the SDK — plus a device-account chooser feed it reads
through the same first-party cookie.

| Role | Package / host | Session authority |
|---|---|---|
| **API** | `packages/api` → `api.oxy.so` | Owns the `oxy_device` cookie (`Domain=.oxy.so`), the rotating refresh-token family, and every device-first endpoint |
| **RP (web)** | `WebOxyProvider` from `@oxyhq/auth` | The SDK; restores via device-first cold boot, never redirects for sign-in |
| **RP (Expo/RN)** | `OxyProvider` from `@oxyhq/services` | The SDK; restores via device-first cold boot + native shared-keychain SSO |
| **Third-party OAuth IdP** | `packages/auth` → `auth.oxy.so` | Login/signup/authorize/recover/settings SPA + OAuth authorize/consent + the device-account chooser feed (`GET /api/device-accounts`) |

**The IdP exception (still applies, mechanism changed):** the auth app is not
an RP and must not use `WebOxyProvider` / `runSessionColdBoot`. There is no
longer a `/sso`/FedCM loop to worry about circularity with — that machinery
is gone entirely, not replaced by an equivalent self-referential path. The
auth app's own account-chooser feed reads the shared `oxy_device` cookie
first-party and forwards it to the API's internal `POST /auth/device/resolve`
under an `X-Oxy-Internal` shared secret.

---

## 2. The `oxy_device` cookie and the device-first bootstrap surface

The device-first anchor, defined once in `packages/api/src/utils/deviceCookie.ts`:

- Name `oxy_device`; `HttpOnly`, `Secure` (prod), `SameSite=Lax`,
  `Domain=.oxy.so`, 400-day sliding `Max-Age`, re-set on every bootstrap hop.
  Dev/localhost: host-only, no `Secure`, so `http://localhost` works without TLS.
- The cookie value is a random 256-bit secret, **never** the deviceId. Server-side
  it is stored only as its SHA-256 (`DeviceSession.cookieKeyHash`); possessing
  the cookie reveals nothing about the device's account set.

Server surface (`packages/api/src/routes/deviceAuth.ts`, mounted at `/auth`
on `api.oxy.so`, BEFORE the generic `/auth` router):

| Endpoint | Purpose |
|---|---|
| `GET /auth/device/bootstrap` | Top-level cross-apex hop target. (Re-)plants `oxy_device`, resolves the active session, and 303s back to `return_to` with a single-use boot `code` (or a `no_session`/`new_device` reason) in a `#oxy_boot=…` fragment. `return_to` must resolve to a trusted-lane origin. |
| `POST /auth/device/web-session` | Same-site (`*.oxy.so`) fast path — exchanges the `oxy_device` cookie directly for a token bundle, no redirect. |
| `POST /auth/device/exchange` | Burn a boot code (origin-bound, atomic single-use) for a token bundle. |
| `POST /auth/refresh-token` | The one rotating refresh implementation, web + native. Reuse of an already-rotated token revokes the whole family. |
| `POST /auth/device/token` | Bearer-gated: issue the native-channel device token (deviceId derived from the caller's JWT, never the body). |
| `POST /auth/device/resolve` | `X-Oxy-Internal`-gated device-set feed consumed by the `auth.oxy.so` account chooser. |

No token or deviceId is ever placed in a URL/query/fragment/response-body
of these endpoints — the cookie secret is not the deviceId, the boot code is
opaque, and the deviceToken is opaque.

---

## 3. Device-first cold boot (`runSessionColdBoot`)

`runSessionColdBoot` (`packages/core/src/boot/coldBootV2.ts`) is the single
implementation both `WebOxyProvider` (`@oxyhq/auth`) and `OxyContext`
(`@oxyhq/services`) call — there is no separate web/native cold-boot chain to
keep in sync anymore. Built on the same pure `runColdBoot` short-circuit
primitive (`packages/core/src/utils/coldBoot.ts`) used before wave 2. It
**never** redirects to a login page: an unresolved boot ends signed-out and the
app renders its own in-app "Sign in with Oxy" UI.

| # | step `id` | enabled when | what it does |
|---|---|---|---|
| 1 | `bootstrap-return` | web, `#oxy_boot` fragment present | parse + verify `state`, exchange the boot code via `POST /auth/device/exchange`, plant tokens |
| 2 | `stored-tokens` | always | warm-plant a still-valid persisted access token, else rotate the family via `POST /auth/refresh-token` |
| 3 | `shared-key-signin` | native only | re-mint from the shared-keychain identity; issues/mirrors a shared device token the first time |
| 4 | `bootstrap-hop` | web, terminal | **same-apex**: inline credentialed `POST /auth/device/web-session` fetch, runs every boot, no navigation. **Cross-apex**: ONE visible top-level navigation, ever, per browser+origin, to the API's `GET /auth/device/bootstrap` (the RP's own configured `baseURL` — a single canonical host, not a per-apex CNAME) |
| — | (signed out) | — | no step yielded a session |

The cross-apex hop fires on the very first load in a given browser regardless
of whether it turns out to find a session, then never repeats for that
browser+origin — a persistent `localStorage` flag (`oxy.boot.attempted`) is the
guard, not any server-side or session-based gate. All mutable guard state
lives in storage (never module scope), so it holds under Metro/bundler
re-evaluation.

**Native cold boot** runs steps 2 and 3 only — there is no bootstrap-hop, no
iframe, no bounce on native; a fresh install with no stored tokens and no
shared-keychain identity ends signed out immediately.

---

## 4. Sign-in is an in-app SDK modal

For first-party apps (anything using `OxyProvider` or `WebOxyProvider`),
interactive sign-in is a **modal rendered by the provider itself** — there is
no redirect to `auth.oxy.so`.

- `useAuth().signIn()` just opens the modal; it never navigates away.
- Password + 2FA: `POST /auth/login` → (if 2FA enabled) `POST
  /security/2fa/verify-login`.
- "Sign in with Oxy" QR/handoff (Commons): unchanged from before wave 2 — see
  [identity/README.md → Sign in with Oxy](../identity/README.md#6-sign-in-with-oxy).
- Native additionally tries the shared-keychain identity automatically via the
  cold boot's `shared-key-signin` step (no user interaction).

`auth.oxy.so`'s own login/signup/authorize/recover pages are for the
**third-party OAuth** surface only — a first-party app embedding the SDK never
lands there for interactive sign-in.

---

## 5. Trust and OAuth consent (third-party apps)

Third-party apps that integrate via `auth.oxy.so`'s OAuth authorize/consent
flow get auto-approved consent only if their `Application` is
**registry-trusted** — `isTrustedApplication()`
(`packages/api/src/utils/trustedApplication.ts`): `isOfficial`, `isInternal`,
or `type` ∈ `{first_party, internal, system}`, all staff-controlled fields.
Trust is **registry-based, not domain-based** — official apps span
`mention.earth`, `homiio.com`, `syra.fm`, etc. Ordinary self-service
`third_party` applications always see the consent screen, even while
`status: 'active'`.

A user's revocable third-party grants are the authoritative `AppGrant` model
(replaces the deleted FedCM `me/authorized-apps` surface):

```
GET    /apps/authorized            → { data: { apps: [...] } }
DELETE /apps/authorized/:clientId  → 204
```

`clientId` is an OAuth `client_id` (`ApplicationCredential.publicKey`); the
grant is keyed by `applicationId`. Trusted first-party/internal/official apps
are auto-approved and never recorded, so this surface only ever lists the
revocable third-party set.

---

## 6. Session token planting

`OxyServices.verifyChallenge()` and `claimSessionByToken()` both call
`setTokens(accessToken, refreshToken ?? '')` internally before returning.
Consumers do not hand-plant tokens after sign-in — they `await` and proceed.

**401 = authoritative local sign-out.** On a 401, `HttpService` clears tokens
and emits `onTokensChanged(null)`. The providers treat that as authoritative:
clear session state and disable private fetches until a new token is restored.
`isAuthenticated` must never stay `true` after `getAccessToken()` becomes null.
Consumer apps gate private work with SDK state — native:
`useAuth().canUsePrivateApi` / `useAuth().isPrivateApiPending`; web:
`useAuth().isLoading` / `useAuth().isReady` — never local token helpers.

---

## 7. Service tokens (internal service-to-service auth)

Internal Oxy services authenticate with short-lived service JWTs (OAuth2
Client-Credentials). See [service tokens detail](../SERVICE_TOKENS.md) for the
DB model; the SDK surface (`OxyServices.auth.ts`):

```ts
const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
oxy.configureServiceAuth('oxy_dk_...', 'secret...');
const token = await oxy.getServiceToken();             // cached + auto-refreshed
const result = await oxy.makeServiceRequest('POST', '/endpoint', data, userId);
```

- `getServiceToken()` caches per `sha256(apiKey)` with a 60s clock-drift buffer,
  deduplicates concurrent calls via a shared `pending` promise, and compares the
  secret in constant time (`timingSafeEqual`). A secret mismatch throws
  `ServiceCredentialMismatchError`.
- `makeServiceRequest()` adds `Authorization: Bearer <token>` and, when `userId`
  is passed, an `X-Oxy-User-Id` delegation header.
- The service JWT embeds `appId` (= `applicationId`) and `credentialId`; the
  claim name `appId` is intentionally stable so `@oxyhq/core` service-token
  verification doesn't break.

The token endpoint is `POST /auth/service-token`, validating `publicKey` +
`secret` against an active `type:'service'` `ApplicationCredential` (sha256
`secretHash`, constant-time).

---

## 8. "Sign in with Oxy" — device sign-in (QR + shared keychain)

Two mechanisms, both surfaced under one user-facing label "Sign in with Oxy",
both unaffected by the wave-2 device-first cutover (they predate it and were
kept as-is):

- **Same-device shared-keychain SSO (native):** `signInWithSharedIdentity()`
  signs a challenge with the shared identity key and redeems it. Runs as the
  `shared-key-signin` cold-boot step on native.
- **Cross-device QR handoff:** `startCommonsSignIn({ clientId })`
  (`OxyServices.auth.ts`) mints a secret `sessionToken` + a public
  `authorizeCode`, calls `POST /auth/session/create`, and returns a
  `qrPayload` (`oxycommons://approve?v=1&code=<authorizeCode>&...`) — the secret
  `sessionToken` is **never** in the QR. Commons scans, fetches
  `getCommonsApprovalInfo(authorizeCode)` (server-resolved `Application` identity
  + scopes, never trusting the raw QR), biometric-gates, and key-signs
  `approveCommonsSignIn(...)` → `POST /auth/session/authorize-signed/:code`. The
  RP polls (`pollCommonsSignIn`) and redeems via `claimSessionByToken`.

Full crypto + endpoint detail is in
[identity/README.md → Sign in with Oxy](../identity/README.md#6-sign-in-with-oxy).

---

## 9. Linked backend clients (RP → its own API)

RP apps that call their *own* backend (`api.mention.earth`, `api.syra.fm`, …)
MUST use `oxyServices.createLinkedClient({ baseURL })`. The linked client mirrors
the session owner's access token, delegates preflight/401 refresh to the owner,
and invalidates the owner when a linked 401 can't refresh. `createLinkedClient`
defaults to `enableCache: false` so a GET cache never serves stale-after-write
data.

**Do NOT** add app-local token providers, Axios/fetch auth interceptors, manual
`Authorization` plumbing, refresh-cookie retries, or local session invalidation.
Those drift and re-implement what the SDK already owns.

---

## 10. Backend request identity — `@oxyhq/core/server`

Express/Node backends use the shared server middleware. **Do not** define
app-local `AuthRequest`, `requireAuth`, `getUserId`, bearer parsers, or
token-decoding middleware — missing behavior belongs upstream in
`@oxyhq/core/server`.

| Export | File | Purpose |
|---|---|---|
| `createOptionalOxyAuth(oxy, opts?)` | `server/auth.ts` | resolve identity if present (idempotent); never 401s |
| `createOxyAuthMiddleware(oxy, opts?)` | `server/auth.ts` | optional-auth + `requireOxyAuth` (401 if missing) |
| `requireOxyAuth(req,res,next)` | `server/auth.ts` | 401 when no resolved userId |
| `getRequiredOxyUserId(req)` | `server/auth.ts` | resolve userId or throw — use this for owner ids |
| `createOxyRateLimit(oxy, opts?)` | `server/rateLimit.ts` | per-user / per-IP limiting; exempts uploads/media/health/OPTIONS; `express-rate-limit` is a required peer |
| `createOxyCors({ appOrigins, allowCredentials })` | `server/cors.ts` | deny-by-default allowlist; auto-allows `*.oxy.so`; HTTPS-only; **never** wildcard+credentials; always `Vary: Origin` |
| `safeFetch(url, opts?)` | `server/safeFetch.ts` | SSRF-safe fetch (see below) |
| `verifySecret(provided, expected)` | `server/verifySecret.ts` | constant-time `timingSafeEqual` + length guard; returns `false`, never throws |
| `authSocket` | `server/auth.ts` | Socket.IO/WebSocket auth |

**`safeFetch` SSRF protections** (use it for **any** fetch of a user/remote-supplied
URL): URL length ≤ 2048, protocol ∈ {http,https}, port ∈ {80,443}, a private/CGNAT/
link-local IPv4 denylist (`10/8`, `127/8`, `169.254/16`, `172.16/12`,
`192.168/16`, `100.64/10`, …), a **DNS-pinned** custom `lookup` that connects to
the exact validated IP (closes the DNS-rebind TOCTOU), bounded redirects
(`MAX_REDIRECTS = 5`, validate every hop, destroy redirect bodies), and an 8s
headers timeout. On Bun the custom `lookup` MUST return `[{address,family}]` when
called with `{all:true}` or Bun throws `results.sort is not a function`.

**Socket.IO rule:** always `io.use(oxy.authSocket())`, derive rooms from
`socket.user.id` (never client-supplied), and ownership-check before joining
session/conversation rooms — client-supplied room IDs are a critical IDOR gap.

**Mass-assignment rule:** never `new Model(req.body)` or spread `req.body` into
`findByIdAndUpdate`; resolve owner ids via `getRequiredOxyUserId` and whitelist
fields explicitly.
